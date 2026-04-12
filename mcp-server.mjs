#!/usr/bin/env node

/**
 * Purroxy MCP Server
 *
 * Bridges Claude Desktop to the Purroxy Electron app's local HTTP API.
 * The Electron app must be running.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

// Find the MCP API port written by the Electron app
function getPort() {
  const paths = [
    join(homedir(), 'Library', 'Application Support', 'purroxy', 'mcp-port'),
    join(homedir(), 'AppData', 'Roaming', 'purroxy', 'mcp-port'),
    join(homedir(), '.config', 'purroxy', 'mcp-port')
  ]
  for (const p of paths) {
    try { return parseInt(readFileSync(p, 'utf-8').trim()) } catch {}
  }
  return null
}

async function apiCall(path, method = 'GET', body = null) {
  const port = getPort()
  if (!port) throw new Error('Purroxy is not running.')
  const url = `http://127.0.0.1:${port}${path}`
  const opts = { method, headers: { 'Content-Type': 'application/json' } }
  if (body) opts.body = JSON.stringify(body)
  const res = await fetch(url, opts)
  return res.json()
}

// Create MCP server
const server = new Server(
  { name: 'purroxy', version: '0.1.0' },
  { capabilities: { tools: {} } }
)

// Tool name → capability ID mapping
let toolMap = {}

// List tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  try {
    const { tools } = await apiCall('/tools')
    toolMap = {}
    for (const t of tools) {
      toolMap[t.name] = t._capabilityId
    }
    return {
      tools: tools.map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema
      }))
    }
  } catch (err) {
    return { tools: [] }
  }
})

// Call tool
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const toolName = request.params.name
  const args = request.params.arguments || {}
  let capId = toolMap[toolName]

  if (!capId) {
    // Tools list might be stale — try refreshing
    try {
      const { tools } = await apiCall('/tools')
      for (const t of tools) toolMap[t.name] = t._capabilityId
      capId = toolMap[toolName]
    } catch {}

    if (!capId) {
      return {
        content: [{ type: 'text', text: `Tool "${toolName}" not found.` }],
        isError: true
      }
    }
  }

  try {
    const result = await apiCall('/execute', 'POST', {
      capabilityId: capId,
      params: args
    })

    let text = ''
    if (result.data?._pageContent) {
      text = result.data._pageContent
    } else if (result.data && Object.keys(result.data).length > 0) {
      text = Object.entries(result.data)
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
        .join('\n')
    }
    if (result.error) {
      text += `\n\n(Note: ${result.error})`
    }
    if (!text) {
      text = 'No data extracted.'
    }

    return { content: [{ type: 'text', text }] }
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Failed: ${err.message}. Is Purroxy running?` }],
      isError: true
    }
  }
})

// Start
const transport = new StdioServerTransport()
await server.connect(transport)
process.stderr.write('[Purroxy MCP] Server started\n')
