# Purroxy — Product Requirements Document

**Version:** 2.0 (WASM-native architecture)
**Last updated:** 2026-05-04
**Supersedes:** PRD v1.0
**Tagline:** Record what you do on any website. Securely automate it forever.

---

## 0. About this rewrite

Purroxy v1.0 is an Electron + TypeScript desktop app with a Vite-based renderer, a Node main process driving an embedded Chromium browser, and a Cloudflare Workers backend handling licensing and the community library. Capabilities are JSON files; repair logic, validation, and extraction all live in TypeScript inside the host process. The repo currently runs around 559 renderer tests and 139 backend tests. It's a credible v1 and it shipped. It also has structural limits that no amount of incremental work will resolve.

**Why this is a rewrite, not a refactor.** The two execution problems v2.0 needs to solve (capability portability with logic, and a hard sandbox around partially-trusted code) cannot be retrofitted into the v1 architecture. There is no isolation boundary inside an Electron main process; everything that runs there runs with full host privileges. JavaScript on V8 has no fuel-metered execution, no per-call memory limit, no capability-based syscall surface. Adding any of these means adding another runtime alongside V8, at which point the question stops being "JS or another runtime" and starts being "which runtime, and why is the host language not the same as the runtime that hosts capabilities?". The current answer (TypeScript everywhere) was correct for v1 and is the constraint v2 needs to remove.

**What the rewrite looks like.** A native host in Rust, embedding `wasmtime` as a library. Capability components compile to `wasm32-wasip2` against a fixed WIT contract and are loaded into per-run sandboxed stores with explicit resource budgets. The browser layer keeps a CDP-driven Chromium build but is now driven from Rust directly. The Cloudflare Workers backend is the only layer that survives mostly intact: it serves the community library, license validation, and signed-bundle distribution, and none of that needs to change. The MCP integration (`purroxy_list_capabilities`, `purroxy_run_capability`, `purroxy_status`) keeps the same external shape; what changes is what sits behind it.

**The mindset shift.** v1 treated security as a property of careful coding ("don't leak the password"). v2 treats security as a property of architecture ("the code that could leak the password cannot reach the password"). v1 treated capabilities as data the host interprets. v2 treats capabilities as sandboxed programs the host orchestrates. v1 was monolingual by necessity (Electron's everything-is-JS model). v2 is polyglot by design (anything that compiles to a Wasm component is a first-class contributor). v1's repair logic was a function call away from the browser. v2's repair logic cannot reach the browser even if it tries.

**Concrete benefits over the current implementation.**

- **Hard sandbox around partially-trusted code.** A community-published capability runs with no filesystem, no network, no clocks beyond a monotonic timer, no environment, and bounded CPU and memory. v1 has none of these guarantees; a malicious or buggy capability today runs inside the Electron main process with full privileges. This is the single largest user-facing safety improvement.
- **Polyglot contributors.** Capability authors can use Rust, Go (TinyGo), Python (componentize-py), C, Zig, or JavaScript (jco). v1 implicitly required TypeScript familiarity for any non-trivial logic. The community library gets a wider top-of-funnel.
- **Deterministic replay for support.** Because the capability sandbox has no nondeterministic inputs the host doesn't supply, a run record plus the original component reproduces the exact failure on a support engineer's machine. v1 cannot do this; differences in Node versions, Electron internals, and host-machine state make "works on my machine" an unavoidable failure mode.
- **Resource exhaustion can no longer wedge the host.** `wasmtime`'s fuel mechanism plus memory limits plus wall-clock budgets mean a runaway capability aborts cleanly with a typed error. v1's Node event loop has no equivalent; an infinite loop or memory blow-up in capability code takes the whole app with it.
- **Faster cold start per capability invocation.** Component instantiation in `wasmtime` is sub-millisecond. v1's per-invocation overhead is dominated by JS module loading and the cost of staying inside a single shared V8 isolate (which means no real isolation either). The 50ms p95 target in §12 is achievable with components; it is not achievable in v1's architecture without significant work.
- **Smaller, signable, version-pinnable artifacts.** A `.wasm` component is a single binary you can hash, sign with a GitHub attestation (which v1 already does at the app level; v2 extends it to the bundle level), and pin per install. v1's JSON-plus-host-interpreted-logic model can't be signed in a way that protects users from logic changes, because the logic isn't in the bundle.
- **A capability contract that survives across host versions.** The WIT world is the public API between host and capabilities. It versions explicitly, deprecates slowly, and breaks loudly. v1 has an implicit contract (whatever shape the JSON happens to take) that drifts every release, so old capabilities silently misbehave on new hosts.
- **Trusted computing base shrinks.** The Rust host is one binary with a known dependency tree, signed end-to-end. v1 ships an Electron runtime, which is a Chromium plus a Node, with the corresponding patch surface. v2 still ships a Chromium (it is the controlled browser users automate; that doesn't change), but drops the Node runtime, the Electron IPC surface, the V8 isolate that hosted partially-trusted code in the same process as host privileges, and the npm transitive dependency tree of the host. The UI runs in a Tauri shell against the system webview rather than a bundled Chromium-as-renderer. For an app whose value proposition is "your credentials don't leave your machine," shrinking the TCB is directly on-mission. Install size is roughly comparable to v1 because Chromium is the bulk; the win is what stops being trusted, not what stops being downloaded.
- **The backend keeps working.** Cloudflare Workers stays. License validation, the community library, signed-bundle distribution, attestation verification: all of that is independent of the host language and ships unchanged. The rewrite is a desktop-side rewrite, not a full-stack one.
- **Test surface gets sharper, not larger.** v1's 559 + 139 tests are mostly integration tests against a JS-everywhere stack. v2 splits them: unit tests against the Rust host, contract tests against the WIT world (run against a reference component), and a corpus-fuzzing suite for community submissions. Each layer is independently testable, and "does this capability misbehave?" becomes a mechanical question rather than a code-review question.

**What this costs.** The rewrite is a multi-quarter investment, not a 2026 release. Solo founder ramping into Rust from a TypeScript/Electron baseline; the realistic range to v2.0 parity is a year of focused work, not the back-of-envelope "4-6 months for an experienced Rust engineer" that gets quoted casually. The non-technical primary audience experiences zero workflow changes; the WASM layer is invisible to them.

There is no v1 user base to migrate. v0.1.0 shipped without acquiring users before the architecture pivot, so v2.0 ships into a clean install for everyone. No conversion path, no first-launch wizard, no compatibility shim for v1 capability JSON. If users ever materialize on v0.1.x before v2.0 lands, this section reopens.

**What stays the same.** The product promise. The recording-and-replay model. The MCP tool surface. The AI-as-data-not-actor rule. The vault. The session encryption. The community library mechanic. The attestation chain. The user never sees any of this change; what changes is the architecture beneath it, in a way that makes every claim on the landing page provably true rather than carefully coded.

**Delivery pipelines stay too.** The GitHub Actions workflows that build, test, sign, attest, and ship Purroxy today are the right shape and stay in place. What changes is the work inside the steps; what doesn't change is the pipeline topology, the release cadence, or the trust chain users already verify with `gh attestation verify`. Concretely:

- **CI test workflow.** The matrix structure stays (Linux, macOS, Windows). The renderer test job becomes a Rust `cargo test` job for the host crate plus a `cargo component test` job for the reference capability components. The current Vitest suite is not ported line-by-line; it is re-authored against the new architecture. UI tests run against the Tauri frontend (whatever combination of frontend test runner and Tauri's `tauri-driver` end-to-end harness fits the rewritten UI). Capability-logic tests become WIT contract tests run against a reference component. The backend test job (the 139 tests against the Cloudflare Workers code) stays exactly as is.
- **Release workflow with build provenance.** The `actions/attest-build-provenance` step that produces verifiable attestations stays. What it attests changes: instead of attesting an Electron-packaged binary, it attests the Rust-built host binary plus the WIT contract version it was built against. `gh attestation verify` continues to work on every release artifact. The user-facing verification command on the landing page does not change.
- **Multi-platform packaging.** The current cross-platform packaging job (likely `electron-builder` based) is replaced with a Rust cross-compilation matrix producing native binaries for macOS (Intel + Apple Silicon), Windows, and Linux. Code signing on macOS (notarization) and Windows (Authenticode) stays in the same workflow, with the same secrets, same signing identities, and same release artifacts naming convention. Users updating from v1 to v2 see no change in install or update flow.
- **Cloudflare Workers deploy.** `npm run deploy` against the `backend/` directory stays. Wrangler config stays. Worker routes stay. The community library API surface that the host calls is preserved across v1 and v2; only the host's HTTP client implementation changes (from Node `fetch` to Rust `reqwest`).
- **Capability bundle distribution.** A new pipeline step is added that, for any community-published capability, runs the static and fuzzed-dynamic checks from §6.6 in CI before the bundle is added to the registry. This step lives alongside the existing Workers deploy and reuses the same attestation tooling: published bundles are signed by the registry's release key, and the host verifies the signature on install and on every load.
- **Auto-update channel.** Stable and beta channels stay. The update manifest format stays. What's downloaded changes: a small native host binary instead of a packaged Electron app, plus a per-platform Chromium that the bundle now owns directly. The host binary delta is meaningfully smaller than v1's. Chromium update churn dominates and requires differential updates (binary deltas) — see §10. Net update size is comparable to v1 on Chromium-version bumps and noticeably smaller on host-only releases.
- **Renovate / Dependabot.** Dependency automation continues; the dependency surface shrinks substantially (no more Electron, no more Chromium-as-runtime, no more transitive npm tree for the host) but the same automation tooling watches the Rust crate graph (Cargo) and the backend npm graph.

The principle: the pipelines exist to enforce a contract with users (every release is reproducible, signed, and attested). That contract holds across the rewrite. The CI/CD investment v1 made is not thrown away; it's repointed at a different build target.

---

## 1. Problem

Most websites have no public API. Users who want AI assistants to act on their behalf (checking email, paying bills, looking up account info, filing routine forms) are stuck because the AI has no way to reach those sites. Today's workarounds are all bad:

- Hand the AI a password. Dangerous; one breach exposes everything.
- Reverse-engineer a private API. Requires deep skill; breaks when the site changes.
- Copy-paste manually. Tedious; defeats the point of an assistant.
- Use general-purpose browser automation. Requires coding; doesn't integrate with assistants; doesn't protect credentials.

What users actually need: a way to teach an AI assistant how to do a specific thing on a specific site, by demonstrating it once, without writing code, without sharing a password, and without becoming a web scraping expert. And the demonstration has to keep working as the site evolves, instead of silently breaking.

The v1.0 release proved the recording-and-replay model works. It also exposed two execution problems v2.0 must solve at the architecture level:

1. **Capability portability and trust.** v1.0 stored capabilities as JSON, which made the community library viable but created an awkward gap: anything beyond pure recorded steps (custom validation, computed parameters, site-specific normalization) had to live in the host runtime. Contributors couldn't ship logic, only data.
2. **Sandboxing the untrusted parts.** v1.0's repair logic ran inside the host process. Any bug in repair (or any malicious input from a community capability that exploited it) ran with full host privileges.

v2.0 addresses both by making capabilities themselves **WebAssembly components**. Recorded steps remain declarative data; logic that accompanies them (validators, extractors, repair hints, parameter transforms) compiles to a sandboxed `.wasm` component with a fixed interface. The host loads it, calls it, and can revoke its capabilities at any moment. The WASM Component Model is the right tool for this exact problem: secure, portable, polyglot, and production-ready against `wasm32-wasip2`. The v2.0 baseline targets the synchronous WASI Preview 2 component model; Preview 3's async features are opportunistic and not load-bearing — if they ship in time, the contract evolves additively per the §10 migration policy; if not, sync is sufficient for the workload (capability calls are bounded, short-lived, and mostly compute).

## 2. Users

**Primary: non-technical users of AI assistants.** People who already use Claude (or similar) and want it to do more, specifically interact with websites on their behalf. They are not developers. They cannot write scripts, debug selectors, or reason about page structure. The WASM layer is invisible to them.

**Secondary: technical users who want to skip scraping infrastructure.** Power users who can write code but don't want to maintain brittle scrapers across dozens of personal sites. They value credential isolation, reliability, and AI integration. For this group, the WASM component layer becomes a feature: they can hand-author the optional logic part of a capability in any language with a `wasm32-wasip2` target (Rust, Go via TinyGo, C, Zig, Python via componentize-py, JavaScript via jco) without forking the host.

**Tertiary by user count, primary by acquisition impact: contributors.** Users who build a capability for a popular site and publish it for others to use. They are a small fraction of the user base but are the primary acquisition channel: each accepted submission seeds the library that brings primary-tier users in. Contributors earn standing in the community library and free ongoing access (see §11). Because contributed capabilities are sandboxed components, contributors get more expressive power without users having to extend trust.

## 3. Core concepts

**Capability.** A reusable, named, parameterized automation that performs a specific task on a specific website. Examples:

- "Get my last 10 Yahoo Mail messages"
- "Look up my checking balance on Chase"
- "Search Google Flights from {origin} to {destination} on {date}"
- "File the X form on the Y state DMV portal"

A capability has: a target website, a description that an AI can read to know when to call it, parameters that vary per run, expectations about what the page should look like before and after each step, rules for what data to return, and references to sensitive data (never the values themselves).

**Capability bundle.** The on-disk format. A signed archive containing: a manifest (JSON), recorded steps (JSON), a single WASM component (`logic.wasm`) implementing the `purroxy:capability/v1` world, and any static assets. Capabilities without custom logic ship with a stub component generated at save time, so the loader path is uniform. The WIT world is fixed across all capabilities, so the host loads any capability with the same code path.

**Site profile.** The site a capability operates on, plus the user's saved login session for that site. Users log in once per site; all capabilities for that site share the session. Sessions are stored encrypted at rest (OS keychain on macOS/Windows, libsecret on Linux) and never exposed to capability components.

**Vault.** A locally encrypted store for sensitive non-credential data: credit card numbers, security answers, account IDs, anything Claude shouldn't see. Vault values are typed into forms during a run by the host, never passed to the capability component, and removed from any data before it reaches the AI.

**Health status.** Each capability carries a visible status (healthy, degraded, broken, needs review) based on its recent run history and how the system responded. Users see status at a glance and know which capabilities need attention.

**Run record.** Every time a capability runs, the system writes down: when, with what inputs, what it observed at each step, what it returned, and whether it had to repair anything along the way. Users can replay a past run to debug what happened. Run records are deterministic enough to re-evaluate against captured page snapshots, so support workflows can reproduce a failure exactly.

## 4. Architecture overview

Three layers, with a clean boundary between trusted and sandboxed code.

### 4.1 The host (trusted, native)

Written in Rust. Owns the controlled browser (a CDP-driven Chromium build), the encrypted session store, the vault, the user-facing UI, and the embedded `wasmtime` runtime. The host is the only component that can:

- Drive the browser (click, type, navigate, screenshot).
- Read or write encrypted session data.
- Read vault values and inject them into the page.
- Talk to AI providers.
- Talk to the network.

Capability components cannot do any of these directly. They get filtered, structured views of the page and return structured intent.

**UI framework: Tauri.** The desktop UI is a Tauri shell: a Rust backend serving a frontend rendered by the platform's system webview (WebView2 on Windows, WKWebView on macOS, WebKitGTK on Linux). The choice is pragmatic. The v1 renderer is an existing web-stack codebase whose UI design and component layout the rewrite can reuse; Tauri lets that reuse happen without re-authoring the recording-builder UI in a Rust-native immediate-mode toolkit (egui, iced, slint, Dioxus, gpui), each of which would add months of UI work for a solo founder ramping into Rust. The trade-off is a system-webview attack surface, which §9 accounts for: the webview renders only local data and never reaches capability components, vault values, session material, or third-party origins.

**Controlled browser: bundled headless Chromium, driven via `chromiumoxide`.** The browser the user automates is a separate process from the Tauri UI webview. The application bundles a per-platform headless Chromium build and drives it over CDP using the `chromiumoxide` Rust crate. This keeps capability execution reproducible (same Chromium version per release, no dependence on what the user has installed), preserves the v1 user experience (open the site, log in, demonstrate, replay), and avoids the alternative paths each of which has worse trade-offs: shelling out to Node and Playwright drags Node back into the trusted base, requiring a system Chrome adds a user dependency, and forking Chromium is unrealistic for a solo founder. The Chromium binary is the dominant install-size cost; see §10.

### 4.2 The capability runtime (sandboxed, WASM)

Each capability is a WebAssembly component built against the `purroxy:capability/v1` WIT world. The host instantiates it in `wasmtime` with a fresh `Store` per run, capabilities granted explicitly through the WASI Preview 2 model: no filesystem access, no network access, no environment variables, no clock beyond a monotonic timer. Memory is bounded; CPU is metered with `wasmtime`'s fuel mechanism; the run aborts cleanly if the budget is exceeded.

The component exports functions for the parts of capability logic that benefit from being expressive: parameter validation, page-state preflight, postflight verification, repair hint scoring, output extraction, and output redaction. The host imports nothing into the component beyond a small set of pure helpers (DOM-shape queries against a frozen accessibility tree snapshot, regex matching, structured logging). The component has no way to reach the live page, the vault, the session, or the network, even by accident.

### 4.3 The AI plane (out-of-process, network)

The AI assistant is a client of the host's MCP server. It can list capabilities, invoke them with parameters, and receive redacted results. It cannot drive the browser, cannot see vault values, cannot see raw page content unless the capability explicitly extracts and returns it, and cannot bypass the run state machine. The "AI as data, not actor" rule is enforced by the fact that the AI never holds a reference to the browser or the WASM runtime: it can only enqueue a typed call.

### 4.4 Why WASM components specifically

The full case is in §0; in short, the WASI Preview 2 capability model, the `wasmtime` fuel and memory mechanisms, and the Component Model's WIT typed interface are the primitives this product needs. The same architectural pattern is in production today for Shopify app extensions, Fastly Compute, and SingleStore UDFs; we are applying it to the desktop AI-automation context.

The price is a build step for contributors who want custom logic. For pure recorded capabilities (the dominant case for non-technical users), the host generates a stub component at save time and the user never sees the WASM layer. Build time for a typical capability is well under a second.

## 5. The capability WIT contract

The full WIT is in `wit/capability.wit`. The shape (sketched here):

```
package purroxy:capability;

world capability {
    import host: purroxy:host/v1;
    export metadata: func() -> capability-metadata;
    export validate-params: func(p: param-set) -> result<param-set, validation-error>;
    export preflight: func(step-id: string, page: page-snapshot) -> result<_, preflight-error>;
    export postflight: func(step-id: string, before: page-snapshot, after: page-snapshot) -> result<_, postflight-error>;
    export score-repair-candidates: func(step-id: string, intent: step-intent, candidates: list<element-handle>) -> list<scored-candidate>;
    export extract: func(page: page-snapshot) -> result<output, extract-error>;
    export redact: func(o: output) -> output;
}
```

Notes on the sketch:

- The component never receives raw HTML or DOM access. `page-snapshot` is a structured, accessibility-tree-derived view assembled by the host. Vault values, cookies, and headers are stripped before construction.
- `element-handle` is an opaque handle. The component scores candidates; the host carries out clicks. The component cannot say "click this CSS selector"; it can only say "of these N candidates the host already filtered, candidate 3 is the best match, with score 0.87, because [reasons]".
- `extract` returns a structured `output`; `redact` is called on it before it leaves the host, so the redaction logic itself is auditable as part of the capability and reviewable by the community.
- Recorded steps stay outside the WASM component, in the manifest. The component supplements them; it doesn't replace them.

Constraints the contract enforces:

- **Sync only at v1.** All exports are synchronous (WASI Preview 2 component model). The host serializes calls within a single capability run; runs of different capabilities or different invocations of the same capability execute in independent `wasmtime` `Store`s and may run concurrently. Async exports are deferred to a hypothetical Preview 3 contract version, additively, per the §10 migration policy.
- **Errors are structured variants, not strings.** `validation-error`, `preflight-error`, `postflight-error`, and `extract-error` are WIT variants carrying a typed error code (enum), a human-readable message, and an optional context payload (step-id, candidate-index, expected-vs-observed page state, etc.). Codes are stable across host versions; messages may evolve. The host renders codes to users in run records (§7.8) and uses them for support and analytics.
- **`page-snapshot` is canonically serialized.** Nodes ordered by document position, attribute keys sorted lexicographically, frame structure flattened with stable IDs, no host-time-of-capture or PRNG-derived fields visible to the component. This canonicalization is what makes replay (§8) bit-exact: re-running the same component against the same captured snapshot produces the same outputs deterministically.
- **`step-intent` is capture-time data, not run-time regeneration.** Intent (target role, target accessible-name, target text content, structural anchors, surrounding context) is captured during recording and persisted in the manifest. The host does not regenerate intent at run time; regeneration would introduce nondeterminism that defeats replay and changes scoring inputs across runs.
- **`metadata` is the capability's self-description.** It returns name, description, target-site origin pattern, parameter schema, output schema (including which fields are marked sensitive), declared resource budgets (memory cap, fuel cap, wall-clock cap), vault references, and target WIT version. The host cross-checks `metadata` against the bundle manifest at load; mismatch is a hard load failure with a specific error code.
- **Host-side redaction backstop.** The capability's `redact` export is the primary redaction layer. After `redact` runs, the host inspects the output against the sensitive-fields list declared in `metadata`'s output-schema; any sensitive field that survived `redact` is stripped by the host. This guards against capabilities that ship a no-op `redact` accidentally or maliciously. The vault-value scrubber from §9.2 is a third pass on the resulting text.
- **Structured-logging import is bounded and scrubbed.** The host import surface includes a `log(level, message, kv)` helper for component reasoning. Per-run log buffer is capped (64KB target); excess is truncated with a marker. The host scrubs vault values from log entries before persisting them in the run record, identically to the output scrubber.

Versioning: this WIT is versioned by package version (`purroxy:capability@1.0.0`). Older capabilities continue to load against `v1`; future contracts (`v2`, etc.) can be introduced without breaking existing bundles, and the host rejects components targeting unsupported versions cleanly with a specific error code.

## 6. User journeys

### 6.1 Build a capability

1. **Open a site.** User enters or picks a URL. The site opens in Purroxy's controlled browser.
2. **Log in if needed.** If the site requires authentication, the user logs in normally. The login flow is between the user and the site; Purroxy never sees the credentials, only the resulting session. Once the user signals "logged in," Purroxy saves the session encrypted on disk.
3. **Choose what to automate.** An AI guide reviews what's on the page and suggests three to five things the user could automate. Or the user describes their own goal in plain language.
4. **Demonstrate.** The user clicks "Start" and walks through the workflow once. Every meaningful interaction (click, input, navigation, dropdown selection, file upload, scroll-to-load) is captured along with enough context to repeat it later.
5. **Review and resolve ambiguity.** Before the capability is saved, the system reviews each captured step against what it saw on the page. If a step is ambiguous (the user clicked one of three identical buttons and the system can't tell which one they meant), the user is prompted with the candidates side-by-side and picks the right one. Ambiguous steps must be resolved before save.
6. **Mark variable values.** The user reviews captured text inputs and decides which should be runtime parameters versus fixed.
7. **Confirm what to extract.** The system proposes data to return from the final page; the user reviews and adjusts. Sensitive fields are flagged.
8. **Test.** The user runs the capability with sample inputs to confirm it works before saving.
9. **Save.** The host generates a stub WASM component (or compiles the contributor-supplied source if present), assembles the bundle, signs it with the user's local key, and installs it. The capability is immediately available.

### 6.2 Run a capability through an AI assistant

1. The user asks Claude (or any connected AI assistant) to do something. ("Check my recent emails." "What's the balance on my checking account?")
2. The assistant identifies the matching capability via MCP and calls it with parameters.
3. The host loads the capability bundle, instantiates the component in a fresh `wasmtime` store with a per-run resource budget, and validates parameters via the component's `validate-params` export.
4. For each recorded step, the host calls `preflight`, performs the action against the live browser, calls `postflight`, and proceeds. Vault values are typed in directly by the host; they never enter the component or the AI.
5. If a step fails (target element gone, unexpected page state), the host enters repair mode: it asks the component to score replacement candidates it has filtered from the current page snapshot. The component returns scored candidates with reasons; the host picks the top one if confidence is high enough, otherwise stops cleanly.
6. The capability's `extract` export builds the output. `redact` runs on it. The result returns to the AI with sensitive fields stripped.
7. The assistant presents results to the user.

### 6.3 A capability breaks because the site changed

- Capability runs; a step fails (the button moved, the field renamed, the layout changed).
- The host attempts an automatic repair. The component's `score-repair-candidates` is the brain; the host is the hands. Because the component cannot reach the page directly, it cannot accidentally make the situation worse: it can only score candidates the host has already pre-filtered.
- If repair succeeds, the run continues, and the new fix is persisted back to the bundle's manifest (not the WASM, which is immutable post-publish). The capability remains healthy. Disclosure depends on origin, determined by bundle signature: a bundle signed by the user's local key is user-built; a bundle signed by the community registry key is community-installed. For user-built capabilities, the user is notified once via a dismissible banner on the capability card with a "see what changed" affordance, and the fix is persisted automatically. For community-installed capabilities, the repair applies for the current run but is not persisted until the user approves it; the run completes, and the user is asked whether to keep the change for next time. The asymmetry reflects the threat model: a user repairing their own work is fixing their own work; a community capability silently rewriting itself on someone else's machine is something else.
- If repair fails, the run stops cleanly. The capability is marked needs review with a specific reason. No silent wrong-clicks. No partial data.
- The user opens the capability, sees what failed and where, and can either re-record from the failing step forward, or re-record the whole thing.
- If a capability fails repeatedly for the same step across runs, the system stops attempting it automatically until the user intervenes.

### 6.4 Test before shipping

The user opens a saved capability and runs it manually with chosen parameters. The run is visible: each step shows whether it succeeded, what was observed, what was extracted, and (if the component logged anything via the structured-logging host import) what its reasoning was. Outputs marked sensitive are visible in this view (the user is local, the AI is not in the loop). Parameters can be adjusted and re-run without leaving the screen.

### 6.5 Manage a library

The user views all capabilities, grouped by site, with health status. They can rename, edit description and parameters, delete, or duplicate. They can re-record without losing the name, description, parameters, extraction rules, or the WASM component (only the recorded steps are replaced). For pure recordings, the stub WASM component is regenerated to match the new steps. For capabilities with hand-authored logic, re-recording can invalidate component code keyed to old step IDs; the host detects this at save (mismatch between step IDs the component references and step IDs in the new recording) and surfaces a specific warning so the contributor can update the logic before saving. Export produces a portable `.purroxy` bundle (the same format used for community publishing).

### 6.6 Share to and install from the community library

A contributor publishes a capability bundle. The submission goes through automated review:

- **Static checks.** The bundle's signature is valid. The WASM component targets the supported WIT world. Manifest fields are well-formed. No vault values, no embedded credentials, no PII in test fixtures. Declared resource budgets are within bounds.
- **Dynamic checks (fuzzed).** The component is instantiated in a sandbox and exercised against an adversarial corpus: malformed accessibility trees, oversized strings, deeply nested structures, Unicode edge cases, and snapshots seeded with synthetic vault values to verify `redact` actually redacts. Submissions failing on resource exhaustion, panics, or redaction leakage are rejected automatically.
- **Spot-check manual review.** Applied only to capabilities targeting the top 20 most-installed sites, where blast radius is largest. A reviewer reads the manifest and inspects component behavior on representative inputs.

The sandbox is the security boundary, not the reviewer's eyeball. Manual review is the exception, not the gate, because anything a manual reviewer could catch should also be caught by the sandbox or the fuzz corpus; if it's not, the right fix is to extend the corpus.

On install, the capability appears in the user's library, set up for their site profile and waiting for their login. The user supplies their own session and any vault references the capability declares. Contributors with accepted submissions receive free ongoing access.

### 6.7 Diagnose a failure

When a capability fails, the user can open the run record and see, for each step: what was expected, what was observed, what the component scored, why it failed. They can package the run record (including the page snapshot at the moment of failure) and send it to support or a contributor. Because the component is deterministic given its inputs, a support engineer can re-instantiate the same component bundle, replay the same snapshots, and reproduce the exact failure on their own machine. "Works on my machine" goes away.

### 6.8 App lock

The user sets a PIN and an inactivity timeout. After the timeout, the app locks. While locked, all capability execution is refused, including requests from the AI assistant. Unlocking with the PIN restores access.

## 7. Functional requirements

### 7.1 Capability builder

- Present the target website alongside a guide so the user can interact with both at once.
- Detect when a site requires login and hand off to the user; never see credentials.
- Save the resulting session, encrypted, scoped to that site.
- After login, suggest concrete things the user could automate based on what's on the page.
- Capture every meaningful user interaction with enough context (intent, surrounding page state, structural anchors) to reliably repeat it later.
- Recognize composed interactions (open dropdown then click option, open date picker then pick day) as single logical steps.
- Capture interactions inside iframes and shadow content where possible.
- Take a snapshot of the page state immediately before and after each captured step.
- At save time, review each step. Block save on ambiguous steps until the user resolves them.
- Generate a short human-readable description of what each step is trying to accomplish, and let the user edit it.
- Auto-derive expectations about page state before and after each step. Let the user edit these.
- Let the user mark which captured values are parameters and which are fixed.
- Propose extraction rules; let the user review and mark fields sensitive. The default for any field flagged sensitive is "redacted in AI response, visible locally." Users can opt out of redaction per field, but only via an explicit confirmation at save time that surfaces the trade-off (the field will be visible to the AI provider).
- Generate a stub WASM component implementing the standard contract for capabilities without custom logic.
- For technical users: support a `purroxy.toml` with a `logic-source` directory pointing at Rust/Go/Python/JS source; build the component during save using a vendored toolchain.
- Sign the assembled bundle with the user's local key. The local signing key is generated on first launch, stored in the OS keychain (Keychain on macOS, DPAPI-protected key in DPAPI-encrypted file on Windows, libsecret on Linux), and never written to disk in plaintext. Lifecycle and rotation policy is specified in §10.
- Support a test-before-save flow.

### 7.2 Capability execution

- Replay a saved capability against the live site, using the saved session.
- Instantiate the WASM component in a fresh `wasmtime` store per run, with explicit resource budgets (memory, fuel, wall-clock).
- Substitute runtime parameters and vault values where appropriate. Vault values are typed in directly by the host; never reach the component or the AI.
- Before each step: confirm the page is in the expected state (component `preflight`). If not, take a fresh look once before failing.
- After each step: wait until the page has settled, then confirm the step had the expected effect (component `postflight`).
- If a step's target element can't be found exactly, attempt automatic repair: host filters candidates, component scores them, host picks the best if confidence is sufficient.
- If repair succeeds, persist the fix back to the manifest. For user-built capabilities, persist automatically and notify once. For community-installed capabilities, apply for the current run but require explicit user approval before persisting for future runs. In all cases, the repair is recorded in the run record.
- If repair fails, halt the run cleanly with a specific reason; mark the capability needs review.
- Distinguish between transient failures (network blip, retry-worthy) and structural failures (page changed, repair needed).
- Rate-limit execution per site.
- Auto-pause a capability after a configurable number of consecutive failures.
- Write a complete run record: inputs, observations, outputs, repairs, timing, component fuel consumed.
- Run the component's `redact` export on the output before returning to the AI.
- Strip vault values from any text on its way out to the AI as a host-side belt-and-braces check.
- The controlled browser is single-tenant per run. Concurrent capability invocations from one or more AI assistants are serialized into a per-host run queue with a configurable maximum depth (default: small, e.g. 4). Beyond the queue depth the host returns a typed `busy` error so the AI can surface it cleanly. The WASM runtime itself is not the bottleneck (each run uses a fresh `Store`, runs in parallel internally), but browser actions on a single Chromium target serialize.

### 7.3 AI assistant integration (MCP)

- Surface every saved capability as a callable tool over MCP.
- No manual tool registration beyond initial one-time setup.
- Pass natural-language requests through; the AI maps them to capabilities and invokes them.
- Pass runtime parameters through to the capability.
- Return structured results to the AI, with sensitive fields redacted and vault values scrubbed.
- Refuse all calls when the app is locked, when the user's subscription is invalid, when the targeted capability is paused, or when the component fails to instantiate.

### 7.4 Capability library

- List every capability, grouped by site, with health status.
- Support rename, edit, delete, duplicate, manual test, re-record.
- Show last-run timestamp, last-success timestamp, consecutive-failure count, and component version per capability.
- Let users open a past run record to inspect what happened.
- Surface clear guidance when AI integration needs setup or troubleshooting.

### 7.5 Community library

- Users can submit a capability bundle for community publication. Submission goes through static, dynamic, and manual review (see 6.6).
- Users can browse, search by site or task, and install community capabilities with one click.
- Installed capabilities are user-specific: the user supplies their own login and any vault references the capability declares.
- Contributors with accepted submissions receive free ongoing access.
- Bundle signatures are verified at install time and at every load.

### 7.6 Vault

- Encrypted local storage for sensitive non-credential data, backed by the OS keychain.
- Add, edit, delete entries.
- Capabilities reference vault entries by name; bundle contents never include vault values.
- At runtime, values are injected into the page by the host; before any data leaves for the AI, vault values are scrubbed by both the component's `redact` export and a host-side check.

### 7.7 App lock

- User sets a PIN and inactivity timeout.
- App auto-locks after the timeout.
- While locked, all capability execution is refused, including AI-initiated requests. The MCP endpoint returns a typed lock error so the AI can surface it cleanly.
- Unlocking with the correct PIN restores access.

### 7.8 Run records and diagnostics

- Every run produces a run record with: inputs, per-step observations and outcomes, any repairs applied, final outputs, component resource usage, and a snapshot of the page at any point of failure.
- Users can open a run record to see step-by-step what happened, including any structured logs the component emitted.
- A run record can be re-evaluated against its captured snapshots and the original component to reproduce the exact decision the system made, deterministically. This is what makes support tractable.

## 8. Reliability requirements

This is the v2.0 promise:

- **Never the wrong action.** A capability either does the right thing, repairs itself and does the right thing, or stops cleanly with a specific reason. It never silently does the wrong thing.
- **Ambiguity caught at save.** A recording the system can't disambiguate is never shipped. The user resolves before save.
- **Self-verifying steps.** Each step confirms the page state before acting and after acting via the component's preflight/postflight exports. A step that proceeds without verification is a bug.
- **Repair is bounded.** Automatic repair tries up to three times per failing step per run by default, within the per-run fuel budget; the cap is overridable per-capability via `metadata` within a hard host-imposed ceiling (no capability can request unlimited retries). If the cap is reached without success, the run stops. Repair can never modify the page in unintended ways because the component cannot drive the page.
- **Failure is reproducible.** Given a capability bundle and its captured snapshots, a support engineer can reproduce the same failure on their own machine. Determinism is enforced by the component sandbox: no clocks beyond a monotonic timer, no network, no filesystem, no sources of nondeterminism the host doesn't supply.
- **Health is visible.** A capability's status reflects its actual recent behavior. Users never have to guess whether something will work.
- **Site change is recoverable.** Most failures should be auto-repaired or marked needs review with a clear next step. Users should rarely need to start over.
- **Resource exhaustion is contained.** A misbehaving component cannot wedge the host. Fuel exhaustion, memory limits, and wall-clock budgets are enforced at the runtime layer.

## 9. Security requirements

Security is the product's reason for existing. Every requirement below must be preserved unconditionally.

### 9.1 Credential isolation

- Passwords, tokens, and active session credentials never leave the user's machine.
- During recording, the AI guide sees field labels (e.g. "email", "password") but never field values.
- During execution, credentials are typed directly into the browser by the host, never through any channel visible to the AI or the capability component.
- No credential is ever transmitted to Purroxy's servers, the AI provider, or any external service.

### 9.2 Sensitive data protection

- Vault values are encrypted at rest using OS-level encryption (Keychain on macOS, DPAPI on Windows, libsecret on Linux).
- At runtime, vault values are typed directly into web forms by the host. They are not passed to the WASM component.
- Before any text reaches the AI (page context shown to the guide during building, intermediate observations during a run, final outputs), vault values are removed by a host-side scrubber that runs after the component's own `redact` export.
- Capability outputs can mark fields as sensitive; sensitive fields are redacted before being returned to AI assistants and are visible only inside Purroxy itself.

### 9.3 Session security

- Authentication sessions are encrypted at rest.
- Sessions are used only by the controlled browser during runs, by the host directly. The WASM component never receives session material.
- Sessions don't move between machines, accounts, or capabilities.

### 9.4 Component sandboxing (new in v2.0)

- Every capability component runs in an isolated `wasmtime` store with no implicit capabilities.
- The component has no filesystem access, no network access, no environment variables, no subprocess spawning, and no clocks beyond a monotonic timer.
- Memory is bounded; CPU is metered with fuel; wall-clock time is bounded. Exhaustion produces a clean abort with a typed error.
- The component receives only structured, sanitized views of the page (accessibility-tree-derived snapshots) with vault values, cookies, and Authorization headers stripped before construction.
- The component cannot enumerate page elements freely; it can only score handles the host pre-filtered for it.
- Host imports exposed to the component are pure functions over the data the host already gave it (no side effects on the live browser, no I/O).
- **Repair scoring is constrained by the host filter, not the component.** The host pre-filters candidates by recording-time intent (target role, accessible-name pattern, structural anchors) before passing them to `score-repair-candidates`. The component re-orders within the filtered set; it cannot promote a candidate the host filter excluded. The host accepts a top-scored candidate only if (a) its score exceeds a configurable threshold, (b) it still passes the structural intent match against the live snapshot, and (c) it ranks within the top N of the filtered set. A malicious component can re-order, but it cannot substitute a semantically distant candidate.
- **Postflight has a host-side structural check independent of the component.** After every step, the host evaluates recording-time expectations (target presence, expected URL pattern, expected text-present markers) captured in the manifest, before consulting the component's `postflight` export. If the host's structural check fails, the step fails regardless of what the component returns. If the component's `postflight` fails but the host's structural check passes, the step still fails (both must pass). This bounds damage from a buggy or malicious component that lies in `postflight`.

### 9.5 AI boundary

- The AI can suggest, describe, and request. It cannot directly act. Every action against a website goes through the capability runtime, which enforces all safety rules above.
- AI-suggested repairs are validated structurally before they are applied; the AI can only propose what to do, never how the system carries it out.
- The AI never holds a reference to the WASM runtime, the browser, the vault, or the session store.

### 9.6 Physical access protection

- PIN-based app lock, configurable inactivity timeout.
- All execution is blocked while locked, including AI-initiated calls.

### 9.7 Community library trust

- Imported community capabilities are subject to all the rules above. The WASM component is sandboxed by default; the manifest is data, not executable code.
- Bundles are signed; signatures are verified at install and at every load.
- Submissions are reviewed before publication (static and dynamic-fuzzed automated checks for all submissions; spot-check manual review for capabilities targeting top-installed sites; see 6.6).
- Component versions are pinned per install. Updates require user consent.

### 9.8 UI surface (Tauri webview)

The desktop UI runs in a Tauri shell using the platform's system webview. The webview is part of the trusted host, not a sandbox boundary; it sees only local application state.

- The UI webview never loads third-party origins. Its content is the local Tauri-served frontend. Navigation to external URLs is denied at the Tauri allowlist level.
- The capability-controlled browser (CDP-driven Chromium) is a separate process from the UI webview. Web content the user is automating renders there, not in the UI surface.
- Vault values, raw session material, and capability components do not enter the UI webview. The UI sees only what the host's structured view layer hands it: capability metadata, run records, redacted outputs, page snapshots prepared for review.
- Tauri IPC commands exposed to the frontend are an explicit allowlist defined in Rust. There is no general "evaluate Rust expression from JS" surface; every privileged action is a typed command.
- System-webview CVEs are tracked and patched through the OS update channel (WebView2 via Edge updates on Windows, WKWebView via macOS updates, WebKitGTK via the user's distribution). The application does not bundle its own webview.

## 10. Distribution and lifecycle

- Cross-platform desktop application (macOS, Windows, Linux). The host is a single Rust binary; `wasmtime` is embedded as a library, not a separate process. The application bundles a per-platform headless Chromium build (driven over CDP by `chromiumoxide`) for capability execution. Chromium is the dominant install-size cost and the dominant auto-update cost; the auto-update channel ships Chromium deltas alongside host-binary deltas. Differential updates (binary deltas rather than full re-downloads) are required, not optional, because full Chromium re-downloads on every release are not acceptable for users on metered connections.
- Saved capabilities run locally. Internet is required only for AI-guided building, AI-assisted repair, license validation, and community library access.
- System tray integration; the app is reachable without hunting for a window.
- No telemetry by default; opt-in only.
- Capability bundle format is versioned (`bundle.version`, `wit.version`). Older capabilities continue to work or are flagged for re-recording with a specific reason. Bundles targeting unsupported WIT versions are rejected at load with a clear message.
- Auto-update for the app itself, on a channel the user controls (stable / beta).
- The bundled `wasmtime` and WIT contract version are visible in About; users on long-running installs can see exactly which runtime version their capabilities are loading against.
- **Custom-logic toolchain.** The host does not bundle full language toolchains (Rust, Go, Python, JS) for the technical-user custom-logic path; doing so would inflate the installer by hundreds of MB to serve a small fraction of users. Instead, the host detects what's installed, gives a one-line install command for what's missing, and ships vendored copies of `wasm-tools` and `wit-bindgen` (small, single-binary, no language runtime). Rust is the recommended default and the path internal examples target; other languages are documented and supported but not promised equal polish.
- **WIT version migration.** The contract between host and components is treated like a public API: additive whenever possible, deprecated slowly when not, broken never silently. New WIT exports are optional with host-supplied defaults; existing exports keep their semantics. When a breaking change is unavoidable, the host ships a shim that adapts old components to the new interface for behavior the shim can express; anything it cannot express fails loudly at load, not at run. Contributors get a six-month deprecation window from the release of a new contract version. During the window, library listings show a "needs update" badge on capabilities targeting the old contract; after the window, those capabilities are hidden from search but continue to load for users who already installed them, with a banner explaining the situation.
- **User local signing key.** Generated at first launch using OS-native key APIs (Keychain on macOS, DPAPI on Windows, libsecret on Linux). Used to sign user-built capability bundles. The public key is embedded in the bundle at sign time so verification works without out-of-band key distribution. Rotation supported: the user can generate a new key, and previously-signed bundles still verify against their embedded public key. If the key is lost, the user re-generates and accepts that future authoring uses a new key; existing user-built capabilities keep working because the embedded public key is what verifies them. If the key is compromised, the user revokes via local profile update; bundles signed before revocation still load with a warning. Other users importing a user-signed bundle (e.g., a `.purroxy` file shared peer-to-peer) see it as "from another user" and are prompted explicitly before installation, regardless of signature validity.
- **Community registry signing key.** Registry-side, stored hardware-backed and used in CI (GitHub Actions OIDC + `actions/attest-build-provenance`); signing keys are not on contributor machines. Rotation is a registry operation, announced via an attestation update; users' hosts re-fetch the trusted key set on start.
- **Network IO is host-only.** All network calls (AI provider HTTP, license validation, community library fetches, attestation verification, auto-update) are made by the host using standard Rust libraries (`reqwest` or equivalent for HTTP, an MCP server crate for the assistant interface). Capability components have no network capability and cannot reach the network even via host imports. Specific library choices are implementation details, not contract-level commitments.

## 11. Business model

The product is free for everyone during the user-acquisition phase. Pricing is deferred until we have product-market fit signals; specifically: 500 or more users with at least three healthy capabilities each, sustained for 30 days. Until that bar is cleared, charging is a distraction that costs us users and gives us no useful information. We learn nothing from "would you pay X" surveys; we learn everything from watching what people actually build.

- **Free tier (current).** Full product. No payment info required. No artificial limits on number of capabilities, runs, or sites.
- **Contributor access (forward-looking).** When pricing is introduced, users who publish an accepted community capability will receive free ongoing access. The contributor flywheel is the primary acquisition channel; the mechanic stays.
- **AI key.** Users provide their own AI provider key for the building and repair workflows. Routine capability execution does not require an AI key under normal conditions. This is not a monetization choice; it's a security and cost-attribution choice that holds across all tiers.
- **Future pricing.** Will be calibrated against actual usage data once the PMF bar is cleared, not against survey intent. The architecture imposes no constraints on what tiers look like later (per-seat, per-run, flat subscription, freemium), so we don't need to decide now.

## 12. Success metrics

Targets below are aspirational and grounded in the architecture's design intent (sandboxed scoring, structural postflight, deterministic replay, bounded repair). v1.0 actuals across these metrics are the baseline; v2.0 is judged against improvement on the baseline, not against the aspirational target in isolation. Anywhere v2.0 is materially worse than v1.0, that is a release blocker.

- **Capability completion rate.** Of users who start building a capability, what fraction successfully save one. Target: at least 80%.
- **First-run success rate.** Of saved capabilities, what fraction succeed on their first invocation by the AI assistant. Target: at least 90%.
- **Long-term reliability.** Of capabilities live for 30+ days, what fraction are still healthy without user intervention. Target: at least 75%.
- **Auto-repair recovery rate.** Of runs that hit a step the recording didn't anticipate, what fraction are repaired automatically and complete successfully. Target: at least 50% of recoverable failures.
- **Time to first capability.** From install to first working capability. Target: at most 15 minutes.
- **Component instantiation overhead, browser warm.** From an AI invocation arriving at the host (controlled Chromium already launched, signed-in session loaded) to the first browser action issued. Target: under 50ms p95. Component instantiation in `wasmtime` is sub-millisecond; the budget is dominated by snapshot construction and CDP roundtrip. With a cold browser, p95 is significantly higher and is reported as a separate metric for diagnostic purposes (not a release-gating target).
- **Community library adoption.** Number of community-published capabilities; fraction of users with at least one community-installed capability.
- **PMF bar.** Users with three or more healthy capabilities sustained for 30 days. Target: 500 such users before pricing is introduced.
- **Failure clarity.** Of failed runs, what fraction surface a specific, actionable reason to the user. Target: at least 95%.

## 13. Non-goals

- **Generic browser scripting.** Purroxy is not a Selenium/Playwright replacement. Capabilities are recorded by demonstration; the WASM layer supplements recordings, it does not replace them with hand-written scripts.
- **Code-rendered UIs.** Sites that render entirely via canvas (Figma, Google Sheets) are out of scope. The user is shown a clear "this site is not supported" message during recording.
- **Sites that actively detect automation and refuse it.** We make best efforts to avoid being flagged as a bot, but we don't claim to defeat dedicated anti-automation systems.
- **AI-as-actor.** The AI doesn't drive the browser. It identifies which capability to invoke and with what parameters; the host carries out the action; the component supplies the brains for the parts that need expressive logic.
- **Synchronizing capabilities across machines automatically.** Users export and import; we don't push capabilities to a cloud account by default.
- **Mobile / phone targets.** Out of scope for v2.0.
- **Sites that require dedicated MFA tokens for every action.** A login MFA challenge is acceptable; an MFA challenge per click is not supported.
- **Running components outside the host.** Capability bundles are not designed to be run by `wasmtime` standalone or in a browser. The WIT world depends on host services that only the host provides.
- **Capability chaining inside bundles.** Bundles do not declare dependencies on other bundles or compose their outputs. The Component Model supports composition cleanly, so the implementation is not the blocker; the UX is. The AI is the orchestrator by design; chaining inside bundles would re-create the orchestration layer the AI already provides, with worse debuggability (one run record covering N opaque sub-runs) and force a UX (inspect, edit, re-record one link in a chain) we have no answers for. Multi-step workflows compose at the AI prompt layer, not the bundle layer. Revisit only if usage data shows users repeatedly building near-duplicate capabilities that differ only in a glue step.

## 14. Resolved design decisions

This section records decisions whose rationale matters more than their outcome. The decisions themselves are reflected in the requirement sections above; what follows is the reasoning, kept here so future contributors can reopen a decision with context rather than guessing why it was made.

**Pricing during the user-acquisition phase.** Free for everyone until 500+ users with three or more healthy capabilities each, sustained for 30 days. Pre-PMF, every dollar of friction costs us learning. The contributor-free-tier mechanic stays in the design so the flywheel survives the eventual transition to paid. See §11.

**Sandbox review depth for community submissions.** Static checks plus automated dynamic fuzzing for all submissions; spot-check manual review only for capabilities targeting the top 20 most-installed sites. Manual review doesn't scale, slows contributors, and gives a false sense of security. The sandbox is the security boundary, not the reviewer's eyeball. If the sandbox plus fuzz corpus can't catch an issue, the right fix is to extend the corpus, not insert a human. See §6.6.

**Capability chaining is not a bundle-level feature.** The AI orchestrates multiple capability calls; bundles do not compose. The Component Model would support chaining cleanly, which is precisely why this is tempting and precisely why we're declining: chaining inside bundles re-creates an orchestration layer the AI already provides, hides intermediate steps from the user, and forces UX questions (inspect a chain, edit one link, re-record a link in isolation) we have no answers for. See §13.

**Repair disclosure is asymmetric by capability origin.** User-built capabilities: notify-once via dismissible banner, persist automatically. Community-installed capabilities: apply for the current run, require explicit user approval before persisting. The asymmetry matches the threat model; a user repairing their own work is fixing their own work, while a community capability silently rewriting itself on someone else's machine is something else. Both paths log the repair in the run record. See §6.3 and §7.2.

**Per-field redaction defaults to redacted-in-AI, visible-locally.** The asymmetry between local and AI matches the threat model: locally the user looks at their own data; in the AI response the data crosses a network boundary to a third party. Redaction is the correct conservative default. Opt-out exists per field for cases where the data is the point of the capability ("summarize my emails"), but only via an explicit confirmation at save time that surfaces the trade-off. See §7.1 and §9.2.

**WIT version migration treats the contract as a public API.** Additive when possible, deprecated slowly when not, broken never silently. Six-month deprecation window from a new contract release; library badges deprecated capabilities as needing update; after the window, deprecated capabilities are hidden from search but continue to load for users who already installed them. Where a breaking change is unavoidable, the host ships a shim that adapts old components for behavior the shim can express; anything it cannot express fails loudly at load. See §10.

**Toolchain detection over toolchain bundling.** The non-technical primary audience never writes custom logic. Bundling Rust + Go + Python + JS toolchains would inflate the installer by hundreds of MB to serve a small fraction of users. Detect what's installed, give a one-line install command for what's missing, ship vendored copies of `wasm-tools` and `wit-bindgen` (small, single-binary). Rust is the recommended path; other languages are documented but not promised equal polish. Revisit only if we ship a "build your first custom-logic capability" zero-config onboarding flow. See §10.

**Team and enterprise tiers are deferred without painting into a corner.** Out of scope for v2.0. The two architectural surfaces that need to remain extensible are (1) bundle signing, which is already pluggable enough to support org-key signing as a separate path, and (2) run records, whose versioned format can serve as a strict superset for a future audit-log export. Both are checked during architecture review; no code changes are required now.

**UI framework: Tauri, not a Rust-native immediate-mode toolkit.** Choosing Tauri keeps the existing v1 web-stack UI design and component layout reusable, which is the difference between a feasible solo-founder rewrite and one that adds a UI re-authoring project on top of a host rewrite. The trade-off is a system-webview attack surface (WebView2/WKWebView/WebKitGTK), accepted because the UI webview never loads third-party origins and never receives capability components, vault values, or session material. Revisit if a Rust-native UI toolkit reaches feature parity with Tauri's React-frontend ergonomics for complex recording UIs. See §4.1, §9.8.

**Controlled browser: bundled headless Chromium driven by `chromiumoxide`.** Bundling Chromium keeps capability execution reproducible across user machines and avoids the alternatives' worse trade-offs (system Chrome adds a user dependency; shelling to Node + Playwright drags Node back into the trusted base; forking Chromium is unrealistic for a solo founder). Install size remains roughly v1-comparable because Chromium is the bulk; the win is that the trusted computing base shrinks (no Node, no Electron IPC, no V8 isolate sharing process with host). See §0, §4.1, §10.

**Sync-only WASI Preview 2 baseline.** v2.0 ships against the synchronous Component Model. Async exports (a hypothetical Preview 3 feature) are opportunistic, not load-bearing. Capability calls are bounded and short-lived; sync is sufficient. If Preview 3 stabilizes and adds value, it enters via additive WIT migration per §10. See §1, §5.

**Host enforces semantic bounds on repair scoring, not just on sandbox memory.** A malicious component that lies in `score-repair-candidates` or `postflight` cannot escape the sandbox, but could in principle steer a click to a wrong-but-similar candidate or pass off a wrong action. Defenses are host-side: pre-filter candidates by recording-time intent (component can re-order, not substitute); top-N + threshold + structural intent re-check before accepting a scored candidate; structural postflight check independent of component's `postflight`. The sandbox bounds memory and CPU; these checks bound semantic damage. See §9.4.
