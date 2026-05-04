// Phase 6 protocol-shape tests. Don't launch a browser; just verify
// the JSON-RPC dispatch handles initialize / tools/list / tools/call
// correctly, surfaces typed errors for unknown tools and method
// not found, and refuses calls when the AppLock is locked.

use mcp::Server;
use security::keychain::MemoryKeystore;
use security::AppLock;
use std::path::PathBuf;
use std::time::Duration;

fn server() -> Server {
    let workspace = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..");
    Server {
        fixtures_root: workspace.join("crates/replay/tests/fixtures"),
        component_path: workspace.join("target/wasm32-wasip2/release/reference_capability.wasm"),
        lock: AppLock::new(MemoryKeystore::new(), Duration::from_secs(60)),
    }
}

#[tokio::test]
async fn initialize_returns_server_info() {
    let s = server();
    let resp = s
        .handle(r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}"#)
        .await;
    assert!(resp.contains("\"protocolVersion\""));
    assert!(resp.contains("\"name\":\"purroxy\""));
}

#[tokio::test]
async fn tools_list_advertises_three_tools() {
    let s = server();
    let resp = s
        .handle(r#"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#)
        .await;
    assert!(resp.contains("purroxy_list_capabilities"));
    assert!(resp.contains("purroxy_run_capability"));
    assert!(resp.contains("purroxy_status"));
}

#[tokio::test]
async fn unknown_method_returns_method_not_found() {
    let s = server();
    let resp = s
        .handle(r#"{"jsonrpc":"2.0","id":3,"method":"made/up"}"#)
        .await;
    assert!(resp.contains("\"code\":-32601"));
}

#[tokio::test]
async fn unknown_tool_returns_method_not_found() {
    let s = server();
    let resp = s
        .handle(
            r#"{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"made_up"}}"#,
        )
        .await;
    assert!(resp.contains("\"code\":-32601"));
}

#[tokio::test]
async fn list_capabilities_returns_known_fixtures() {
    let s = server();
    let resp = s
        .handle(
            r#"{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"purroxy_list_capabilities"}}"#,
        )
        .await;
    assert!(resp.contains("synthetic-navigate") || resp.contains("click-more-info") || resp.contains("repair-click-stale-name"));
}

#[tokio::test]
async fn locked_app_refuses_tool_call() {
    let s = server();
    s.lock.set_pin("0000").unwrap();
    s.lock.lock();
    let resp = s
        .handle(
            r#"{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"purroxy_status"}}"#,
        )
        .await;
    assert!(resp.contains("\"code\":-32000"), "expected APP_LOCKED code; got: {resp}");
    assert!(resp.contains("locked"));
}

#[tokio::test]
async fn parse_error_for_garbage() {
    let s = server();
    let resp = s.handle("{ this is not json").await;
    assert!(resp.contains("\"code\":-32700"));
}

#[tokio::test]
async fn missing_run_arg_returns_invalid_params() {
    let s = server();
    let resp = s
        .handle(
            r#"{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"purroxy_run_capability","arguments":{}}}"#,
        )
        .await;
    assert!(resp.contains("\"code\":-32602"), "got: {resp}");
}

#[tokio::test]
async fn unknown_capability_returns_not_found() {
    let s = server();
    let resp = s
        .handle(
            r#"{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"purroxy_run_capability","arguments":{"name":"made-up-capability"}}}"#,
        )
        .await;
    assert!(resp.contains("\"code\":-32001"), "got: {resp}");
}
