// Stdio binary. Reads line-delimited JSON-RPC from stdin, dispatches
// via Server::handle, writes responses to stdout. Standard MCP server
// transport for Claude Desktop and Claude Code.

use anyhow::Result;
use security::keychain::MemoryKeystore;
use security::AppLock;
use std::path::PathBuf;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

#[tokio::main]
async fn main() -> Result<()> {
    let workspace_root: PathBuf = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..");
    let fixtures_root = workspace_root.join("crates/replay/tests/fixtures");
    let component_path =
        workspace_root.join("target/wasm32-wasip2/release/reference_capability.wasm");

    let server = mcp::Server {
        fixtures_root,
        component_path,
        // Phase 6 spike uses an in-memory keystore so the server
        // doesn't read the user's actual keychain. The Phase 4
        // Tauri shell wires AppLock to the OsKeystore instead.
        lock: AppLock::new(MemoryKeystore::new(), Duration::from_secs(15 * 60)),
    };

    let stdin = tokio::io::stdin();
    let mut reader = BufReader::new(stdin).lines();
    let mut stdout = tokio::io::stdout();

    while let Some(line) = reader.next_line().await? {
        if line.is_empty() {
            continue;
        }
        let resp = server.handle(&line).await;
        stdout.write_all(resp.as_bytes()).await?;
        stdout.write_all(b"\n").await?;
        stdout.flush().await?;
    }
    Ok(())
}
