// Phase 4 Tauri shell. Allowlisted IPC commands wire the Rust host
// (Phase 1 WIT contract + Phase 3 replay engine) to a vanilla
// HTML/JS frontend. No general "evaluate Rust from JS" surface;
// every privileged action is a typed command per PRD §9.8.
//
// Commands exposed:
//   list_capabilities  -> Vec<CapabilityListItem>
//   run_capability     -> RunRecord (JSON-serializable form)
//
// The capability "library" for this Phase 4 spike is the set of
// fixture recordings under crates/replay/tests/fixtures/. A real
// install loads from a per-user app-data dir; that lands in
// Phase 5 alongside the keychain integration.

use serde::Serialize;
use std::path::PathBuf;
use tauri::{Manager, State};

#[derive(Debug, Clone, Serialize)]
struct CapabilityListItem {
    name: String,
    target_site: String,
    steps: usize,
    fixture_dir: String,
}

struct AppState {
    fixtures_root: PathBuf,
    component_path: PathBuf,
}

#[tauri::command]
fn list_capabilities(state: State<AppState>) -> Result<Vec<CapabilityListItem>, String> {
    let mut out = Vec::new();
    let entries = std::fs::read_dir(&state.fixtures_root)
        .map_err(|e| format!("reading fixtures: {e}"))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("entry: {e}"))?;
        if !entry.path().is_dir() {
            continue;
        }
        let manifest = entry.path().join("manifest.json");
        if !manifest.exists() {
            continue;
        }
        let raw = std::fs::read_to_string(&manifest)
            .map_err(|e| format!("read manifest: {e}"))?;
        let m: recorder::types::RecordingManifest =
            serde_json::from_str(&raw).map_err(|e| format!("parse manifest: {e}"))?;
        out.push(CapabilityListItem {
            name: m.capability_name,
            target_site: m.target_site,
            steps: m.steps.len(),
            fixture_dir: entry.path().to_string_lossy().to_string(),
        });
    }
    Ok(out)
}

#[tauri::command]
async fn run_capability(
    state: State<'_, AppState>,
    name: String,
) -> Result<serde_json::Value, String> {
    let mut fixture_dir: Option<PathBuf> = None;
    let entries = std::fs::read_dir(&state.fixtures_root)
        .map_err(|e| format!("reading fixtures: {e}"))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("entry: {e}"))?;
        let manifest = entry.path().join("manifest.json");
        if !manifest.exists() {
            continue;
        }
        let raw = std::fs::read_to_string(&manifest)
            .map_err(|e| format!("read manifest: {e}"))?;
        let m: recorder::types::RecordingManifest =
            serde_json::from_str(&raw).map_err(|e| format!("parse manifest: {e}"))?;
        if m.capability_name == name {
            fixture_dir = Some(entry.path());
            break;
        }
    }
    let fixture_dir = fixture_dir.ok_or_else(|| format!("capability {name:?} not found"))?;

    let opts = replay::ReplayOptions {
        recording_dir: fixture_dir,
        component_path: state.component_path.clone(),
        headless: true,
        run_record_path: None,
    };
    let record = replay::replay(opts).await.map_err(|e| format!("replay: {e}"))?;
    let value = serde_json::to_value(&record).map_err(|e| format!("serialize: {e}"))?;
    Ok(value)
}

fn main() {
    let workspace_root: PathBuf = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..");
    let fixtures_root = workspace_root.join("crates/replay/tests/fixtures");
    let component_path =
        workspace_root.join("target/wasm32-wasip2/release/reference_capability.wasm");

    tauri::Builder::default()
        .manage(AppState {
            fixtures_root,
            component_path,
        })
        .invoke_handler(tauri::generate_handler![list_capabilities, run_capability])
        .setup(|app| {
            let _ = app.get_webview_window("main");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
