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

Tauri shell with the IPC commands wired to the replay engine:

```bash
cargo run -p desktop --release
```

A window opens listing the fixture capabilities; click **Run** on a
row to execute the replay. The result JSON shows in the lower pane.

If the window doesn't appear, check that the binary is running:
`ps -ef | grep desktop`. The Tauri webview can take a second to
initialize on first launch.

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
