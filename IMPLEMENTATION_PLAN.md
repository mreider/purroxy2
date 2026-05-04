# Purroxy v2.0 — Implementation Plan

**Version:** 0.1
**Last updated:** 2026-05-04
**Companion to:** PRD v2.0
**Audience:** future self, future contributors

---

## 0. About this plan

This plan turns PRD v2.0 into a sequenced engineering roadmap. It assumes a single solo founder ramping into Rust from a TypeScript/Electron baseline. It does not assume a hire, an external Rust expert, or a runway extension; if any of those happen, the plan compresses but does not change shape.

Time estimates are ranges, not commitments. Anywhere a phase exceeds its range, the issue is investigated before the next phase begins; estimate slippage that compounds across phases is the failure mode that ends rewrites.

The plan ships an internally usable tool by end of Phase 3 (command-line replay+repair) and a v2.0 release candidate by end of Phase 8. Total active engineering: 37–54 weeks. Realistic wall-clock: 9–13 months.

---

## Phase 0 — Spike & validate (4–6 weeks)

**Goal.** Prove the four core moving parts (`wasmtime`, `chromiumoxide`, MCP server, WIT contract) coexist in one Rust process and round-trip data end to end. Throwaway code; the artifact is the lessons.

**Work.**
- Hello-world Rust binary with `cargo new`. Get comfortable with the toolchain, error types, async runtime choice (`tokio`).
- Embed `wasmtime` and instantiate a trivial Rust-compiled WASM component. Call one exported function. Pass in a struct, get one back.
- Use `chromiumoxide` to launch a bundled headless Chromium, navigate to `example.com`, click the "More information..." link, return the new URL.
- Stand up a stub MCP server (any Rust crate; the surface is small) that lists three fake capabilities and returns hard-coded results when called.
- Throwaway WIT file with one export (`score-candidate(input: string) -> u32`) and one host import. Compile via `cargo-component`. Verify the host invokes the export and the import works.

**Deliverable.** A 1–2k-line Rust prototype. Not committed to `main`; lives on a `spike/` branch and is read for lessons, not merged.

**Gate to Phase 1.** Can call a WASM component export from the host AND click a button in headless Chromium AND respond to an MCP `tools/call` in the same process, in one demo session, without crashing.

**What this surfaces.**
- Rust async runtime ergonomics under realistic load.
- `chromiumoxide` rough edges (less battle-tested than Playwright).
- WASM component build-time and instantiation cost on this machine.
- Realistic Phase 1+ velocity for a Rust-ramping solo founder.

---

## Phase 1 — WIT contract + reference component (4–6 weeks)

**Goal.** Lock the `purroxy:capability/v1` contract. Once published this is the API you live with for the v1 line; six-month deprecation per PRD §10. Get it right.

**Work.**
- Design `wit/capability.wit` (the world capability components implement). Concrete shapes for `param-set`, `page-snapshot`, `element-handle`, `step-intent`, `scored-candidate`, `output`, and the structured error variants per PRD §5.
- Design `wit/host.wit` (the interface components import from the host). DOM-shape queries, regex matching, structured logging, monotonic clock.
- Build a `cargo-component` reference capability ("click submit on a toy form") that exercises every export. This is the contract test fixture for the life of v1.
- Write WIT contract tests in Rust against the reference component using `wasmtime`'s test harness.
- Write a fuzz harness that feeds adversarial `page-snapshot`, `param-set`, and `element-handle` inputs into the reference component and asserts no panics, no resource exhaustion, no redaction leakage.
- Document the contract in `wit/README.md` with examples in Rust, then later TinyGo and componentize-py.

**Deliverable.** Stable `wit/capability.wit` v1.0.0 and `wit/host.wit` v1.0.0. Reference component crate. Contract test crate. CI green on all three platforms.

**Gate to Phase 2.** WIT compiles cleanly via `wit-bindgen`; reference component fuzz-clean for at least 24h on a soak run; contract tests cover every export with at least the success path and one structured-error path.

**Risk.** Once committed, breaking changes cost six months. Take the time.

---

## Phase 2 — Browser layer + recording capture (6–8 weeks)

**Goal.** Replicate v1's recording-and-replay model in Rust. This is the highest-risk phase by far.

**Work.**
- Wrap `chromiumoxide` with the operations the host needs (launch, navigate, click, type, screenshot, accessibility-tree fetch, viewport control, file upload, scroll-to-element).
- Inject a CDP-attached JS shim into every navigated page (via `Page.addScriptToEvaluateOnNewDocument`) that captures DOM events the user generates: clicks, inputs, dropdowns, file uploads, scroll-driven loads, navigation. The shim translates raw events into intent records (target role, accessible name, structural anchor, surrounding context).
- Translate captured intents into `recorded-step` records and persist alongside before/after page snapshots.
- Implement the canonical-serializer for `page-snapshot` per PRD §5: stable node ordering, sorted attribute keys, no host-time-of-capture, no PRNG-derived fields.
- Iframe and shadow-DOM capture: nested CDP frame trees, shadow root traversal via accessibility tree where possible.

**Deliverable.** Command-line tool: `purroxy record <site>` produces a `recording.json` plus `snapshots/` directory. No UI. Internal use only.

**Gate to Phase 3.** Can record a 5-step capability on a site with iframes (Yahoo Mail or similar) and produce a replayable recording with byte-exact canonical snapshots across two recording attempts of the same flow.

**Risks.**
- Recording without a JS framework like Playwright is genuinely hard. iframes, shadow DOM, dynamic content, autocomplete dropdowns, custom date pickers, virtualized scrolling. Budget conservatively.
- `chromiumoxide` is less battle-tested than Playwright. May need to upstream patches; reserve a week for that contingency.
- Canonical serialization is fiddly. Diff two snapshots from "same" recording sessions and find every nondeterminism.

---

## Phase 3 — Replay + repair (4–6 weeks)

**Goal.** Replay a recording end-to-end with component-mediated `preflight`/`postflight`/`score-repair-candidates` and host-side structural checks (PRD §9.4). First internally-usable Purroxy v2.0 deliverable.

**Work.**
- Replay engine: read recording, instantiate component in fresh `wasmtime` `Store`, run `validate-params`, then per step call `preflight`, perform CDP action, call `postflight`, and proceed.
- Host-side structural preflight and postflight: independent of component output, evaluated against recording-time expectations from the manifest.
- Repair flow: when a step fails, host filters candidates by recording-time intent; component scores; host accepts top candidate iff threshold + structural intent re-check + top-N rank.
- Run record persistence: per-step inputs/observations/outcomes, repair attempts, fuel consumed, final outputs.
- Per-run resource budgets (memory cap, fuel cap, wall-clock cap) enforced in `wasmtime`.

**Deliverable.** Command-line tool: `purroxy run <recording> [--params ...]` replays and produces a run record. Auto-repair works.

**Gate to Phase 4.** Replay+repair works on three real sites end-to-end (e.g. a webmail, a banking-site read-only flow, a flight search). At least one repair scenario successfully recovers from a planted DOM change.

---

## Phase 4 — Tauri UI (6–10 weeks)

**Goal.** Port v1's renderer to a Tauri shell. v1 GUI feature-parity at the UI level.

**Work.**
- Set up Tauri project. Decide whether to keep v1's frontend stack (React + Vite) or refresh; default is keep, because rewriting UI is not on this rewrite's path.
- Port v1's renderer screens: capability list, builder wizard, run record viewer, vault management, settings.
- Define the Tauri IPC command allowlist (PRD §9.8). Every privileged action is a typed Rust command; no general "evaluate Rust from JS" surface.
- Wire IPC commands to the host's record/run/manage capabilities.
- Per-platform polish: macOS (notarization, system tray, keyboard shortcuts), Windows (Authenticode, system tray), Linux (WebKitGTK quirks — the weakest leg of Tauri's three-platform story).

**Deliverable.** GUI Purroxy v2.0 reaching feature parity with v1 for the build-and-replay flows.

**Gate to Phase 5.** A user can build, save, run, and inspect a capability entirely through the GUI on each of the three platforms.

**Risks.**
- WebKitGTK lags WebView2 and WKWebView in features and stability. Anything depending on bleeding-edge web APIs needs a fallback path.
- IPC allowlist discipline is easy to lose during rapid UI iteration. Code review every new IPC command for capability scope.

---

## Phase 5 — Vault, sessions, app lock, signing key (3–4 weeks)

**Goal.** Wire in security primitives.

**Work.**
- OS keychain integration: `keyring-rs` or platform-specific crates. Vault, session storage, and bundle signing key go through the same keychain abstraction.
- Bundle signing: Ed25519 (`ed25519-dalek`). Public key embedded in bundle; signature covers manifest + recorded steps + WASM component + assets. Verify on install and on every load.
- App lock: PIN, inactivity timeout, system-event hooks (lock on screen lock, lock on sleep). Lock state gates every privileged operation including MCP calls.
- Sensitive-data scrubber: takes a string, returns the same string with vault values replaced by sentinels. Used as the host-side belt-and-braces (PRD §7.2, §9.2).

**Deliverable.** Security primitives hooked into the rest of the app. Tests assert: no vault value reaches the AI under any path tested; signed bundles fail to load on tampered bytes; locked app refuses every action.

**Gate to Phase 6.** Security regression tests pass; manual review of every code path that handles credentials, sessions, or vault values.

---

## Phase 6 — MCP server + AI integration (3–4 weeks)

**Goal.** AI assistants can list and call capabilities over MCP.

**Work.**
- MCP server crate (current ecosystem: `rmcp` or equivalent; pick the one that's actively maintained at this point).
- Three tools: `purroxy_list_capabilities`, `purroxy_run_capability`, `purroxy_status` per PRD §0.
- AI-guided building: the builder wizard talks to the user's configured AI provider (their own key, per PRD §11) for "what could you automate on this page" suggestions and run-time repair assistance.
- Lock check per MCP call. Capability-paused check. Subscription validity check.

**Deliverable.** Working MCP integration with Claude Desktop and Claude Code. End-user can ask Claude "check my Yahoo Mail" and Claude calls the capability, receives the redacted result, and presents it.

**Gate to Phase 7.** MCP round-trip works on all three platforms. AI-guided building demonstrably helps a user build a working capability faster than no AI.

---

## Phase 7 — Community library + registry signing (4–6 weeks)

**Goal.** Backend integration: contributors can publish; users can install.

**Work.**
- Cloudflare Workers integration: the v1 backend is preserved as PRD §0 specifies. Update the host's HTTP client (now `reqwest`) to talk to the same endpoints.
- Capability submission flow: contributor uploads bundle; CI runs static + fuzzed-dynamic checks per PRD §6.6; passing bundles are added to the registry.
- Registry signing key in CI: hardware-backed via GitHub Actions OIDC + `actions/attest-build-provenance`. No keys on contributor machines.
- Install flow: browse, install, signature-verify, set up site profile, prompt for session login and vault references.
- Update flow: pinned per install; user consent on update; verification on every load.

**Deliverable.** End-to-end community library round-trip: a contributor publishes a Yahoo Mail capability, another user installs it, runs it with their own session, and gets results.

**Gate to Phase 8.** A capability submitted by a non-developer test user is accepted by the automated review and installs cleanly on a different test machine.

---

## Phase 8 — Ship polish (2–3 weeks)

**Goal.** Ship-ready v2.0 release candidate.

**Work.**
- Auto-update channel: differential updates (host binary deltas + Chromium deltas). Use `bsdiff` or platform-native equivalents.
- Landing page + docs updated to reflect v2.0. `gh attestation verify` instructions still work; the verification command does not change.
- Code signing + notarization wired into release CI for macOS / Windows / Linux.

**Not in scope.** v1→v2 capability migration. v0.1.0 shipped without acquiring users before the architecture pivot, so v2.0 ships into a clean install for everyone. If users ever land on v0.1.x before v2.0 ships, a converter crate gets reintroduced.

**Deliverable.** Tagged v2.0 release candidate.

**Gate to Phase 9.** v2.0 RC installs cleanly on a fresh machine on each platform.

---

## Phase 9 — Beta + iterate (open-ended)

**Goal.** Ship.

**Work.**
- Internal dogfooding: replace personal v1 install with v2.0 RC. Run on it daily for at least two weeks before opening external beta.
- External beta: invite v1 power users; set up a feedback channel.
- Bug fixes; performance tuning; UX rough-edges.
- Public v2.0 release when beta-blocking-bug count hits zero and the §12 metrics on internal dogfood show parity-or-better against v1.

**Deliverable.** Public v2.0.

---

## Decision gates between phases (recap)

| From → To | Must demonstrate |
|-----------|------------------|
| 0 → 1 | wasmtime + chromiumoxide + MCP coexist in one process |
| 1 → 2 | WIT contract stable; reference component fuzz-clean |
| 2 → 3 | 5-step capability records and replays byte-exact across attempts |
| 3 → 4 | Replay+repair works on three real sites end to end |
| 4 → 5 | Full GUI feature parity with v1 builder on all three platforms |
| 5 → 6 | Security regression tests pass; manual code path review done |
| 6 → 7 | MCP round-trip with Claude works on all three platforms |
| 7 → 8 | Community library round-trip works between two test users |
| 8 → 9 | v2.0 RC installs cleanly on a fresh machine each platform |

---

## Sequencing rationale

- **Phase 0 first** because hidden integration pain kills all later estimates if found late.
- **Phase 1 before Phase 2** because the WIT contract shape constrains snapshot serialization and recorded-step format.
- **Phase 2 before Phase 3** because there's nothing to replay until there's something recorded.
- **Phase 4 (UI) deferred until 5** because the host is still moving in Phase 4; porting UI before the host stabilizes means redo. Lock the host first, then write the UI against it once.
- **Phase 5 inside the build phases**, not at the end, because security primitives gate UI flows that need them (vault management UI, signing-key onboarding).
- **Phase 6 (MCP) before Phase 7 (community library)** because internal AI integration validates the run-time path; the community library adds publishing/distribution on top of a known-working run.
- **Phase 7 last among build phases** because the community library is leverage but not gating for first ship: you can ship v2.0 and add the library a week later without breaking users.
- **Phase 8 ship polish only** because v0.1.0 has no users to migrate (see Phase 8 "Not in scope"). The slot stays in the plan as the release-engineering pass before beta.

---

## Risks not in PRD

- **Tauri's Linux story is the weakest leg.** WebKitGTK lags both WebView2 and WKWebView. Plan a Linux-specific test pass at the end of Phase 4.
- **`chromiumoxide` is less mature than Playwright.** May require upstream patches; reserve buffer time in Phase 2.
- **Recording iframe and shadow-DOM content via raw CDP without a JS framework like Playwright is hard.** Phase 2 is the highest-risk phase by far.
- **Solo Rust ramp.** Phase 0 estimate could double if Rust is brand new. Honest self-assessment after Phase 0 informs whether to revise the rest of the schedule.
- **Bundled Chromium update churn.** Differential updates are required. The auto-update path needs Chromium-version awareness from day one in Phase 8.
- **WIT v1 contract is forever (within v2.0).** Six-month deprecation per PRD §10 means Phase 1 cannot be rushed.
- **Backend-side ops drift.** The Cloudflare Workers backend stays the same code, but the team operating it (you) needs to keep up with Wrangler / Workers runtime updates while heads-down on the host rewrite. Schedule a half-day per quarter for backend hygiene.

---

## What ships first internally

- **End of Phase 0:** spike branch read for lessons.
- **End of Phase 3:** command-line replay+repair, internal dogfooding only.
- **End of Phase 4:** GUI v2.0, internal dogfooding only.
- **End of Phase 6:** GUI v2.0 with MCP, AI-callable, internal dogfooding only.
- **End of Phase 8:** v2.0 RC.
- **End of Phase 9:** public v2.0.

---

## What this plan does not commit to

- A specific calendar date for v2.0 GA. The §0 framing of "multi-quarter, not 2026" stands; calendar dates wait until Phase 0 and Phase 1 are behind us and the schedule has real evidence.
- A hire. If a hire happens, this plan compresses but doesn't change shape.
- Feature additions beyond v1 parity. v2.0 is an architecture rewrite; features ride on v2.x.
- A pricing rollout. PRD §11 governs that; nothing in this plan introduces pricing decisions.
