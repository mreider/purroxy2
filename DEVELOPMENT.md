# Purroxy v2.0 — Development quick start

Companion to `PRD.md` and `IMPLEMENTATION_PLAN.md`. The v1 Electron
codebase sits at the repo root in `core/`, `electron/`, `src/`,
`backend/`. The v2.0 Rust workspace sits in `crates/` and `wit/`.
This doc covers the v2.0 side.

---

## Prerequisites

```bash
# Rust toolchain
brew install rustup
rustup-init -y --default-toolchain stable
. "$HOME/.cargo/env"

# wasm32-wasip2 target (capability components compile here)
rustup target add wasm32-wasip2

# WASM tooling
brew install wasm-tools
cargo install cargo-component

# Browser the controlled-Chromium tests drive
# macOS: requires Google Chrome at /Applications/Google Chrome.app/
brew install --cask google-chrome   # if not already installed
```

Each subsequent shell needs `. "$HOME/.cargo/env"` (or put it in
`~/.zshrc`) so `cargo` is on PATH.

---

## Branch layout

The v2.0 work stacks on a chain of `phase-N/*` branches, each
branched from the previous and adding one phase. The recommended
workspace branch is the latest `phase-N/*` you want; nothing has
been merged to `main` and nothing has been pushed.

```
main                                           v0.1.0 (Electron)
└── v2-design                                   PRD + plan + wit/
    ├── spike/phase-0          (parallel)       throwaway spike
    └── phase-1/wit-integration                 WIT round-trips
        └── phase-2/recording                   recorder crate
            └── phase-3/replay                  replay + repair
                └── phase-4/tauri-ui            Tauri shell
                    └── phase-5/security        vault/sign/lock
                        └── phase-6/mcp         MCP server
                            └── phase-7/registry    bundles
                                └── phase-8/migration   v1→v2
```

Quickest way onto the latest:

```bash
git fetch
git checkout phase-8/migration
```

---

## One-time workspace build

Pulls and compiles the entire workspace. Heavy first run (~7–10
minutes; wasmtime + chromiumoxide + Tauri together).

```bash
cargo build --release --workspace
```

The reference WASM component must be built explicitly with
`cargo-component` because cargo-component handles the Component
Model output:

```bash
cargo component build -p reference-capability --release --target wasm32-wasip2
# Output: target/wasm32-wasip2/release/reference_capability.wasm
```

This is required before running the `host` and `replay` integration
tests.

---

## Run the test suite

Workspace-wide, fast tests only (no live browser):

```bash
cargo test --workspace --release
```

Expect roughly 54 tests across crates, all green:

| crate | tests | what they cover |
|-------|------:|-----------------|
| host | 5 | WIT contract round-trip + smoke fuzz on every export |
| recorder | 3 | manifest JSON shape, snapshot canonicalization |
| security | 20 | Ed25519 signing, vault AEAD, app lock state machine |
| mcp | 9 | JSON-RPC dispatch, error codes, AppLock gate |
| registry | 7 | bundle pack/unpack, signature verify, install flow |
| replay | 3 (ignored) | live browser; see below |

Per-crate runs:

```bash
cargo test -p host --release
cargo test -p recorder --release
cargo test -p security --release
cargo test -p mcp --release
cargo test -p registry --release
```

---

## Run the live browser tests

These launch headless Chromium, navigate to `https://example.com/`,
exercise the full Phase 3 replay path (navigate, click, click+repair).
Skipped by default; opt in with `--ignored`:

```bash
cargo test -p replay --release -- --ignored
```

Expected:

```
test one_step_navigate_round_trips ... ok
test click_link_round_trips ... ok
test repair_click_when_intent_name_is_stale ... ok
```

If they fail with `Browser process exited`, Google Chrome isn't at
`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`. The
path is hard-coded in `crates/replay/src/engine.rs` and
`crates/recorder/src/recording.rs` as `chrome_path`. On a different
platform or non-default install location, edit those.

---

## End-to-end smoke (record → replay)

Record a session and replay it against the same fixture.

### 1. Record

```bash
mkdir -p /tmp/p-rec
cargo run -p recorder --release -- \
  record https://example.com/ \
  --out /tmp/p-rec \
  --name example-test \
  --auto-stop-ms 4000 \
  --headless
```

Output:

```
[recorder] recording https://example.com/ -> /tmp/p-rec
[recorder] interact with the page; press Ctrl+C to finish.
[recorder] auto-stop reached.
[recorder] wrote 0 steps -> /tmp/p-rec/manifest.json
```

(Without `--headless` the browser is visible and the user
demonstrates by clicking; the shim captures real interactions.)

### 2. Replay

```bash
cargo run -p replay --release -- \
  /tmp/p-rec \
  --component target/wasm32-wasip2/release/reference_capability.wasm \
  --out /tmp/p-rec/run.json \
  --headless

cat /tmp/p-rec/run.json
```

You should see a JSON run record with `outcome: "success"`.

### 3. Replay the included fixtures

The replay test fixtures live next to their tests and exercise more
of the engine. They run as part of the live tests above; you can
invoke them directly too:

```bash
cargo run -p replay --release -- \
  crates/replay/tests/fixtures/click-link \
  --component target/wasm32-wasip2/release/reference_capability.wasm \
  --out /tmp/click.json --headless

cat /tmp/click.json
```

Look for `repaired: true` on the `repair-click` fixture — that's the
WIT contract's `score-repair-candidates` flow firing.

---

## Run the desktop UI

Quick launch (recommended for local dev):

```bash
./start.sh        # builds + launches desktop in background, log to /tmp/purroxy-desktop.log
./stop.sh         # SIGTERM the running instance
```

Direct cargo run also works:

```bash
cargo run -p desktop --release
```

The window lists capabilities found in the **library directory**:

- Default: `~/Library/Application Support/Purroxy/recordings` (macOS)
- Override: `PURROXY_LIBRARY=/some/path ./start.sh`

The library is auto-`mkdir -p`'d on first launch. To populate it, use
the recorder CLI with `--out "$LIB/<name>"` (see "End-to-end smoke"
above), then click **Refresh** in the desktop window.

### UI source layout

The Tauri frontend lives in `crates/desktop/dist/` and is served
as-is (no bundler). Files:

| File | Role |
|------|------|
| `index.html` | entry point; loads vendor scripts then JSX in order |
| `app.css` | full stylesheet (light + dark themes) |
| `*.jsx` | React components (`app`, `chrome`, `library`, `wizard`, `detail`, `icons`) |
| `data.js` | MOCK seed data for design preview |
| `ipc.js` | adapter: real Tauri commands when present, MOCK fallback |
| `vendor/` | self-hosted React 18 + ReactDOM + Babel-standalone |
| `brand/` | logo / icons |

JSX is transformed at runtime by Babel-standalone (CSP allows
`'unsafe-eval'` in this app's webview). React is loaded as UMD
globals — no bundler, no module system.

**Designer iteration:** open `crates/desktop/dist/index.html` over
a local HTTP server (`python -m http.server`) for fast reload with
mock data. To test against the real Rust backend, edit JSX, then
`./stop.sh && ./start.sh` (no rebuild needed for frontend-only
changes — the webview reloads files from `dist/` each launch).

The interaction spec lives in `DESIGN_BRIEF.md` at repo root.

### IPC commands the frontend can call

Library:
```ts
invoke('library_info')           -> { root: string, count: number }
invoke('list_capabilities')      -> CapabilityListItem[]
invoke('run_capability', {name}) -> RunRecord
```

Recording (stage B):
```ts
invoke('start_recording', {name, url}) -> { recording_id, output_dir }
invoke('stop_recording')               -> { saved, recording_id, output_dir, steps }
invoke('discard_recording')            -> void
```

`start_recording` spawns the `recorder` binary as a subprocess (path
discovered next to the desktop binary, or `PURROXY_RECORDER_BIN`
override). One recording at a time — concurrent starts return an
error. `stop_recording` sends SIGTERM, waits up to 5s for the
recorder to finalize its manifest, falls back to SIGKILL on timeout.
`discard_recording` stops + removes the partial recording dir.

Library mgmt (stage C):
```ts
invoke('delete_capability', {name})  -> void
invoke('reveal_in_finder', {name})   -> void
invoke('open_library_dir')           -> void
```

`delete_capability` rm-rfs the capability dir under the library root,
with a sanity check that it's actually inside `library_root` and has
a `manifest.json`. `reveal_in_finder` shells out to `open -R`
(macOS), `xdg-open` (Linux), or `explorer /select,` (Windows).
`open_library_dir` opens the library root in the OS file manager.

Rename + settings (stage D):
```ts
invoke('rename_capability', {from, to}) -> string  // returns new slug
invoke('settings_get')                  -> Settings
invoke('settings_set', {key, value})    -> Settings // updated
```

`rename_capability` slugifies `to`, renames the capability dir, and
rewrites `manifest.capability_name`. Returns the canonical new name
(may differ from `to` after slugification).

Settings file: `<library_root>/../purroxy-v2-config.json`. The v2
filename is intentional — the parent dir on macOS is shared with the
v1 Electron build, which uses `config.json`. Don't clobber it.

`settings_set` updates the config file AND calls `std::env::set_var`
for `PURROXY_CHROME`, `PURROXY_COMPONENT`, `PURROXY_LIBRARY` so any
subsequently-spawned recorder subprocess (or in-process replay engine
that reads env at run time) picks up the new values without a
restart. `library_path` change still requires a restart since
`AppState::library_root` is fixed at startup.

Settings keys:
- `chrome_path` — path to Chrome binary (used by recorder + replay)
- `component_path` — path to the WASM repair component
- `library_path` — recordings dir (restart required)
- `appearance` — `system` | `light` | `dark` (frontend-only)

Per-capability run history + diagnostics (stage E/F):
```ts
invoke('debug_info')   -> string  // multi-line text for clipboard copy
```

`run_capability` now writes a slim `last_run.json` next to each
capability after every run (success or failure). Schema:
```json
{
  "at": "epoch:<ms>",
  "status": "success" | "repaired" | "failed",
  "duration_ms": N,
  "reason": "...",      // populated on failed/needs_review
  "step_results": [{"step_id": "step-0001", "repaired": false, "executed": true}, ...]
}
```

`list_capabilities` now returns a richer shape: `capability_id`,
`created_at`, `updated_at` (filesystem timestamps as
`epoch:<secs>.<ms>` strings), `last_run` (read from disk), and
`step_list` (built from `manifest.steps`, with per-step
`repaired` / `failed` booleans merged from `last_run.step_results`).
The detail view's step table renders directly from this.

`run_capability` also inlines a `last_run_summary` field on its
returned value so the frontend can update the row optimistically
without re-fetching the whole list.

Bundle import/export (stage G):
```ts
invoke('pick_save_bundle_path', {defaultName})  -> string | null
invoke('pick_import_bundle_path')               -> string | null
invoke('export_capability', {name, destPath})   -> void
invoke('import_bundle', {bundlePath})           -> string  // installed name (slugified, suffixed if collision)
```

`export_capability` calls `registry::pack` with the user's signing
key from the OS keychain (`security::keychain::OsKeystore`). First
export on macOS will trigger a Keychain access prompt. Bundle = a
ZIP with `manifest.json`, `snapshots/*.json`, optional `logic.wasm`,
plus `signature.bin` + `public_key.bin`. Files are deterministic and
sorted; signature covers the canonical payload (PRD §3).

`import_bundle` reads bytes, peeks at the embedded `manifest.json`
to derive the capability name, suffixes with `-2`, `-3`, ... if the
slot is taken, then calls `registry::install_from_bytes`, which
verifies the signature before extracting. A failed signature is
rejected and the partial dir is removed (PRD §7.5).

File pickers (stage H):
```ts
invoke('pick_library_dir')         -> string | null
invoke('pick_save_bundle_path', …) -> string | null
invoke('pick_import_bundle_path')  -> string | null
```

Backed by the `rfd` crate (native macOS/Windows/Linux dialogs). No
plugin install required.

Per-step duration (stage H): `StepOutcome.duration_ms` and
`ReplayEvent::Step.duration_ms` populated from `Instant` measured
around the action+postflight loop in the engine. Surfaced in the
detail view step list and in `last_run.json`.

MCP / Claude Desktop integration (stage I):
```ts
invoke('mcp_info')  -> { binary_path, binary_exists, library_path, claude_config_snippet }
invoke('mcp_test')  -> string  // first JSON-RPC line from a probe initialize
```

`mcp_info` returns a Claude Desktop config snippet pre-filled with
the MCP binary path + the user's `PURROXY_LIBRARY` env var.
`mcp_test` spawns the binary, sends an `initialize` JSON-RPC, reads
one line back, kills the child. 3-second timeout. Settings sheet
exposes a "Copy config snippet" button + "Test connection" button.

The MCP binary discovery mirrors the recorder: `PURROXY_MCP_BIN`
env, sibling to desktop, then workspace fallback.

Desktop unit tests (stage J): `crates/desktop/src/main.rs` has
`#[cfg(test)] mod tests` covering `slugify`, `build_step_list`
(intent fallback + last_run merge), and `summarize_run_record`
(success/repaired/needs_review status derivation). Pure logic, no
Tauri context. `cargo test -p desktop --release` → 8 passing.

### Tauri events the frontend subscribes to

Recorder lifecycle (NDJSON forwarded from the recorder subprocess):
```
recorder:started   { recording_id, start_url, capability_name, output_dir }
recorder:step      { step_id, step_index, kind, intent: {role, name} }
recorder:finished  { stop_reason: "ctrl_c"|"sigterm"|"auto_stop", steps, manifest_path }
recorder:error     { message }
recorder:closed    { exit_code, unexpected: bool, output_dir }
recorder:log       { stream?: "stderr", line }
```

`recorder:closed` is emitted by the desktop watcher task (not the
recorder itself) when the child process exits. `unexpected: true`
means the user didn't call `stop_recording` — treat as a crash and
offer to save partial / discard.

Replay lifecycle (emitted by the desktop while a `run_capability` is
in progress):
```
replay:started   { recording_id, total_steps, capability }
replay:step      { step_id, step_index, action, intent_role, intent_name, executed, repaired, capability }
replay:finished  { outcome: "success"|"needs_review"|"aborted", reason?, capability }
```

The frontend filters by `capability` so multiple in-flight runs route
to their own toasts.

### Recorder NDJSON event stream

When invoked with `--events ndjson`, the recorder emits one JSON
object per stdout line (human messages go to stderr in this mode).
The desktop subscribes via Tauri events `recorder:<event_name>`.

Schema (v1):
```json
{"v":1,"event":"started","at":"...","recording_id":"rec-...","start_url":"...","capability_name":"...","output_dir":"..."}
{"v":1,"event":"step","at":"...","recording_id":"...","step_id":"step-0001","step_index":1,"kind":"click","intent":{"role":"button","name":"Sign in"}}
{"v":1,"event":"finished","at":"...","recording_id":"...","stop_reason":"sigterm|ctrl_c|auto_stop","steps":N,"manifest_path":"..."}
```

The manifest is written incrementally after every step, so a hard
kill mid-recording leaves a usable (partial) `manifest.json` in the
output directory.

---

## Run the MCP server

Speaks JSON-RPC 2.0 over stdio. Wire to a client (Claude Code,
Claude Desktop) by pointing at the binary.

Quick smoke without a real client:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' | \
  cargo run -p mcp --release
```

Expected response on stdout:

```json
{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"serverInfo":{"name":"purroxy","version":"0.1.0"}}}
```

For Claude Code:

```bash
# Build the binary first
cargo build -p mcp --release

# Register it with Claude Code (path absolute)
claude mcp add purroxy "$(pwd)/target/release/mcp"
```

---

## WIT contract validation

The canonical WIT lives under `wit/` (multi-package layout for
wasm-tools and wasmtime bindgen). Verify it parses:

```bash
wasm-tools component wit ./wit/
```

The reference capability uses a flattened single-file copy at
`crates/reference-capability/wit/world.wit` because cargo-component
v0.21 doesn't follow the multi-package wit/deps layout. Both must
stay in sync until that converges.

---

## Common pitfalls

- **`Cannot find context with specified id`** during replay: the
  wait_for_navigation + `evaluate("1")` retry loop in the engine
  handles this. If it crops up on a new test, the action probably
  triggered a navigation that hadn't settled before the next CDP
  call.
- **`SingletonLock` errors when running parallel browser tests**:
  each `replay::replay` invocation gets a unique
  `user_data_dir`. Don't run `cargo test -p replay -- --ignored`
  with `--test-threads=1` *and* a custom user-data-dir at the same
  time.
- **`wasi:io/poll` import error during component instantiation**:
  cargo-component pulls the WASIp1 adapter even when targeting
  wasip2. Workaround: the host links wasmtime-wasi (Phase 1
  followup is to strip these imports at component build time).

---

## Where to look for what

| Topic | File |
|-------|------|
| Product spec | `PRD.md` |
| Phase plan | `IMPLEMENTATION_PLAN.md` |
| WIT contract (canonical) | `wit/capability.wit` + `wit/deps/` |
| WIT contract (flat copy) | `crates/reference-capability/wit/world.wit` |
| Reference component impl | `crates/reference-capability/src/lib.rs` |
| Recording loop | `crates/recorder/src/recording.rs` |
| JS shim | `crates/recorder/src/shim.js` |
| Replay engine + repair | `crates/replay/src/engine.rs` |
| Tauri commands | `crates/desktop/src/main.rs` |
| Vault, signing, lock | `crates/security/src/{vault,signing,lock}.rs` |
| MCP dispatch | `crates/mcp/src/server.rs` |
| Bundle pack/unpack | `crates/registry/src/bundle.rs` |
