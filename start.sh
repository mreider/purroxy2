#!/usr/bin/env bash
# Local desktop dev launcher.
# Builds release binaries, starts the Tauri desktop app in the
# background, writes logs + PID to /tmp/purroxy-*.
#
# Usage:
#   ./start.sh                  # build (if needed) + launch desktop
#   ./start.sh --rebuild        # force cargo build first
#   ./start.sh --foreground     # run in current terminal (Ctrl+C to stop)
#
# Companion: ./stop.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

PID_FILE="/tmp/purroxy-desktop.pid"
LOG_FILE="/tmp/purroxy-desktop.log"
COMPONENT_WASM="target/wasm32-wasip2/release/reference_capability.wasm"

REBUILD=0
FOREGROUND=0
for arg in "$@"; do
  case "$arg" in
    --rebuild)    REBUILD=1 ;;
    --foreground) FOREGROUND=1 ;;
    -h|--help)
      sed -n '2,11p' "$0"; exit 0 ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "desktop already running (pid $(cat "$PID_FILE")). ./stop.sh first." >&2
  exit 1
fi

. "$HOME/.cargo/env" 2>/dev/null || true

if [[ ! -f "target/release/desktop" || $REBUILD -eq 1 ]]; then
  echo "[start] building desktop (release)..."
  cargo build -p desktop --release
fi

if [[ ! -f "$COMPONENT_WASM" || $REBUILD -eq 1 ]]; then
  echo "[start] building reference-capability wasm component..."
  cargo component build -p reference-capability --release --target wasm32-wasip2
fi

echo "[start] desktop binary: target/release/desktop"
echo "[start] component wasm: $COMPONENT_WASM"

if [[ $FOREGROUND -eq 1 ]]; then
  exec target/release/desktop
fi

nohup target/release/desktop >"$LOG_FILE" 2>&1 &
PID=$!
echo $PID >"$PID_FILE"

sleep 1
if ! kill -0 "$PID" 2>/dev/null; then
  echo "[start] desktop died on launch. log:" >&2
  tail -n 40 "$LOG_FILE" >&2
  rm -f "$PID_FILE"
  exit 1
fi

cat <<EOF
[start] desktop running (pid $PID)
        log:    $LOG_FILE
        stop:   ./stop.sh

Other things you can run separately:
  Record    cargo run -p recorder --release -- record <url> --out /tmp/p-rec --name foo
  Replay    cargo run -p replay --release -- /tmp/p-rec --component $COMPONENT_WASM
  MCP       cargo run -p mcp --release      # stdio JSON-RPC, pipe to a client
EOF
