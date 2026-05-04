// MCP / JSON-RPC 2.0 message shapes. Just enough of the protocol
// surface for the three Purroxy tools.

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Deserialize)]
pub struct Request {
    pub jsonrpc: String,
    #[serde(default)]
    pub id: Option<Value>,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

#[derive(Debug, Serialize)]
pub struct Response {
    pub jsonrpc: &'static str,
    pub id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<RpcError>,
}

#[derive(Debug, Serialize)]
pub struct RpcError {
    pub code: i32,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

pub mod codes {
    pub const PARSE_ERROR: i32 = -32700;
    pub const INVALID_REQUEST: i32 = -32600;
    pub const METHOD_NOT_FOUND: i32 = -32601;
    pub const INVALID_PARAMS: i32 = -32602;
    pub const INTERNAL_ERROR: i32 = -32603;
    /// Application-defined: app is locked, refused.
    pub const APP_LOCKED: i32 = -32000;
    /// Application-defined: capability not found.
    pub const NOT_FOUND: i32 = -32001;
    /// Application-defined: replay failed.
    pub const REPLAY_FAILED: i32 = -32002;
}

pub fn ok(id: Value, result: Value) -> String {
    serde_json::to_string(&Response {
        jsonrpc: "2.0",
        id,
        result: Some(result),
        error: None,
    })
    .unwrap()
}

pub fn err(id: Value, code: i32, message: impl Into<String>) -> String {
    serde_json::to_string(&Response {
        jsonrpc: "2.0",
        id,
        result: None,
        error: Some(RpcError {
            code,
            message: message.into(),
            data: None,
        }),
    })
    .unwrap()
}
