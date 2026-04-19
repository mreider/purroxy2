# Browser Engine Pivot Plan

**Status:** Phase 0 complete on `refactor/browser-engine-interface`. Phases 1–3 not started.

## Background

Purroxy today uses two Chromium-based browsers:
- **Recording:** Electron's embedded `WebContentsView` in the main `BrowserWindow`.
- **Replay:** `playwright.chromium` (bundled Chromium) via `core/browser/playwright-engine.ts`.

Against sites protected by advanced bot-mitigation stacks (Shape/F5, Akamai Bot Manager), both browsers are detectable. United Airlines is the motivating case.

## Spike results

- **Spike 1 — `scripts/spike-electron-replay.mjs`:** raw Electron-Chromium + CDP at united.com login → fails with "Something went wrong." Electron's Chromium fingerprint is flagged by Shape/F5 regardless of CDP usage.
- **Spike 2 — `scripts/spike2-patchright-chrome.mjs`:** `patchright` + `channel: 'chrome'` + `launchPersistentContext` → login succeeds, `AuthCookie` + Akamai cookies (`_abck`, `bm_sz`, `bm_so`, `bm_sv`) issued, session persists through programmatic `page.goto`.

**Decision:** pivot both recording and replay off Electron-Chromium + bundled Playwright-Chromium, onto **Patchright driving the user's real installed Chrome**.

The recording window can't stay in Electron — it has the same fingerprint problem as spike 1. Purroxy becomes "the tool that drives your real Chrome," not "a browser inside an app."

## Open decisions (block Phase 2, not Phase 0/1)

1. **Session storage approach.** Options:
   1. Raw profile dir with FS perms only — violates PRD §7 "encrypted at rest."
   2. Encrypt whole profile dir at idle — strongest; handles IndexedDB and service workers.
   3. Export cookies + localStorage, encrypt, discard profile dir — preserves today's `SiteSession` shape and `crypto.ts` path. **Recommended default.**

2. **Chrome-not-installed fallback.** Block the app with an install prompt, or fall back to bundled Chromium (defeats the point for bot-detected sites)?

3. **Window relationship UX.** Does the Purroxy main window shrink when the embedded browser goes away, or stay full-size with guide + live preview alongside the floating Chrome window?

4. **macOS two-dock-icon acceptance.** Running a child Chrome means two dock icons during a session. Acceptable, or does it need an `LSUIElement`-style workaround?

5. **Viewport setting.** Spike 2 used `viewport: null` (let Chrome size naturally); today we persist per-capability viewports. Advisory only under ChromeEngine, or honored?

## Surprises found during planning

- `electron/ai.ts` also reads the embedded DOM for the AI guide — not just the executor/recorder. Must route DOM reads through the new engine.
- `electron/executor.ts` and `electron/mcp-api.ts` duplicate the engine-driving block (~90 lines). Phase 0 de-dupes this as a free byproduct of the interface extraction.
- Preload IPC handler names (`window.purroxy.browser.*`, `.recorder.*`) must be preserved across the pivot to avoid renderer churn.
- Hardened runtime / notarization risk: spawning Chrome from a notarized app bundle may need entitlement changes in `build/entitlements.mac.plist`. Verify in Phase 1, not Phase 3.
- `electron/main.ts` has no orderly shutdown of the browser engine today — needs wiring regardless.

## Architecture

### `BrowserEngine` interface

Six methods, already extracted in Phase 0 (`core/browser/browser-engine.ts`):

```ts
interface BrowserEngine {
  setHealer(fn: HealerFn): void
  launch(options: BrowserEngineOptions): Promise<void>
  execute(actions, parameters, paramValues, extractionRules): Promise<ExecutionResult>
  getHealedLocators(): Array<{ actionIndex: number; locator: Locator }>
  close(): Promise<void>
}
```

Plus `createBrowserEngine(kind: BrowserEngineKind)` factory. Callers don't know which impl they got.

### Recording capture mechanism (Phase 2)

Inject the existing 273-line `CONTEXT_SCRIPT` via Patchright's `addInitScript` (Playwright-equivalent of CDP `Page.addScriptToEvaluateOnNewDocument`), drain captured events by polling `page.evaluate` on the `__purroxyClickQueue`. Chrome re-runs init scripts on every commit, simplifying today's `did-finish-load` re-injection loop.

**Caveat:** iframe subframe behavior for `addInitScript` needs verification — spike didn't test iframes.

### Chrome process lifecycle

- `userDataDir` per site under `app.getPath('userData') + '/chrome-profiles/{siteId}'` — no conflict with user's real Chrome, per-site isolation for free.
- `context.on('close')` → recorder stops, notifies main.
- `app.on('before-quit')` → `await context.close()` on any open ChromeEngine. Add regardless of engine — today's Playwright shutdown isn't orderly either.

### Session / cookie storage (Phase 2)

Default to option 3 from "Open decisions": export cookies via `context.cookies()` and localStorage via `page.evaluate`, encrypt via existing `crypto.ts` `safeStorage` path, discard the profile dir. Bot-mitigation cookie stripping (`action-utils.ts:normalizeCookiesForInjection`) keeps working and remains necessary.

### Test migration

- **Executor + mcp-api tests (~1,100 lines):** already mock the engine class; switch mock target to `createBrowserEngine`. ~1 hour.
- **`tests/core/playwright-engine.test.ts` (1,294 lines):** keep while PlaywrightEngine ships behind the flag. Mirror in `tests/core/chrome-engine.test.ts` with `tests/setup/patchright-mocks.ts` (nearly identical to the Playwright mocks — same `chromium` API surface).
- Pure utilities (`substituteParams`, `optimizeActions`, cookie normalization) are already in `core/browser/action-utils.ts` and should be tested there once.
- **New integration tier:** `tests/integration/chrome-engine.integration.test.ts`, gated by `RUN_INTEGRATION=1`, actually launches Chrome.

## Phased rollout

### Phase 0 — Interface extraction + test refactor ✅ DONE

- **Files:** `core/browser/browser-engine.ts` (new), `core/browser/action-utils.ts` (new), `core/browser/playwright-engine.ts` (implements interface, imports utils), `electron/executor.ts` + `electron/mcp-api.ts` (use factory).
- **Tests:** all 427 tests pass unchanged. Vitest module mocking transparently intercepts `playwright-engine` through the factory.
- **Rollback:** revert one commit.

### Phase 1 — ChromeEngine for replay, behind feature flag (~3–5 days)

- **Files:** `core/browser/chrome-engine.ts` (new, ~400–500 lines), `electron/store.ts` (add `replayEngine` setting), settings UI toggle.
- **Default:** `'playwright'`. Opt-in: `'chrome'`.
- **Tests:** new `tests/core/chrome-engine.test.ts` at minimum parity (~50 tests); one integration test gated by env var.
- **Kill switch:** setting toggle.
- **Pre-ship check:** run `npm run package` on macOS to catch notarization / entitlement issues before Phase 3.

### Phase 2 — ChromeEngine for recording + UX shift (~5–8 days)

- **Files:** `electron/chrome-recorder.ts` (new, mirrors `recorder.ts`), `electron/chrome-browser-view.ts` (new, replaces the embedded browser for `recordingEngine === 'chrome'`), `electron/main.ts` (conditional wiring), `src/views/Builder.tsx` (no-embedded-browser UX).
- **Session capture:** `context.cookies()` + `page.evaluate(() => ({ ...localStorage }))`, encrypt via existing path.
- **Separate setting:** `recordingEngine: 'electron' | 'chrome'`. Independent of replay engine so chrome-replay + electron-record is a valid fallback if recording regresses.
- **Blocked on:** open decisions 3 + 4 (UX).

### Phase 3 — Removal (~2 days)

- **Trigger:** N weeks stable with both settings defaulting to `'chrome'`.
- **Delete:** `core/browser/playwright-engine.ts`, `electron/browser-view.ts`, `electron/recorder.ts`, `WebContentsView` usage in `electron/ai.ts`, the `playwright` runtime dep, and their tests/mocks.
- **Rollback:** revert the removal commit; the engine factory stays in place.

## Risks + earliest cheap signals

- **Patchright still fails on a different bot-detection stack (Cloudflare Turnstile, DataDome).** Cheap signal: spike scripts against those vendors before Phase 1 merges.
- **`addInitScript` misses pre-DOMContentLoaded navigations on SPAs.** Cheap signal: Phase 2 unit test on pushState click capture.
- **Session export/reimport doesn't roundtrip** (service workers, IndexedDB). Cheap signal: Phase 1 integration test — login → export → relaunch → verify still-authenticated.
- **Chrome zombie processes.** Cheap signal: teardown test asserts Chrome process count stable over 10 runs.
- **UX confusion tanks capability completion rate.** Cheap signal: dogfood with 2–3 users before Phase 2 merges.
- **macOS notarization blocks spawning Chrome from bundled app.** Cheap signal: run `npm run package` in Phase 1, not Phase 3.
