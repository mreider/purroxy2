import { BrowserWindow, WebContentsView, ipcMain } from 'electron'
import { store } from './store'

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'

const SYSTEM_PROMPT = `You are Purroxy's AI guide, helping users build browser automations called "capabilities." You are embedded in a desktop app alongside a real browser showing a website.

## CRITICAL RULE: One thing at a time
Each response should advance exactly ONE step. Never combine steps. Never show suggestions AND a login prompt. Never show a record button alongside suggestions. Follow this strict sequence:

## Step-by-step flow

**Step 1 — Login check:**
When first analyzing a page, check if it shows login forms (password fields, "sign in" text, etc.). If YES: tell the user to log in, then click Done. Show ONLY the {{DONE}} button. Say nothing else — no suggestions, no analysis. Keep it to 1-2 sentences.
If NO login is needed: skip to Step 2.

**Step 2 — Analyze & suggest:**
After the user logs in (you'll see "[Session saved]"), OR if no login was needed, analyze the page and suggest 3-5 capabilities. Keep each suggestion to one line. Do NOT include a record button yet. Ask which one they'd like to build, or let them type their own.

**Step 3 — Ready to record:**
Once the user picks a capability, give brief instructions for that specific capability and show {{START_RECORDING}}. Tell them to navigate to the relevant area and demonstrate the workflow. Remind them: explore freely, mistakes are fine.

**Step 4 — Recording analysis:**
When you see "[RECORDING STOPPED]", analyze the captured actions. Summarize what was recorded in a brief bullet list. Show {{SAVE_CAPABILITY}} only — nothing else.

## Tone
- Concise. This is a narrow side panel — 1-3 short sentences max per step.
- Don't micromanage navigation. Say "navigate to the reservations area" not "click the Reports tab."
- Use proper markdown: **bold**, bullet lists with "- " on separate lines.

## Interactive buttons
Embed buttons on their own line:
- {{DONE}} — User clicks after logging in to save their session.
- {{START_RECORDING}} — Only show AFTER the user has chosen a capability.
- {{SAVE_CAPABILITY}} — After analyzing a completed recording. Show this alone — no other buttons alongside it.

IMPORTANT: Never include {{STOP_RECORDING}} or {{KEEP_GOING}} or {{BUILD_ANOTHER}} — those are handled by the app automatically. Never show more than one button per message.

## Awareness
You receive page content and recorded actions as context. Always check what's already been recorded. Never ask the user to do something they've already done.`

export function setupAI(mainWindow: BrowserWindow, getSiteView: () => WebContentsView | null) {

  ipcMain.handle('ai:getPageContent', async () => {
    const siteView = getSiteView()
    if (!siteView) return ''
    try {
      return await siteView.webContents.executeJavaScript(`
        (() => {
          const title = document.title;
          const url = location.href;
          const body = document.body.innerText.slice(0, 3000);
          const forms = Array.from(document.querySelectorAll('input, select, textarea, button, a[href]')).slice(0, 50).map(el => {
            const tag = el.tagName.toLowerCase();
            const type = el.getAttribute('type') || '';
            const name = el.getAttribute('name') || '';
            const placeholder = el.getAttribute('placeholder') || '';
            const label = el.getAttribute('aria-label') || '';
            const text = (el.innerText || '').trim().slice(0, 50);
            return [tag, type, name, placeholder, label, text].filter(Boolean).join(' | ');
          });
          const navLinks = Array.from(document.querySelectorAll('nav a, [role="navigation"] a, header a')).slice(0, 20).map(a => {
            return (a.innerText || '').trim().slice(0, 50);
          }).filter(Boolean);
          return JSON.stringify({ title, url, bodyText: body, formElements: forms, navLinks });
        })()
      `)
    } catch {
      return '{}'
    }
  })

  ipcMain.handle('ai:chat', async (_event, messages: Array<{ role: string; content: string }>, pageContext?: string) => {
    const apiKey = store.get('aiApiKey')
    if (!apiKey) {
      return { error: 'No API key configured. Add your Anthropic API key in Settings.' }
    }

    let system = SYSTEM_PROMPT
    if (pageContext) {
      system += `\n\nCurrent page context:\n${pageContext}`
    }

    try {
      const response = await fetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey as string,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1024,
          system,
          messages: messages.map(m => ({ role: m.role, content: m.content }))
        })
      })

      if (!response.ok) {
        const err = await response.text()
        if (response.status === 401) {
          return { error: 'Invalid API key. Check your key in Settings.' }
        }
        return { error: `API error (${response.status}): ${err.slice(0, 200)}` }
      }

      const data = await response.json()
      return { content: data.content[0].text }
    } catch (err: any) {
      return { error: `Failed to connect: ${err.message}` }
    }
  })

  // Generate structured capability definition from recorded actions
  ipcMain.handle('ai:generateCapability', async (_event, actions: unknown[], chatHistory: Array<{ role: string; content: string }>) => {
    const apiKey = store.get('aiApiKey')
    if (!apiKey) return { error: 'No API key configured.' }

    const system = `You are a capability structure generator. Given recorded browser actions and conversation context, output a JSON capability definition.

Analyze the recorded actions to:
1. Give the capability a short, descriptive name
2. Write a one-sentence description
3. Identify which action values should be PARAMETERS (things that change each run — like search queries, dates, property names) vs FIXED (navigation steps that are always the same)
4. Propose EXTRACTION RULES for data visible on the final page that the user would want returned

Rules for parameters:
- Navigation clicks are almost always fixed (not parameters)
- Text typed into search/filter fields are usually parameters
- Dropdown selections might be parameters if they filter results
- Only mark something as a parameter if it makes sense to vary it

Rules for extraction:
- Look at the final page the user landed on
- Propose extracting visible data like lists, tables, totals, statuses
- Use CSS selectors that would work for the data
- Mark financial/personal data as sensitive

Output ONLY valid JSON in this exact format, no other text:
{
  "name": "Short Capability Name",
  "description": "One sentence describing what this does",
  "parameters": [
    {
      "name": "paramName",
      "description": "What this parameter controls",
      "actionIndex": 3,
      "field": "value",
      "defaultValue": "the recorded value",
      "required": true
    }
  ],
  "extractionRules": [
    {
      "name": "fieldName",
      "selector": "CSS selector",
      "attribute": "text",
      "multiple": false,
      "sensitive": false
    }
  ]
}`

    // Build context from chat history (last few messages for context)
    const recentChat = chatHistory.slice(-6).map(m => `${m.role}: ${m.content}`).join('\n')

    try {
      const response = await fetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey as string,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2048,
          system,
          messages: [{
            role: 'user',
            content: `Recorded actions:\n${JSON.stringify(actions, null, 2)}\n\nConversation context:\n${recentChat}`
          }]
        })
      })

      if (!response.ok) {
        const err = await response.text()
        return { error: `API error (${response.status}): ${err.slice(0, 200)}` }
      }

      const data = await response.json()
      const text = data.content[0].text

      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text]
      const jsonStr = (jsonMatch[1] || text).trim()
      const parsed = JSON.parse(jsonStr)
      return { capability: parsed }
    } catch (err: any) {
      return { error: `Failed to generate capability: ${err.message}` }
    }
  })
}
