import { createServer, IncomingMessage, ServerResponse } from 'http'
import { getAllCapabilities, getCapability, updateCapability } from './capabilities'
import { getAllSites, getSite, getSession } from './sites'
import { getAllDecryptedValues } from './vault'
import { isLocked } from './app-lock'
import { isLicenseValid } from './account'
import { PlaywrightEngine } from '../core/browser/playwright-engine'
import { healSelector } from './healer'
import { store } from './store'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

let server: ReturnType<typeof createServer> | null = null
let serverPort = 0

export function startMCPApi(): number {
  if (server) return serverPort

  server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // CORS for local requests only
    res.setHeader('Content-Type', 'application/json')

    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', async () => {
      try {
        const url = req.url || ''

        if (url === '/tools' && req.method === 'GET') {
          // List all capabilities as MCP tools
          const caps = getAllCapabilities()
          const sites = getAllSites()

          const tools = caps.map(cap => {
            const site = getSite(cap.siteProfileId)
            const params: Record<string, any> = {}
            for (const p of cap.parameters) {
              params[p.name] = {
                type: 'string',
                description: p.description,
                default: p.defaultValue
              }
            }

            // Generate a clean tool name from the capability name
            const toolName = 'purroxy_' + cap.name
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '_')
              .replace(/^_|_$/g, '')
              .slice(0, 40)

            return {
              name: toolName,
              description: `${cap.name} (${site?.hostname || 'unknown site'}): ${cap.description}`,
              inputSchema: {
                type: 'object',
                properties: params,
                required: cap.parameters.filter(p => p.required).map(p => p.name)
              },
              _capabilityId: cap.id
            }
          })

          res.writeHead(200)
          res.end(JSON.stringify({ tools }))

        } else if (url === '/execute' && req.method === 'POST') {
          // Block execution when app is locked
          if (isLocked()) {
            res.writeHead(403)
            res.end(JSON.stringify({ error: 'App is locked.' }))
            return
          }

          // Block execution when license is invalid
          if (!isLicenseValid()) {
            res.writeHead(402)
            res.end(JSON.stringify({
              error: 'subscription_required',
              message: 'Subscribe or publish a capability to continue.'
            }))
            return
          }

          const { capabilityId, params: paramValues = {} } = JSON.parse(body || '{}')

          const cap = getCapability(capabilityId)
          if (!cap) {
            res.writeHead(404)
            res.end(JSON.stringify({ error: 'Capability not found' }))
            return
          }

          const site = getSite(cap.siteProfileId)
          if (!site) {
            res.writeHead(404)
            res.end(JSON.stringify({ error: 'Site not found' }))
            return
          }

          const session = getSession(cap.siteProfileId)
          const engine = new PlaywrightEngine()

          // Wire AI-based self-healing
          const apiKey = store.get('aiApiKey')
          if (apiKey) {
            engine.setHealer(async (context) => {
              const result = await healSelector(apiKey, context)
              return result
            })
          }

          try {
            await engine.launch({
              headless: true,
              cookies: session?.cookies || [],
              localStorage: session?.localStorage || {},
              viewport: (cap as any).viewport || undefined
            })

            // Auto-prepend navigate if needed
            let actions = [...(cap.actions as any[])]
            let params = [...(cap.parameters as any[])]
            const firstAction = actions[0]
            if (!firstAction || firstAction.type !== 'navigate' || !firstAction.url) {
              const siteUrl = site.url || ('https://' + site.hostname)
              actions.unshift({
                type: 'navigate', timestamp: 0, url: siteUrl,
                label: 'Navigate to site (auto-prepended)'
              })
              params = params.map((p: any) => ({ ...p, actionIndex: p.actionIndex + 1 }))
            }

            const result = await engine.execute(actions, params, paramValues, cap.extractionRules as any)

            // Persist AI-healed locators back into the capability
            const healed = engine.getHealedLocators()
            if (healed.length > 0) {
              const updatedActions = [...(cap.actions as any[])]
              for (const h of healed) {
                const idx = h.actionIndex
                if (idx >= 0 && updatedActions[idx]) {
                  const existing = updatedActions[idx].locators || []
                  updatedActions[idx] = {
                    ...updatedActions[idx],
                    locators: [h.locator, ...existing]
                  }
                }
              }
              updateCapability(capabilityId, { actions: updatedActions } as any)
            }

            // Redact sensitive extraction fields
            if (result.data) {
              for (const rule of cap.extractionRules) {
                if (rule.sensitive && result.data[rule.name]) {
                  result.data[rule.name] = '[REDACTED - sensitive]'
                }
              }
            }

            // Scrub vault values from all string data
            const vaultValues = getAllDecryptedValues()
            if (Object.keys(vaultValues).length > 0 && result.data) {
              for (const [dataKey, dataVal] of Object.entries(result.data)) {
                if (typeof dataVal === 'string') {
                  let scrubbed = dataVal
                  for (const [vaultKey, vaultVal] of Object.entries(vaultValues)) {
                    if (vaultVal && scrubbed.includes(vaultVal)) {
                      scrubbed = scrubbed.replaceAll(vaultVal, `[VAULT:${vaultKey}]`)
                    }
                  }
                  result.data[dataKey] = scrubbed
                }
              }
            }

            res.writeHead(200)
            res.end(JSON.stringify({
              success: result.success,
              data: result.data,
              error: result.error,
              durationMs: result.durationMs
            }))
          } catch (err: any) {
            res.writeHead(500)
            res.end(JSON.stringify({ error: err.message }))
          } finally {
            await engine.close()
          }

        } else {
          res.writeHead(404)
          res.end(JSON.stringify({ error: 'Not found' }))
        }
      } catch (err: any) {
        res.writeHead(500)
        res.end(JSON.stringify({ error: err.message }))
      }
    })
  })

  // Listen on random port
  server.listen(0, '127.0.0.1', () => {
    const addr = server!.address()
    serverPort = typeof addr === 'object' && addr ? addr.port : 0
    console.log(`[MCP API] Listening on port ${serverPort}`)

    // Write port to a known file so the MCP server script can find it
    const portFile = join(app.getPath('userData'), 'mcp-port')
    writeFileSync(portFile, String(serverPort))
  })

  return serverPort
}

export function stopMCPApi() {
  server?.close()
  server = null
}
