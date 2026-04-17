import { chromium, Browser, BrowserContext, Page } from 'playwright'
import type { BrowserEngineOptions, ExecutionResult, ExtractedData, ExtractionRule, RecordedAction, Parameter, Locator } from './types'

export type HealerFn = (context: {
  intent: string
  label: string
  tagName: string
  originalLocators: Array<{ strategy: string; value: string }>
  domSnapshot: string
  actionType: string
  pageUrl: string
}) => Promise<{ selector: string | null; confidence: string } | null>

const MAX_HEALS_PER_RUN = 3

export class PlaywrightEngine {
  private browser: Browser | null = null
  private context: BrowserContext | null = null
  private page: Page | null = null
  private log: string[] = []
  private healer: HealerFn | null = null
  private healCount = 0
  private _healedLocators: Array<{ actionIndex: number; locator: Locator }> = []

  setHealer(fn: HealerFn) { this.healer = fn }

  getHealedLocators(): Array<{ actionIndex: number; locator: Locator }> {
    return this._healedLocators
  }

  private addLog(msg: string) {
    const ts = new Date().toISOString().slice(11, 23)
    this.log.push(`[${ts}] ${msg}`)
  }

  async launch(options: BrowserEngineOptions = {}): Promise<void> {
    this.log = []
    this.healCount = 0
    this._healedLocators = []
    this.addLog('Launching browser...')

    this.browser = await chromium.launch({
      headless: options.headless !== false
    })

    const vp = options.viewport || { width: 1280, height: 800 }
    this.addLog(`Viewport: ${vp.width}x${vp.height}`)

    this.context = await this.browser.newContext({
      viewport: vp,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    })

    // Inject cookies if provided
    if (options.cookies && options.cookies.length > 0) {
      // Normalize Electron cookie format to Playwright format
      const normalizeSameSite = (s: string | undefined): 'Strict' | 'Lax' | 'None' => {
        if (!s) return 'Lax'
        const lower = s.toLowerCase()
        if (lower === 'strict') return 'Strict'
        if (lower === 'none' || lower === 'no_restriction') return 'None'
        return 'Lax' // "unspecified", "lax", or anything else → Lax
      }
      const pwCookies = options.cookies
        .filter((c: any) => c.name && c.value && c.domain) // skip malformed cookies
        .map((c: any) => ({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path || '/',
          secure: c.secure || false,
          httpOnly: c.httpOnly || false,
          sameSite: normalizeSameSite(c.sameSite)
        }))
      await this.context.addCookies(pwCookies)
      this.addLog(`Injected ${pwCookies.length} cookies`)
    } else {
      this.addLog('No cookies to inject')
    }

    this.page = await this.context.newPage()

    if (options.localStorage && Object.keys(options.localStorage).length > 0) {
      (this.page as any).__pendingLocalStorage = options.localStorage
      this.addLog(`Pending localStorage: ${Object.keys(options.localStorage).length} items`)
    }

    this.page.setDefaultTimeout(options.timeout || 15000)
    this.addLog('Browser launched')
  }

  async execute(
    actions: RecordedAction[],
    parameters: Parameter[],
    paramValues: Record<string, string>,
    extractionRules: ExtractionRule[]
  ): Promise<ExecutionResult> {
    if (!this.page) throw new Error('Browser not launched')

    const startTime = Date.now()
    this.addLog(`Executing ${actions.length} actions (${parameters.length} params, ${extractionRules.length} extractions)`)

    try {
      const resolvedActions = this.substituteParams(actions, parameters, paramValues)

      // Optimize: remove wait actions and deduplicate consecutive navigations
      const optimized = this.optimizeActions(resolvedActions)
      this.addLog(`Optimized: ${resolvedActions.length} actions → ${optimized.length} (removed waits + duplicate navs)`)

      let failedSteps = 0
      let unreachableError: string | null = null
      for (let i = 0; i < optimized.length; i++) {
        const action = optimized[i]
        this.addLog(`Step ${i + 1}/${optimized.length}: ${action.type} ${action.selector || action.url || ''} ${action.label ? '(' + action.label + ')' : ''}`.trim())

        try {
          await this.executeAction(action, i)
          this.addLog(`  -> OK`)
        } catch (err: any) {
          failedSteps++
          this.addLog(`  -> FAILED (skipping): ${err.message}`)

          // A failed navigate is fatal: later steps all assume we're on the
          // target page. Also bail if the browser is already stuck on Chrome's
          // network-error page from an earlier nav (goto throws before
          // chrome-error:// is committed, so we may only notice one step late).
          const navFailed = action.type === 'navigate'
          const onErrorPage = this.page.url().startsWith('chrome-error://')
          if (navFailed || onErrorPage) {
            unreachableError = err.message
            const skipped = optimized.length - i - 1
            this.addLog(`  -> Site unreachable; aborting${skipped > 0 ? ` remaining ${skipped} step(s)` : ''}.`)
            break
          }
        }
      }

      if (unreachableError) {
        const screenshotBuffer = await this.page.screenshot({ type: 'png' })
        return {
          success: false,
          data: {},
          error: `Site unreachable: ${unreachableError}`,
          errorType: 'transient',
          durationMs: Date.now() - startTime,
          screenshot: screenshotBuffer.toString('base64'),
          log: this.log
        }
      }

      this.addLog(`Completed: ${optimized.length - failedSteps}/${optimized.length} actions succeeded`)
      this.addLog('Waiting for page to settle...')
      await this.page.waitForTimeout(1500)

      const currentUrl = this.page.url()
      this.addLog(`Final URL: ${currentUrl}`)

      this.addLog('Extracting data...')
      const data = await this.extractData(extractionRules)
      const cssFieldsFound = Object.values(data).filter(v => v !== null && (Array.isArray(v) ? v.length > 0 : true)).length
      this.addLog(`CSS extraction: ${cssFieldsFound}/${Object.keys(data).length} fields found`)

      // Fallback: always capture visible page text for AI parsing
      let pageContent = ''
      try {
        pageContent = await this.page.evaluate(() => {
          return document.body.innerText.slice(0, 5000)
        })
        this.addLog(`Page text captured: ${pageContent.length} chars`)
      } catch {}

      // Always include page text so the AI can parse what selectors missed
      if (pageContent) {
        data['_pageContent'] = pageContent
        if (cssFieldsFound === 0) {
          this.addLog('No CSS fields matched — using page text as primary data')
        }
      }

      const screenshotBuffer = await this.page.screenshot({ type: 'png' })
      const screenshot = screenshotBuffer.toString('base64')

      return {
        success: failedSteps === 0,
        data,
        error: failedSteps > 0 ? `${failedSteps} action(s) failed but extraction continued` : undefined,
        errorType: failedSteps > 0 ? 'site_changed' : undefined,
        durationMs: Date.now() - startTime,
        screenshot,
        log: this.log
      }
    } catch (err: any) {
      const errorType = this.classifyError(err)

      let screenshot: string | undefined
      try {
        const currentUrl = this.page!.url()
        this.addLog(`Page URL at failure: ${currentUrl}`)
        const buf = await this.page!.screenshot({ type: 'png' })
        screenshot = buf.toString('base64')
      } catch {}

      return {
        success: false,
        data: {},
        error: err.message,
        errorType,
        durationMs: Date.now() - startTime,
        screenshot,
        log: this.log
      }
    }
  }

  private substituteParams(
    actions: RecordedAction[],
    parameters: Parameter[],
    paramValues: Record<string, string>
  ): RecordedAction[] {
    return actions.map((action, idx) => {
      const param = parameters.find(p => p.actionIndex === idx)
      if (!param) return action
      const newValue = paramValues[param.name] ?? param.defaultValue

      if (param.field === 'url' && action.url) {
        // For URL params: replace the default value within the URL, not the whole URL
        const originalUrl = action.url
        if (originalUrl.includes(param.defaultValue)) {
          const substituted = originalUrl.replace(param.defaultValue, newValue)
          this.addLog(`Param substitution at action ${idx}: ${param.name} = "${newValue}" (in URL)`)
          return { ...action, url: substituted }
        } else {
          // Default value not found in URL — append or skip
          this.addLog(`Param substitution at action ${idx}: ${param.name} — default "${param.defaultValue}" not found in URL, skipping`)
          return action
        }
      }

      if (param.field === 'value' && action.value) {
        // For value params: replace the default value within the value, or full replace
        const originalValue = action.value
        if (originalValue.includes(param.defaultValue)) {
          const substituted = originalValue.replace(param.defaultValue, newValue)
          this.addLog(`Param substitution at action ${idx}: ${param.name} = "${newValue}" (in value)`)
          return { ...action, value: substituted }
        }
      }

      this.addLog(`Param substitution at action ${idx}: ${param.name} = "${newValue}"`)
      return { ...action, [param.field]: newValue }
    })
  }

  private async dismissCookieBanners(): Promise<void> {
    if (!this.page) return
    try {
      await this.page.evaluate(() => {
        // Common cookie consent selectors
        const selectors = [
          '[class*="cookie"] button[class*="accept"]',
          '[class*="cookie"] button[class*="agree"]',
          '[class*="consent"] button[class*="accept"]',
          '[id*="cookie"] button',
          'button[id*="accept-cookie"]',
          'button[id*="cookie-accept"]',
          '[class*="gdpr"] button',
          'button[aria-label*="Accept"]',
          'button[aria-label*="accept"]',
          'button[aria-label*="cookie"]',
          '[data-testid*="cookie"] button',
          '.cc-btn.cc-dismiss',
        ]
        for (const sel of selectors) {
          const btn = document.querySelector(sel) as HTMLElement
          if (btn && btn.offsetParent !== null) { btn.click(); break }
        }
      })
    } catch {} // Silently ignore if no banners
  }

  private optimizeActions(actions: RecordedAction[]): RecordedAction[] {
    const result: RecordedAction[] = []
    let lastNavUrl = ''

    for (const action of actions) {
      // Skip wait actions — page loads naturally during replay
      if (action.type === 'wait') continue

      // Skip scroll actions with no selector — usually noise
      if (action.type === 'scroll' && (!action.selector || action.selector === 'window')) continue

      // Skip duplicate consecutive navigations
      if (action.type === 'navigate' && action.url === lastNavUrl) continue

      if (action.type === 'navigate') lastNavUrl = action.url || ''
      else lastNavUrl = ''

      result.push(action)
    }
    return result
  }

  private async executeAction(action: RecordedAction, actionIndex = -1): Promise<void> {
    if (!this.page) return

    // Inject pending localStorage on first navigation
    if (action.type === 'navigate' && (this.page as any).__pendingLocalStorage) {
      const ls = (this.page as any).__pendingLocalStorage
      delete (this.page as any).__pendingLocalStorage

      if (action.url) {
        await this.page.goto(action.url, { waitUntil: 'domcontentloaded' })
        await this.page.evaluate((items: Record<string, string>) => {
          for (const [k, v] of Object.entries(items)) localStorage.setItem(k, v)
        }, ls)
        this.addLog(`  Injected ${Object.keys(ls).length} localStorage items, reloading...`)
        await this.page.reload({ waitUntil: 'domcontentloaded' })
        return
      }
    }

    switch (action.type) {
      case 'navigate':
        if (action.url) {
          await this.page.goto(action.url, { waitUntil: 'domcontentloaded' })
          await this.page.waitForTimeout(500)
          await this.dismissCookieBanners()
        }
        break

      case 'click':
        if (action.selector || (action as any).locators?.length) {
          await this.smartClick(action, actionIndex)
          await this.page.waitForTimeout(500)
        }
        break

      case 'type':
        if (action.selector && action.value && !action.sensitive) {
          try {
            await this.page.waitForSelector(action.selector, { state: 'visible', timeout: 1500 })
            await this.page.fill(action.selector, action.value)
          } catch {
            // Fallback: try by label/placeholder
            if (action.label) {
              this.addLog(`  Selector failed for type, trying by label...`)
              try {
                await this.page.getByLabel(action.label, { exact: false }).first().fill(action.value, { timeout: 1500 })
                this.addLog(`  Found input by label "${action.label}"`)
              } catch {
                // Label also failed — try AI healing
                const healed = await this.tryHeal(action, actionIndex, [{ strategy: 'css', value: action.selector }])
                if (!healed) throw new Error(`Could not find input: ${action.selector}`)
              }
            } else {
              // No label — try AI healing directly
              const healed = await this.tryHeal(action, actionIndex, [{ strategy: 'css', value: action.selector }])
              if (!healed) throw new Error(`Could not find input: ${action.selector}`)
            }
          }
        }
        break

      case 'select':
        if (action.selector && action.value) {
          try {
            await this.page.selectOption(action.selector, { label: action.value })
          } catch {
            await this.waitAndClick(action.selector)
            await this.page.waitForTimeout(300)
            const option = this.page.getByText(action.value, { exact: false }).first()
            await option.click({ timeout: 1500 }).catch(() => {})
          }
        }
        break

      case 'scroll':
        if (action.selector && action.selector !== 'window' && action.value) {
          await this.page.evaluate(
            ({ sel, top }: { sel: string; top: number }) => {
              const el = document.querySelector(sel)
              if (el) el.scrollTop = top
            },
            { sel: action.selector, top: parseInt(action.value) }
          )
        } else if (action.value) {
          await this.page.evaluate((top: number) => window.scrollTo(0, top), parseInt(action.value))
        }
        await this.page.waitForTimeout(500)
        break

      case 'wait':
        await this.page.waitForTimeout(1000)
        break
    }
  }

  private async getCompactDOM(): Promise<string> {
    if (!this.page) return ''
    try {
      return await this.page.evaluate(() => {
        function ser(el: Element, depth: number): string {
          if (depth > 8) return ''
          const tag = el.tagName.toLowerCase()
          if (['script','style','svg','noscript','link','meta','head'].includes(tag)) return ''
          const style = getComputedStyle(el)
          if (style.display === 'none' || style.visibility === 'hidden') return ''

          const attrs: string[] = []
          for (const a of ['id','role','aria-label','name','placeholder','data-testid','type','href']) {
            const v = el.getAttribute(a)
            if (v) attrs.push(`${a}="${v.slice(0,60)}"`)
          }
          const cls = el.className
          if (typeof cls === 'string' && cls) attrs.push(`class="${cls.split(/\s+/).slice(0,3).join(' ')}"`)

          const text = Array.from(el.childNodes)
            .filter(n => n.nodeType === 3)
            .map(n => (n.textContent || '').trim())
            .join(' ').trim().slice(0, 60)

          const children = Array.from(el.children)
            .map(c => ser(c, depth + 1))
            .filter(Boolean).join('')

          const textPart = text ? ` "${text}"` : ''
          const attrPart = attrs.length ? ' ' + attrs.join(' ') : ''
          return `<${tag}${attrPart}${textPart}>${children}</${tag}>`
        }
        return ser(document.body, 0).slice(0, 4000)
      })
    } catch {
      return ''
    }
  }

  private async tryHeal(action: RecordedAction, actionIndex: number, locators: Array<{ strategy: string; value: string }>): Promise<boolean> {
    if (!this.healer || !this.page) return false
    if (this.healCount >= MAX_HEALS_PER_RUN) {
      this.addLog(`  Max heals reached (${MAX_HEALS_PER_RUN}), skipping AI repair`)
      return false
    }
    if (!action.intent && !action.label) return false

    this.addLog(`  All locators failed. Attempting AI healing...`)
    this.healCount++

    const domSnapshot = await this.getCompactDOM()
    const pageUrl = this.page.url()

    const result = await this.healer({
      intent: action.intent || `${action.type} on "${action.label}"`,
      label: action.label || '',
      tagName: action.tagName || '*',
      originalLocators: locators,
      domSnapshot,
      actionType: action.type,
      pageUrl
    })

    if (!result?.selector || result.confidence === 'none') {
      this.addLog(`  AI could not find element`)
      return false
    }

    this.addLog(`  AI suggests: ${result.selector} (${result.confidence})`)

    try {
      await this.page.waitForSelector(result.selector, { state: 'visible', timeout: 3000 })

      if (action.type === 'click') {
        await this.page.click(result.selector)
      } else if (action.type === 'type' && action.value) {
        await this.page.fill(result.selector, action.value)
      }

      this.addLog(`  AI-healed ${action.type} succeeded!`)

      // Store for cache-back
      this._healedLocators.push({
        actionIndex,
        locator: { strategy: 'css', value: result.selector }
      })

      return true
    } catch (err: any) {
      this.addLog(`  AI-suggested selector also failed: ${err.message}`)
      return false
    }
  }

  private async smartClick(action: RecordedAction, actionIndex = -1): Promise<void> {
    if (!this.page) return

    const locators: Array<{ strategy: string; value: string; name?: string; attr?: string; tag?: string }> =
      (action as any).locators || []

    // Try each locator strategy in priority order
    for (const loc of locators) {
      try {
        switch (loc.strategy) {
          case 'testid':
            await this.page.getByTestId(loc.value).first().click({ timeout: 1500 })
            this.addLog(`  Found by testid "${loc.value}"`)
            return

          case 'role':
            if (loc.name) {
              await this.page.getByRole(loc.value as any, { name: loc.name, exact: false }).first().click({ timeout: 1500 })
              this.addLog(`  Found by role="${loc.value}" name="${loc.name}"`)
              return
            }
            break

          case 'text':
            await this.page.getByText(loc.value, { exact: false }).first().click({ timeout: 1500 })
            this.addLog(`  Found by text "${loc.value}"`)
            return

          case 'aria':
            await this.page.click(`[aria-label="${loc.value}"]`, { timeout: 1500 })
            this.addLog(`  Found by aria-label "${loc.value}"`)
            return

          case 'placeholder':
            await this.page.getByPlaceholder(loc.value, { exact: false }).first().click({ timeout: 1500 })
            this.addLog(`  Found by placeholder "${loc.value}"`)
            return

          case 'nearby':
            // Find text, then click the nearest matching tag
            const container = this.page.getByText(loc.value, { exact: false }).first()
            const nearby = container.locator(`.. >> ${loc.tag || '*'}`).first()
            await nearby.click({ timeout: 1500 })
            this.addLog(`  Found by nearby text "${loc.value}"`)
            return

          case 'css':
            await this.page.waitForSelector(loc.value, { state: 'visible', timeout: 1500 })
            await this.page.click(loc.value)
            this.addLog(`  Found by CSS "${loc.value.slice(0, 50)}"`)
            return
        }
      } catch {
        // This strategy failed, try next
      }
    }

    // If no locators, fall back to old approach using selector + label
    if (locators.length === 0) {
      this.addLog(`  No locators stored, trying CSS + label fallbacks...`)

      if (action.selector) {
        try {
          await this.page.waitForSelector(action.selector, { state: 'visible', timeout: 1500 })
          await this.page.click(action.selector)
          this.addLog(`  Found by CSS selector`)
          return
        } catch {
          this.addLog(`  CSS selector failed`)
        }
      }

      if (action.label && action.label.length > 1) {
        const label = action.label

        // Quick fallback: just try text match (covers most cases)
        try {
          await this.page.getByText(label, { exact: true }).first().click({ timeout: 1500 })
          this.addLog(`  Fallback: found by text "${label}"`)
          return
        } catch {}

        // Try partial text
        try {
          await this.page.getByText(label, { exact: false }).first().click({ timeout: 1500 })
          this.addLog(`  Fallback: found by partial text "${label}"`)
          return
        } catch {}
      }
    }

    // Try AI healing before giving up
    const allLocators = locators.length > 0 ? locators : (action.selector ? [{ strategy: 'css', value: action.selector }] : [])
    const healed = await this.tryHeal(action, actionIndex, allLocators)
    if (healed) return

    const tried = locators.length > 0 ? locators.map(l => l.strategy).join(', ') : 'css, role, text, aria, has-text'
    throw new Error(`Could not find element (tried: ${tried}): ${action.selector || 'no selector'}${action.label ? ` label="${action.label}"` : ''}`)
  }

  private async extractData(rules: ExtractionRule[]): Promise<ExtractedData> {
    if (!this.page || rules.length === 0) return {}

    const data: ExtractedData = {}
    for (const rule of rules) {
      try {
        if (rule.multiple) {
          const elements = await this.page.$$(rule.selector)
          const values: string[] = []
          for (const el of elements) {
            const val = await this.getElementValue(el, rule.attribute)
            if (val) values.push(val)
          }
          data[rule.name] = values
          this.addLog(`  ${rule.name}: ${values.length} items`)
        } else {
          const el = await this.page.$(rule.selector)
          if (el) {
            data[rule.name] = await this.getElementValue(el, rule.attribute)
            this.addLog(`  ${rule.name}: "${String(data[rule.name]).slice(0, 50)}"`)
          } else {
            data[rule.name] = null
            this.addLog(`  ${rule.name}: not found`)
          }
        }
      } catch (err: any) {
        data[rule.name] = null
        this.addLog(`  ${rule.name}: error - ${err.message}`)
      }
    }
    return data
  }

  private async getElementValue(el: any, attribute: string): Promise<string | null> {
    switch (attribute) {
      case 'text': return el.innerText()
      case 'innerHTML': return el.innerHTML()
      case 'href': return el.getAttribute('href')
      case 'value': return el.inputValue().catch(() => el.innerText())
      default: return el.getAttribute(attribute)
    }
  }

  private classifyError(err: Error): 'site_changed' | 'session_expired' | 'transient' | 'unknown' {
    const msg = err.message.toLowerCase()
    if (msg.includes('timeout') || msg.includes('net::err')) return 'transient'
    if (msg.includes('could not find element') || msg.includes('selector')) return 'site_changed'
    if (msg.includes('login') || msg.includes('sign in') || msg.includes('unauthorized')) return 'session_expired'
    return 'unknown'
  }

  async close(): Promise<void> {
    await this.context?.close()
    await this.browser?.close()
    this.page = null; this.context = null; this.browser = null
  }
}
