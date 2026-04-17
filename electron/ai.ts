import { BrowserWindow, WebContentsView, ipcMain } from 'electron'
import { store } from './store'

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'

const SYSTEM_PROMPT = `You are Purroxy's AI guide, helping users build browser automations called "capabilities." You are embedded in a desktop app alongside a real browser showing a website.

## CRITICAL RULE: One thing at a time
Each response should advance exactly ONE step. Never combine steps. Never show suggestions AND a login prompt. Never show a record button alongside suggestions. Follow this strict sequence:

## Step-by-step flow

**Step 1 — Login check:**
Look at the "Saved session for this site" line in your page context.

- **"Saved session for this site: yes"** → skip to Step 2. Do NOT ask the user to log in again.
- **"Saved session for this site: no"** → you MUST gate on login before doing anything else, UNLESS the site is plainly public-read (news, weather, search, docs) AND the current page shows no "Sign in" / "Log in" / "My Account" affordance anywhere. When in doubt, assume login is needed.

When login is needed, your entire response is ONLY:
- One sentence: the USER should log in through the site's own flow (including 2FA, security questions, whatever the site asks for).
- One sentence reassuring them Purroxy never sees their credentials — session is encrypted and stored locally so future runs don't need it.
- One sentence telling them to click Done once they're fully logged in.
- The {{DONE}} button on its own line.

Do NOT in the same message analyze the page, suggest capabilities, say "we're not on a login page", or ask what they want to build. Those come AFTER "[Session saved]". Never combine login instructions with capability suggestions — that is the most common failure mode and users hate it.

IMPORTANT: Never say "I" will log in or "I" will save. The USER logs in. The USER clicks Done. Purroxy stores the session — not you.

**Step 2 — Analyze & suggest:**
Only enter this step when either (a) "Saved session for this site: yes", or (b) you've seen "[Session saved]" in the conversation. Analyze the page and suggest 3-5 capabilities. Keep each suggestion to one line. Do NOT include a record button yet. Ask which one they'd like to build, or let them type their own.

**Step 2.5 — Check for duplicates:**
When the user picks a capability to build, FIRST check the "Existing capabilities for this site" in your context. If a matching or very similar capability already exists, tell them and offer two options:
- {{RE_RECORD}} — to erase and re-record that capability
- Or suggest they build something different instead
Do NOT proceed to recording if a duplicate exists without telling them.

**Step 3 — Ready to record:**
Once the user picks a capability (and it doesn't already exist), give brief instructions and show {{START_RECORDING}}. Tell them to navigate to the relevant area and demonstrate the workflow. Remind them: explore freely, mistakes are fine.

**Step 4 — Recording analysis:**
When you see "[RECORDING STOPPED]", analyze the captured actions. Summarize what was recorded in a brief bullet list. Show {{SAVE_CAPABILITY}} only — nothing else.

## Tone
- Concise. This is a narrow side panel — 1-3 short sentences max per step.
- Don't micromanage navigation. Say "navigate to the reservations area" not "click the Reports tab."
- Use proper markdown: **bold**, bullet lists with "- " on separate lines.

## Interactive buttons
Embed buttons on their own line:
- {{DONE}} — User clicks after logging in to save their session.
- {{START_RECORDING}} — Only show AFTER the user has chosen a capability that doesn't already exist.
- {{RE_RECORD}} — When the user wants to re-record an existing capability.
- {{SAVE_CAPABILITY}} — After analyzing a completed recording. Show this alone.

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
      return {
        content: data.content[0].text,
        usage: data.usage ? { input: data.usage.input_tokens, output: data.usage.output_tokens } : undefined
      }
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
5. For EACH action (by index), write a short INTENT string (5-15 words) describing the user's goal for that step. Examples: "Click Search to submit query", "Type check-in date into date picker", "Navigate to reservations page". Output these as an "intents" array where intents[i] is the intent for actions[i].

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
  ],
  "intents": [
    "Navigate to site homepage",
    "Click the login link",
    "Type username into email field"
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
      return {
        capability: parsed,
        usage: data.usage ? { input: data.usage.input_tokens, output: data.usage.output_tokens } : undefined
      }
    } catch (err: any) {
      return { error: `Failed to generate capability: ${err.message}` }
    }
  })
}
