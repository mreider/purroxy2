// Dispatch loop. Consumes a JSON-RPC request, routes to a tool
// handler, returns a string response.

use serde_json::{json, Value};
use std::path::PathBuf;

use security::keychain::MemoryKeystore;
use security::AppLock;

use crate::protocol::{codes, err, ok, Request};

pub struct Server {
    pub fixtures_root: PathBuf,
    pub component_path: PathBuf,
    pub lock: AppLock<MemoryKeystore>,
}

impl Server {
    pub async fn handle(&self, raw: &str) -> String {
        let req: Request = match serde_json::from_str(raw) {
            Ok(r) => r,
            Err(e) => {
                return err(Value::Null, codes::PARSE_ERROR, format!("parse error: {e}"));
            }
        };
        if req.jsonrpc != "2.0" {
            return err(
                req.id.clone().unwrap_or(Value::Null),
                codes::INVALID_REQUEST,
                "jsonrpc must be 2.0",
            );
        }
        let id = req.id.clone().unwrap_or(Value::Null);

        match req.method.as_str() {
            "initialize" => ok(
                id,
                json!({
                    "protocolVersion": "2024-11-05",
                    "capabilities": { "tools": {} },
                    "serverInfo": { "name": "purroxy", "version": env!("CARGO_PKG_VERSION") }
                }),
            ),
            "tools/list" => ok(id, tools_list_value()),
            "tools/call" => self.handle_call(id, &req.params).await,
            "notifications/cancelled" | "notifications/initialized" => {
                // Notifications: no response required, return empty
                // success.
                ok(id, json!({}))
            }
            _ => err(id, codes::METHOD_NOT_FOUND, "method not found"),
        }
    }

    async fn handle_call(&self, id: Value, params: &Value) -> String {
        if self.lock.is_locked() {
            return err(id, codes::APP_LOCKED, "app is locked, refused");
        }
        self.lock.record_activity();

        let name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
        let args = params.get("arguments").cloned().unwrap_or(Value::Null);

        match name {
            "purroxy_status" => ok(
                id,
                json!({
                    "content": [{ "type": "text", "text": "ready" }]
                }),
            ),
            "purroxy_list_capabilities" => match self.list_capabilities() {
                Ok(items) => ok(
                    id,
                    json!({
                        "content": [{
                            "type": "text",
                            "text": serde_json::to_string_pretty(&items).unwrap_or_default()
                        }]
                    }),
                ),
                Err(e) => err(id, codes::INTERNAL_ERROR, format!("{e}")),
            },
            "purroxy_run_capability" => match self.run_capability(&args).await {
                Ok(record) => ok(
                    id,
                    json!({
                        "content": [{
                            "type": "text",
                            "text": serde_json::to_string_pretty(&record).unwrap_or_default()
                        }]
                    }),
                ),
                Err((code, msg)) => err(id, code, msg),
            },
            other => err(id, codes::METHOD_NOT_FOUND, format!("unknown tool: {other}")),
        }
    }

    fn list_capabilities(&self) -> Result<Vec<Value>, anyhow::Error> {
        let mut out = Vec::new();
        for entry in std::fs::read_dir(&self.fixtures_root)? {
            let entry = entry?;
            if !entry.path().is_dir() {
                continue;
            }
            let manifest = entry.path().join("manifest.json");
            if !manifest.exists() {
                continue;
            }
            let raw = std::fs::read_to_string(&manifest)?;
            let m: recorder::types::RecordingManifest = serde_json::from_str(&raw)?;
            out.push(json!({
                "name": m.capability_name,
                "target_site": m.target_site,
                "steps": m.steps.len(),
            }));
        }
        Ok(out)
    }

    async fn run_capability(&self, args: &Value) -> Result<replay::RunRecord, (i32, String)> {
        let name = args
            .get("name")
            .and_then(|v| v.as_str())
            .ok_or((codes::INVALID_PARAMS, "missing 'name'".into()))?;

        let mut fixture_dir: Option<PathBuf> = None;
        let entries = std::fs::read_dir(&self.fixtures_root)
            .map_err(|e| (codes::INTERNAL_ERROR, format!("fixtures: {e}")))?;
        for entry in entries {
            let entry = entry.map_err(|e| (codes::INTERNAL_ERROR, format!("entry: {e}")))?;
            let manifest = entry.path().join("manifest.json");
            if !manifest.exists() {
                continue;
            }
            let raw = std::fs::read_to_string(&manifest)
                .map_err(|e| (codes::INTERNAL_ERROR, format!("read manifest: {e}")))?;
            let m: recorder::types::RecordingManifest = serde_json::from_str(&raw)
                .map_err(|e| (codes::INTERNAL_ERROR, format!("parse manifest: {e}")))?;
            if m.capability_name == name {
                fixture_dir = Some(entry.path());
                break;
            }
        }
        let fixture_dir = fixture_dir
            .ok_or((codes::NOT_FOUND, format!("capability {name:?} not found")))?;

        let opts = replay::ReplayOptions {
            recording_dir: fixture_dir,
            component_path: self.component_path.clone(),
            headless: true,
            run_record_path: None,
            event_tx: None,
        };
        replay::replay(opts)
            .await
            .map_err(|e| (codes::REPLAY_FAILED, format!("{e}")))
    }
}

fn tools_list_value() -> Value {
    json!({
        "tools": [
            {
                "name": "purroxy_list_capabilities",
                "description": "List installed Purroxy capabilities.",
                "inputSchema": { "type": "object", "properties": {} }
            },
            {
                "name": "purroxy_run_capability",
                "description": "Run a saved capability against the live browser. Returns the run record.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "name": { "type": "string" }
                    },
                    "required": ["name"]
                }
            },
            {
                "name": "purroxy_status",
                "description": "Return the host status (ready / locked / busy).",
                "inputSchema": { "type": "object", "properties": {} }
            }
        ]
    })
}
