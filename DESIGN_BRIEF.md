# Purroxy desktop — design brief

For a designer creating CSS + HTML templates for the Tauri desktop app.
This is an **interaction brief**, not a visual prescription. You own the
look. The doc tells you what every screen has to do, what data it has,
and what states it must handle.

---

## 1. Product in one paragraph

Purroxy lets a user record a browser session once (clicking through a
real website), then re-run that recording later — with the app
automatically repairing small drifts (button moved, label changed). The
re-run is driven by a sandboxed WASM "capability component" that scores
candidate elements when the recorded one isn't found. End user is a
technical-but-not-developer power user (think: ops, customer support,
QA, indie hackers). They want their automations to *keep working* and
to be inspectable.

The desktop app is the **library + control surface** for those
recordings. It's not a code editor. It's not an IDE. It's closer to a
Mac-native "list of things, click to run, see what happened" tool.
Reference vibe: 1Password, Things 3, Raycast settings, Tower. Calm,
dense-but-readable, monospaced where it helps, no marketing fluff.

## 2. Technical constraints

- **Runtime:** Tauri 2 webview (WKWebView on macOS, WebView2 on
  Windows, WebKitGTK on Linux). Modern CSS works; assume Safari-grade
  support, *not* old Edge.
- **No framework yet.** Frontend is a single `index.html` + inline JS.
  Vanilla. We can introduce a framework if you'd rather work in one
  (Svelte / Lit / preact preferred over React for size), but the
  default is "static HTML with progressive enhancement."
- **No bundler step.** Files in `crates/desktop/dist/` ship as-is.
  Inline CSS + JS, or one each: `app.css`, `app.js`. Web fonts OK if
  bundled locally (no CDN).
- **CSP:** locked to `default-src 'self'; script-src 'self'
  'unsafe-inline'; style-src 'self' 'unsafe-inline'`. No external
  resources. No inline `<img src="https://...">`. Use SVG inline or
  local files.
- **Window:** 960×720 default, resizable. Titlebar is OS-default for
  now. Dark mode: respect `prefers-color-scheme`; both modes ship.
- **All privileged actions go through typed Tauri commands** (see §6).
  The frontend never touches the filesystem, the recorder, or Chrome
  directly.

## 3. Scope of this brief

In scope:
- Capability **library** view (list, empty state, error state).
- **Run** flow (trigger replay, show progress, show result).
- **Record** flow (new recording wizard, live status, save/discard).
- Recording **detail** view (steps list, last run, metadata, delete).
- Settings sidebar / pane (library path, Chrome path, component path).
- App-level chrome (sidebar, header, status bar, modals/toasts).

Out of scope (later phases — leave hooks in IA but no real UI yet):
- Sharing / export / import of recordings.
- Bundle (signed `.purroxy` package) install UX.
- MCP server status / Claude Desktop integration UI.
- Multi-window. Multi-user. Sync.

## 4. Information architecture

```
+---------------------------------------------------------+
|  [≡]  Purroxy                              [Settings ⚙] |   ← header
+---------------------------------------------------------+
|                                                         |
|  Recordings (4)                          [+ New ⌘N]     |   ← section header
|                                                         |
|  ┌─────────────────────────────────────────────────┐    |
|  │ login-flow                                       │   |
|  │ example.com · 6 steps · last run 2m ago · ✓     │   |
|  │                                       [Run ▶]    │   |
|  └─────────────────────────────────────────────────┘    |
|  ┌─────────────────────────────────────────────────┐    |
|  │ download-invoice                                 │   |
|  │ acme.app · 12 steps · last run failed (drift)   │   |
|  │                                       [Run ▶]    │   |
|  └─────────────────────────────────────────────────┘    |
|                                                         |
+---------------------------------------------------------+
|  library: ~/Library/.../Purroxy/recordings        idle  |   ← status bar
+---------------------------------------------------------+
```

Single window, one main view at a time. No tabs. Modal overlays for:
- "New recording" wizard (multi-step)
- Recording detail (could be inline expand or modal — your call)
- Settings (sheet from right edge feels right; designer's call)
- Confirmation dialogs (delete, stop recording)

A persistent **status bar** at the bottom shows: library path
(truncated middle), current activity ("idle", "recording…",
"replaying login-flow…"), and a small log icon that opens a recent
log drawer.

## 5. Screens, states, and required affordances

### 5.1 Library (default view)

States to design:
- **Loading** — first paint while `library_info` + `list_capabilities`
  resolve. Should be near-instant; design something that doesn't flash
  ugly if it appears for 50ms.
- **Empty** — no recordings yet. Big primary CTA: "Record your first
  automation." Secondary: link to the README / `DEVELOPMENT.md`.
- **Populated** — list of capability cards (see IA above).
- **Error** — could not read library dir (perm denied, bad path).
  Show the path, the OS error, and a "Open Settings" button to fix.

Each row needs:
- Capability name (primary, large).
- Target site domain (secondary).
- Step count.
- Last-run summary: status (✓ success / ⚠ repaired / ✗ failed / —
  never run) + relative time ("2m ago", "yesterday").
- Primary action: **Run** (single click — no confirm).
- Secondary actions on hover/right-click: Open detail, Rename,
  Duplicate, Delete, Reveal in Finder.

Sorting: most-recently-run first by default. Allow sort by name /
date-created. Filter input at top is acceptable but optional for v1.

### 5.2 New recording wizard (modal)

Triggered by `[+ New]` in header or empty-state CTA.

Steps:
1. **Name + URL.** Two fields. Name is free-text (slugify under the
   hood; show the slug as helper text). URL must be `https://` (warn
   inline on `http`, allow with confirm). Submit = "Start recording."
2. **Recording in progress.** A new Chrome window opens (we spawn it).
   The desktop app shows:
   - Live step counter ("3 steps captured").
   - Last action ("clicked button 'Sign in'").
   - A scrolling list of captured steps, newest at top.
   - Two buttons: **Stop & Save** (primary), **Discard** (secondary,
     red, requires confirm).
   - Note: user spends most of their attention in the Chrome window,
     not in our app. This screen is a "monitor" not a "control."
3. **Saved.** Confirmation toast or screen ("Saved login-flow · 6
   steps · run it now?"). Two buttons: **Run now** / **Done**.

Design must handle:
- Recorder process crashes mid-recording → show error, offer to
  discard partial.
- User closes the Chrome window before clicking Stop → recorder
  auto-finalizes; treat as Stop.
- User clicks Stop while no steps captured → confirm "Save empty
  recording?" or default to Discard.

### 5.3 Recording detail

Trigger: click capability row (not the Run button).

Shows:
- Header: name (editable inline), target site, created/updated
  timestamps, capability ID (short, monospaced, copyable).
- Steps list: ordered, each step shows the action (click / type /
  navigate), the intent (role + accessible name), and a thumbnail
  of the step snapshot if we have one.
- Last run panel: outcome, duration, per-step result, "repaired"
  badge where the WASM scorer kicked in.
- Danger zone: Delete recording (confirm), Re-record (confirm —
  destroys current).

### 5.4 Run-in-progress overlay

When the user clicks Run on a row:
- The row's Run button becomes a spinner / "Running…" state.
- A small persistent overlay (toast at bottom-right or sticky panel)
  shows current step ("Step 3 of 6: clicking 'Sign in'").
- On completion: row updates to its new last-run state. Overlay
  dismisses to a result toast: "✓ login-flow ran in 4.2s" with a
  "View details" link (opens recording detail with last-run panel
  scrolled into view).
- On failure: overlay turns red, toast persists with error reason
  + "View details."

The user can keep working in the library while a run is in progress.
Multiple concurrent runs are allowed — the toast stack handles it.

### 5.5 Settings

Sections:
- **Library** — path (read-only display + "Change…" button → native
  folder picker), "Reveal in Finder," "Open in Terminal."
- **Chrome** — path to Google Chrome binary (default shown, override
  field).
- **Capability component** — path to the WASM repair component
  (default shown, override). Power-user setting; collapse by default.
- **Appearance** — system / light / dark.
- **Diagnostics** — "Copy debug info" (versions, paths, last error),
  "Open log directory."

No account, no sync, no telemetry toggle in v1 (we don't collect
telemetry yet). Don't design for them.

## 6. Data contracts (what the frontend gets from Rust)

These are the IPC commands the frontend can call. The shapes are
authoritative — design around them, don't invent fields.

```ts
// Today (Stage A, shipped):
invoke('library_info'): Promise<{ root: string; count: number }>
invoke('list_capabilities'): Promise<CapabilityListItem[]>
invoke('run_capability', { name: string }): Promise<RunRecord>

// Coming next (Stage B+, design for these):
invoke('start_recording', { name: string; url: string }): Promise<{ recording_id: string }>
invoke('stop_recording', { recording_id: string }): Promise<{ saved: boolean; capability: CapabilityListItem | null }>
invoke('discard_recording', { recording_id: string }): Promise<void>
invoke('delete_capability', { name: string }): Promise<void>
invoke('rename_capability', { from: string; to: string }): Promise<void>
invoke('reveal_in_finder', { name: string }): Promise<void>
invoke('settings_get'): Promise<Settings>
invoke('settings_set', { key: string; value: string }): Promise<void>

// Streamed events (Tauri event channel, not invoke):
event 'recorder:step'   payload: { recording_id, step_index, action, intent }
event 'recorder:error'  payload: { recording_id, message }
event 'recorder:closed' payload: { recording_id, exit_code }
event 'replay:step'     payload: { capability, step_index, status }
event 'replay:done'     payload: { capability, run_record }

interface CapabilityListItem {
  name: string;        // unique within library
  target_site: string; // e.g. "example.com"
  steps: number;
  dir: string;         // absolute path; do NOT show in UI by default
  last_run?: {
    at: string;        // ISO timestamp
    status: 'success' | 'repaired' | 'failed';
    duration_ms: number;
    reason?: string;   // failure reason
  };
}
```

If a field is missing from this list, you can't rely on it. Tell us
what extra data the design needs and we'll add the command.

## 7. Visual / interaction rules

- **Density:** moderate. Closer to Things 3 than Notion. Closer to
  Tower than VS Code. The user has 4–40 recordings, not 4000.
- **Typography:** system stack by default. A subtle monospaced font
  (SF Mono / JetBrains Mono / Berkeley Mono) for paths, IDs,
  selectors, log output.
- **Color:** restrained. One accent color used sparingly. Status
  colors: green / amber / red, but desaturated — this is a tool, not
  a dashboard.
- **Motion:** quick and minimal. Step-list reveals can ease in.
  Spinners only when an action takes >250ms. No bouncing. No
  parallax.
- **Affordances:** primary action per row is unmistakable. Secondary
  actions appear on hover / right-click; do not clutter the resting
  state.
- **Dark mode:** treat as a first-class theme, not an inversion.
- **Accessibility:** keyboard-first. ⌘N new recording, ⌘R run focused,
  ⌘, settings, Esc closes modal, Enter confirms primary, ⌘⌫ delete.
  Visible focus rings. ARIA roles where it matters.

## 8. Things NOT to do

- Don't introduce a heavy CSS framework (Tailwind config is fine if
  you prefer; Bootstrap is not). Plain CSS or one tiny utility lib.
- Don't add icon fonts. Use inline SVG (we can ship a small icon set).
- Don't fetch from the internet. Everything local.
- Don't design a dashboard. There are no charts. There are no KPIs.
- Don't design a "marketplace." We don't have one.
- Don't design a code editor. Steps are inspected, not edited.
- Don't redesign the menu bar or window chrome. OS-default.

## 9. What we'll deliver to you

- This brief.
- The current `index.html` (so you can see what works today and rip
  it out).
- The Rust IPC surface (this doc, §6).
- Sample data: a few real recordings dumped to JSON so you can
  populate the design realistically.
- Real screenshots of the current empty / populated / running states.
- Any brand assets we have (logo, name treatment) — minimal; assume
  you may need to design a wordmark.

## 10. What we want back

- Figma file (or equivalent) covering: library populated, library
  empty, library error, new-recording wizard (3 steps), recording
  in progress, recording detail, settings, run overlay states,
  delete-confirm modal, light + dark.
- A working `dist/` directory: `index.html`, `app.css`, `app.js`,
  any local assets. Wired to the IPC commands in §6 (mock the not-
  yet-built ones; we'll cut them over).
- A short style guide: type scale, spacing scale, color tokens,
  motion tokens. As CSS custom properties on `:root`.

## 11. Open questions for the designer

1. Empty state CTA: in-app wizard, or a deep-link out to a docs
   page that walks through the CLI? (Lean: in-app, even if behind a
   "coming soon" button for now.)
2. Recording-in-progress: do we need a step-by-step preview pane, or
   just a counter + last action? (Lean: counter + last action; full
   list is in detail view after save.)
3. Run history: keep last N runs per capability or just the last
   one? (Lean: last 10, but only the last one shown by default.)
4. Where does the "this run was repaired" detail live? Inline in
   the result toast, or only in detail view?

## 12. Reference points

- **1Password 8** — calm sidebar + list density + status indicators.
- **Things 3** — type, spacing, restraint.
- **Raycast settings** — keyboard-first, command palette feel.
- **Tower** — monospaced data woven into a Mac-native shell.
- **Linear** — dark mode that isn't an inversion; status pills.

Avoid:
- **Postman / Insomnia** — too API-tool, too cluttered.
- **VS Code** — too IDE.
- **Zapier** — too marketing-y.
