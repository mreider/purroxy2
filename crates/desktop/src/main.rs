// Tauri shell. Allowlisted IPC commands wire the Rust host (Phase 1
// WIT contract + Phase 3 replay engine) to a vanilla HTML/JS
// frontend. No general "evaluate Rust from JS" surface; every
// privileged action is a typed command per PRD §9.8.
//
// Commands exposed:
//   library_info       -> { root, count }
//   list_capabilities  -> Vec<CapabilityListItem>
//   run_capability     -> RunRecord (JSON-serializable form)
//
// Recording library lives on disk at $PURROXY_LIBRARY (default:
// ~/Library/Application Support/Purroxy/recordings on macOS). Each
// subdir with a manifest.json is a capability. The recorder CLI
// writes here directly via `--out`. Filesystem is the source of
// truth; UI lists are recomputed on demand, no in-memory cache.

mod recorder_proc;
mod settings;

use recorder_proc::{RecorderProcState, StartedRecording, StopResult};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, State};
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize)]
struct CapabilityListItem {
    name: String,
    target_site: String,
    steps: usize,
    dir: String,
    capability_id: String,
    created_at: Option<String>,
    updated_at: Option<String>,
    last_run: Option<LastRun>,
    step_list: Vec<StepListItem>,
}

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
struct LastRun {
    at: String,
    status: String,         // "success" | "repaired" | "failed"
    duration_ms: u64,
    #[serde(default)]
    reason: Option<String>,
    /// Per-step booleans keyed by step_id, used to mark step_list rows.
    #[serde(default)]
    step_results: Vec<LastRunStep>,
}

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
struct LastRunStep {
    step_id: String,
    #[serde(default)]
    repaired: bool,
    #[serde(default)]
    executed: bool,
    #[serde(default)]
    duration_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
struct StepListItem {
    idx: usize,
    action: String,
    role: String,
    intent: String,
    repaired: bool,
    failed: bool,
    duration_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
struct LibraryInfo {
    root: String,
    count: usize,
}

struct AppState {
    library_root: PathBuf,
    component_path: PathBuf,
    recorder_state: Arc<RecorderProcState>,
    settings: Mutex<settings::Settings>,
}

fn read_manifests(root: &PathBuf) -> Result<Vec<(PathBuf, recorder::types::RecordingManifest)>, String> {
    let mut out = Vec::new();
    let entries = std::fs::read_dir(root)
        .map_err(|e| format!("reading library {}: {e}", root.display()))?;
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
            .map_err(|e| format!("read {}: {e}", manifest.display()))?;
        let m: recorder::types::RecordingManifest =
            serde_json::from_str(&raw).map_err(|e| format!("parse {}: {e}", manifest.display()))?;
        out.push((entry.path(), m));
    }
    Ok(out)
}

fn read_last_run(dir: &PathBuf) -> Option<LastRun> {
    let path = dir.join("last_run.json");
    let raw = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str(&raw).ok()
}

fn write_last_run(dir: &PathBuf, lr: &LastRun) -> Result<(), String> {
    let json = serde_json::to_string_pretty(lr).map_err(|e| format!("serialize: {e}"))?;
    std::fs::write(dir.join("last_run.json"), json)
        .map_err(|e| format!("write last_run.json: {e}"))?;
    Ok(())
}

fn epoch_iso(time: std::time::SystemTime) -> Option<String> {
    let d = time.duration_since(std::time::UNIX_EPOCH).ok()?;
    Some(format!("epoch:{}.{:03}", d.as_secs(), d.subsec_millis()))
}

fn build_step_list(
    manifest: &recorder::types::RecordingManifest,
    last_run: Option<&LastRun>,
) -> Vec<StepListItem> {
    let by_id: std::collections::HashMap<String, &LastRunStep> = last_run
        .map(|lr| {
            lr.step_results
                .iter()
                .map(|s| (s.step_id.clone(), s))
                .collect()
        })
        .unwrap_or_default();

    manifest
        .steps
        .iter()
        .enumerate()
        .map(|(i, step)| {
            let action = match &step.action {
                recorder::types::ActionKind::Click { .. } => "click",
                recorder::types::ActionKind::Input { .. } => "input",
                recorder::types::ActionKind::Navigate { .. } => "navigate",
            };
            let role = step.intent.target_role.clone();
            let intent = step.intent.target_name_pattern.clone().unwrap_or_else(|| {
                if let recorder::types::ActionKind::Navigate { url } = &step.action {
                    url.clone()
                } else {
                    role.clone()
                }
            });
            let lr = by_id.get(&step.id);
            StepListItem {
                idx: i + 1,
                action: action.to_string(),
                role,
                intent,
                repaired: lr.map(|s| s.repaired).unwrap_or(false),
                failed: lr.map(|s| !s.executed).unwrap_or(false),
                duration_ms: lr.map(|s| s.duration_ms).unwrap_or(0),
            }
        })
        .collect()
}

fn summarize_run_record(record: &replay::RunRecord) -> LastRun {
    let any_repaired = record.steps.iter().any(|s| s.repaired);
    let status = match &record.outcome {
        replay::RunOutcome::Success => {
            if any_repaired { "repaired" } else { "success" }
        }
        replay::RunOutcome::NeedsReview { .. } | replay::RunOutcome::Aborted { .. } => "failed",
    };
    let reason = match &record.outcome {
        replay::RunOutcome::Success => None,
        replay::RunOutcome::NeedsReview { reason, .. } => Some(reason.clone()),
        replay::RunOutcome::Aborted { reason } => Some(reason.clone()),
    };
    let duration_ms = record.ended_at_ms.saturating_sub(record.started_at_ms);
    let step_results = record
        .steps
        .iter()
        .map(|s| LastRunStep {
            step_id: s.step_id.clone(),
            repaired: s.repaired,
            executed: s.action_executed,
            duration_ms: s.duration_ms,
        })
        .collect();
    let at = format!("epoch:{}", record.ended_at_ms);
    LastRun {
        at,
        status: status.to_string(),
        duration_ms,
        reason,
        step_results,
    }
}

#[tauri::command]
fn library_info(state: State<AppState>) -> Result<LibraryInfo, String> {
    let count = read_manifests(&state.library_root)
        .map(|v| v.len())
        .unwrap_or(0);
    Ok(LibraryInfo {
        root: state.library_root.to_string_lossy().to_string(),
        count,
    })
}

#[tauri::command]
fn list_capabilities(state: State<AppState>) -> Result<Vec<CapabilityListItem>, String> {
    let manifests = read_manifests(&state.library_root)?;
    Ok(manifests
        .into_iter()
        .map(|(path, m)| {
            let last_run = read_last_run(&path);
            let step_list = build_step_list(&m, last_run.as_ref());
            let meta = std::fs::metadata(&path).ok();
            let created_at = meta
                .as_ref()
                .and_then(|md| md.created().ok())
                .and_then(epoch_iso);
            let updated_at = meta
                .as_ref()
                .and_then(|md| md.modified().ok())
                .and_then(epoch_iso);
            CapabilityListItem {
                name: m.capability_name,
                target_site: m.target_site,
                steps: m.steps.len(),
                dir: path.to_string_lossy().to_string(),
                capability_id: m.recording_id.clone(),
                created_at,
                updated_at,
                last_run,
                step_list,
            }
        })
        .collect())
}

#[tauri::command]
async fn start_recording(
    app: AppHandle,
    state: State<'_, AppState>,
    name: String,
    url: String,
) -> Result<StartedRecording, String> {
    recorder_proc::start(
        state.recorder_state.clone(),
        app,
        state.library_root.clone(),
        name,
        url,
    )
    .await
}

#[tauri::command]
async fn stop_recording(state: State<'_, AppState>) -> Result<StopResult, String> {
    recorder_proc::stop(state.recorder_state.clone()).await
}

#[tauri::command]
async fn discard_recording(state: State<'_, AppState>) -> Result<(), String> {
    recorder_proc::discard(state.recorder_state.clone()).await
}

#[tauri::command]
fn delete_capability(state: State<AppState>, name: String) -> Result<(), String> {
    let manifests = read_manifests(&state.library_root)?;
    let dir = manifests
        .into_iter()
        .find(|(_, m)| m.capability_name == name)
        .map(|(p, _)| p)
        .ok_or_else(|| format!("capability {name:?} not found"))?;

    // Sanity: only delete dirs that look like a recording and live
    // under the library root.
    let canonical_lib = std::fs::canonicalize(&state.library_root)
        .unwrap_or_else(|_| state.library_root.clone());
    let canonical_dir = std::fs::canonicalize(&dir).unwrap_or_else(|_| dir.clone());
    if !canonical_dir.starts_with(&canonical_lib) {
        return Err(format!(
            "refusing to delete {} (outside library {})",
            canonical_dir.display(),
            canonical_lib.display()
        ));
    }
    if !canonical_dir.join("manifest.json").exists() {
        return Err(format!(
            "refusing to delete {} (no manifest.json)",
            canonical_dir.display()
        ));
    }
    std::fs::remove_dir_all(&canonical_dir)
        .map_err(|e| format!("rm -rf {}: {e}", canonical_dir.display()))?;
    Ok(())
}

#[tauri::command]
async fn rename_capability(
    state: State<'_, AppState>,
    from: String,
    to: String,
) -> Result<String, String> {
    let manifests = read_manifests(&state.library_root)?;
    let (from_dir, mut manifest) = manifests
        .into_iter()
        .find(|(_, m)| m.capability_name == from)
        .ok_or_else(|| format!("capability {from:?} not found"))?;

    let new_slug = slugify(&to);
    if new_slug.is_empty() {
        return Err("name cannot be empty".into());
    }
    if new_slug == from {
        return Ok(new_slug);
    }
    let new_dir = state.library_root.join(&new_slug);
    if new_dir.exists() {
        return Err(format!("a recording named {new_slug:?} already exists"));
    }

    std::fs::rename(&from_dir, &new_dir).map_err(|e| format!("rename: {e}"))?;
    manifest.capability_name = new_slug.clone();
    let json = serde_json::to_string_pretty(&manifest).map_err(|e| format!("serialize: {e}"))?;
    std::fs::write(new_dir.join("manifest.json"), json)
        .map_err(|e| format!("write manifest: {e}"))?;
    Ok(new_slug)
}

#[tauri::command]
async fn settings_get(state: State<'_, AppState>) -> Result<settings::Settings, String> {
    let s = state.settings.lock().await;
    Ok(s.clone())
}

#[tauri::command]
async fn settings_set(
    state: State<'_, AppState>,
    key: String,
    value: String,
) -> Result<settings::Settings, String> {
    let mut s = state.settings.lock().await;
    match key.as_str() {
        "chrome_path" => s.chrome_path = value,
        "component_path" => s.component_path = value,
        "library_path" => s.library_path = value, // takes effect on restart
        "appearance" => s.appearance = value,
        other => return Err(format!("unknown setting key: {other}")),
    }
    settings::save(&state.library_root, &s)?;
    settings::apply_env(&s);
    Ok(s.clone())
}

fn slugify(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut last_dash = true;
    for ch in s.to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
            last_dash = false;
        } else if !last_dash {
            out.push('-');
            last_dash = true;
        }
    }
    out.trim_matches('-').to_string()
}

#[tauri::command]
fn open_library_dir(state: State<AppState>) -> Result<(), String> {
    let path = state.library_root.to_string_lossy().to_string();
    open_path_in_os(&path)
}

// ----- File dialogs (rfd-backed) ------------------------------------------

#[tauri::command]
async fn pick_save_bundle_path(default_name: String) -> Result<Option<String>, String> {
    let res = tokio::task::spawn_blocking(move || {
        rfd::FileDialog::new()
            .set_file_name(&format!("{default_name}.purroxy"))
            .add_filter("Purroxy bundle", &["purroxy"])
            .save_file()
            .map(|p| p.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| format!("dialog: {e}"))?;
    Ok(res)
}

#[tauri::command]
async fn pick_import_bundle_path() -> Result<Option<String>, String> {
    let res = tokio::task::spawn_blocking(|| {
        rfd::FileDialog::new()
            .add_filter("Purroxy bundle", &["purroxy"])
            .pick_file()
            .map(|p| p.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| format!("dialog: {e}"))?;
    Ok(res)
}

#[tauri::command]
async fn pick_library_dir() -> Result<Option<String>, String> {
    let res = tokio::task::spawn_blocking(|| {
        rfd::FileDialog::new()
            .pick_folder()
            .map(|p| p.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| format!("dialog: {e}"))?;
    Ok(res)
}

// ----- Bundle export / import --------------------------------------------

#[tauri::command]
async fn export_capability(
    state: State<'_, AppState>,
    name: String,
    dest_path: String,
) -> Result<(), String> {
    let manifests = read_manifests(&state.library_root)?;
    let dir = manifests
        .into_iter()
        .find(|(_, m)| m.capability_name == name)
        .map(|(p, _)| p)
        .ok_or_else(|| format!("capability {name:?} not found"))?;

    let dest = std::path::PathBuf::from(&dest_path);

    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let store = security::keychain::OsKeystore;
        let key = security::SigningKey::load_or_generate(&store)
            .map_err(|e| format!("signing key: {e}"))?;
        let bytes = registry::pack(
            &registry::PackInputs {
                recording_dir: dir,
                logic_wasm: None,
            },
            &key,
        )
        .map_err(|e| format!("pack: {e}"))?;
        std::fs::write(&dest, bytes).map_err(|e| format!("write {}: {e}", dest.display()))?;
        Ok(())
    })
    .await
    .map_err(|e| format!("join: {e}"))??;
    Ok(())
}

#[tauri::command]
async fn import_bundle(
    state: State<'_, AppState>,
    bundle_path: String,
) -> Result<String, String> {
    let library_root = state.library_root.clone();
    let path = std::path::PathBuf::from(&bundle_path);

    let installed_name = tokio::task::spawn_blocking(move || -> Result<String, String> {
        let bytes = std::fs::read(&path).map_err(|e| format!("read {}: {e}", path.display()))?;
        // Peek at the manifest inside the bundle to derive the
        // capability name. We re-implement a tiny part of unpack here
        // because install_from_bytes wants the name up front.
        let cursor = std::io::Cursor::new(&bytes);
        let mut zip = zip::ZipArchive::new(cursor).map_err(|e| format!("not a zip: {e}"))?;
        let mut manifest_raw = String::new();
        {
            use std::io::Read;
            let mut f = zip
                .by_name("manifest.json")
                .map_err(|e| format!("missing manifest.json: {e}"))?;
            f.read_to_string(&mut manifest_raw)
                .map_err(|e| format!("read manifest: {e}"))?;
        }
        let m: recorder::types::RecordingManifest =
            serde_json::from_str(&manifest_raw).map_err(|e| format!("parse manifest: {e}"))?;
        let cap_name = m.capability_name.clone();

        // Don't clobber an existing recording; install under a
        // suffixed name if the slot is taken.
        let mut target_name = cap_name.clone();
        let mut n = 2;
        while library_root.join(&target_name).exists() {
            target_name = format!("{cap_name}-{n}");
            n += 1;
        }

        registry::install_from_bytes(
            &bytes,
            &registry::InstallOptions {
                library_root: &library_root,
                capability_name: &target_name,
            },
        )
        .map_err(|e| format!("install: {e}"))?;

        // If install_from_bytes laid down the dir under target_name
        // but the manifest still says cap_name, rewrite manifest so
        // list_capabilities sees the unique name.
        if target_name != cap_name {
            let manifest_path = library_root.join(&target_name).join("manifest.json");
            if let Ok(raw) = std::fs::read_to_string(&manifest_path) {
                if let Ok(mut mm) =
                    serde_json::from_str::<recorder::types::RecordingManifest>(&raw)
                {
                    mm.capability_name = target_name.clone();
                    if let Ok(json) = serde_json::to_string_pretty(&mm) {
                        let _ = std::fs::write(&manifest_path, json);
                    }
                }
            }
        }

        Ok(target_name)
    })
    .await
    .map_err(|e| format!("join: {e}"))??;

    Ok(installed_name)
}

// ----- MCP integration ---------------------------------------------------

#[derive(Debug, Clone, Serialize)]
struct McpInfo {
    binary_path: String,
    binary_exists: bool,
    library_path: String,
    claude_config_snippet: String,
}

fn mcp_binary() -> std::path::PathBuf {
    if let Ok(p) = std::env::var("PURROXY_MCP_BIN") {
        return std::path::PathBuf::from(p);
    }
    let exe = std::env::current_exe().unwrap_or_else(|_| std::path::PathBuf::from("desktop"));
    if let Some(dir) = exe.parent() {
        let cand = dir.join(if cfg!(windows) { "mcp.exe" } else { "mcp" });
        if cand.exists() {
            return cand;
        }
    }
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join(if cfg!(windows) { "target/release/mcp.exe" } else { "target/release/mcp" })
}

#[tauri::command]
fn mcp_info(state: State<AppState>) -> Result<McpInfo, String> {
    let bin = mcp_binary();
    let exists = bin.exists();
    let library = state.library_root.to_string_lossy().to_string();
    // Claude Desktop config block. The user adds this under
    // ~/Library/Application Support/Claude/claude_desktop_config.json
    // (macOS) -> "mcpServers" -> "purroxy".
    let snippet = serde_json::to_string_pretty(&serde_json::json!({
        "mcpServers": {
            "purroxy": {
                "command": bin.to_string_lossy(),
                "env": {
                    "PURROXY_LIBRARY": library,
                }
            }
        }
    }))
    .unwrap_or_else(|_| "{}".to_string());
    Ok(McpInfo {
        binary_path: bin.to_string_lossy().to_string(),
        binary_exists: exists,
        library_path: state.library_root.to_string_lossy().to_string(),
        claude_config_snippet: snippet,
    })
}

#[tauri::command]
async fn mcp_test() -> Result<String, String> {
    use tokio::io::AsyncWriteExt;
    let bin = mcp_binary();
    if !bin.exists() {
        return Err(format!("mcp binary not found at {}", bin.display()));
    }
    let mut cmd = tokio::process::Command::new(&bin);
    cmd.stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    let mut child = cmd.spawn().map_err(|e| format!("spawn: {e}"))?;
    let mut stdin = child.stdin.take().ok_or_else(|| "no stdin".to_string())?;
    let stdout = child.stdout.take().ok_or_else(|| "no stdout".to_string())?;

    // Send an initialize request and read one line back.
    stdin
        .write_all(b"{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{}}\n")
        .await
        .map_err(|e| format!("write: {e}"))?;
    drop(stdin);

    let mut reader = tokio::io::BufReader::new(stdout);
    let mut line = String::new();
    let read_fut = tokio::io::AsyncBufReadExt::read_line(&mut reader, &mut line);
    let timed = tokio::time::timeout(std::time::Duration::from_secs(3), read_fut)
        .await
        .map_err(|_| "timed out waiting for response".to_string())?;
    timed.map_err(|e| format!("read: {e}"))?;
    let _ = child.kill().await;
    if line.trim().is_empty() {
        Err("empty response".into())
    } else {
        Ok(line.trim().to_string())
    }
}

#[tauri::command]
async fn debug_info(state: State<'_, AppState>) -> Result<String, String> {
    let s = state.settings.lock().await;
    let mut out = String::new();
    out.push_str("# Purroxy desktop debug info\n\n");
    out.push_str(&format!("app_version:    {}\n", env!("CARGO_PKG_VERSION")));
    out.push_str(&format!("os:             {}\n", std::env::consts::OS));
    out.push_str(&format!("arch:           {}\n", std::env::consts::ARCH));
    out.push_str(&format!("library_path:   {}\n", state.library_root.display()));
    out.push_str(&format!("component_path: {}\n", state.component_path.display()));
    out.push_str(&format!("chrome_path:    {}\n", s.chrome_path));
    out.push_str(&format!("appearance:     {}\n", s.appearance));
    out.push_str(&format!(
        "config_file:    {}\n",
        settings::config_path(&state.library_root).display()
    ));
    let manifests = read_manifests(&state.library_root).unwrap_or_default();
    out.push_str(&format!("recordings:     {}\n", manifests.len()));
    Ok(out)
}

fn open_path_in_os(path: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(path).status();
    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("explorer").arg(path).status();
    #[cfg(all(unix, not(target_os = "macos")))]
    let result = std::process::Command::new("xdg-open").arg(path).status();

    result.map_err(|e| format!("open: {e}"))?;
    Ok(())
}

#[tauri::command]
fn reveal_in_finder(state: State<AppState>, name: String) -> Result<(), String> {
    let manifests = read_manifests(&state.library_root)?;
    let dir = manifests
        .into_iter()
        .find(|(_, m)| m.capability_name == name)
        .map(|(p, _)| p)
        .ok_or_else(|| format!("capability {name:?} not found"))?;
    let path = dir.to_string_lossy().to_string();

    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg("-R").arg(&path).status();
    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("explorer")
        .arg(format!("/select,{}", path))
        .status();
    #[cfg(all(unix, not(target_os = "macos")))]
    let result = std::process::Command::new("xdg-open").arg(&path).status();

    result.map_err(|e| format!("reveal: {e}"))?;
    Ok(())
}

#[tauri::command]
async fn run_capability(
    app: AppHandle,
    state: State<'_, AppState>,
    name: String,
) -> Result<serde_json::Value, String> {
    let manifests = read_manifests(&state.library_root)?;
    let dir = manifests
        .into_iter()
        .find(|(_, m)| m.capability_name == name)
        .map(|(p, _)| p)
        .ok_or_else(|| format!("capability {name:?} not found in {}", state.library_root.display()))?;

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<replay::ReplayEvent>();

    // Pump replay events -> Tauri events. Each event tagged with the
    // capability name so the frontend can route to the right toast.
    let pump_app = app.clone();
    let pump_name = name.clone();
    let pump = tokio::spawn(async move {
        use tauri::Emitter;
        while let Some(ev) = rx.recv().await {
            let event_name = match &ev {
                replay::ReplayEvent::Started { .. } => "replay:started",
                replay::ReplayEvent::Step { .. } => "replay:step",
                replay::ReplayEvent::Finished { .. } => "replay:finished",
            };
            let mut payload = serde_json::to_value(&ev).unwrap_or(serde_json::Value::Null);
            if let Some(obj) = payload.as_object_mut() {
                obj.insert(
                    "capability".to_string(),
                    serde_json::Value::String(pump_name.clone()),
                );
            }
            let _ = pump_app.emit(event_name, payload);
        }
    });

    let dir_for_persist = dir.clone();
    let opts = replay::ReplayOptions {
        recording_dir: dir,
        component_path: state.component_path.clone(),
        headless: true,
        run_record_path: None,
        event_tx: Some(tx),
    };
    let result = replay::replay(opts).await;
    // Sender drops on opts going out of scope; pump exits.
    let _ = pump.await;

    match result {
        Ok(record) => {
            let summary = summarize_run_record(&record);
            let _ = write_last_run(&dir_for_persist, &summary);
            let mut value = serde_json::to_value(&record)
                .map_err(|e| format!("serialize: {e}"))?;
            // Inline the summary so the frontend can update its row
            // without re-fetching the list.
            if let Some(obj) = value.as_object_mut() {
                obj.insert(
                    "last_run_summary".to_string(),
                    serde_json::to_value(&summary).unwrap_or(serde_json::Value::Null),
                );
            }
            Ok(value)
        }
        Err(e) => {
            let reason = format!("{e}");
            let summary = LastRun {
                at: format!("epoch:{}", epoch_ms_now()),
                status: "failed".into(),
                duration_ms: 0,
                reason: Some(reason.clone()),
                step_results: vec![],
            };
            let _ = write_last_run(&dir_for_persist, &summary);
            Err(format!("replay: {reason}"))
        }
    }
}

fn epoch_ms_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn default_library_root() -> PathBuf {
    if let Ok(p) = std::env::var("PURROXY_LIBRARY") {
        return PathBuf::from(p);
    }
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    if cfg!(target_os = "macos") {
        PathBuf::from(home).join("Library/Application Support/Purroxy/recordings")
    } else if cfg!(target_os = "windows") {
        if let Ok(appdata) = std::env::var("APPDATA") {
            PathBuf::from(appdata).join("Purroxy/recordings")
        } else {
            PathBuf::from(home).join("Purroxy/recordings")
        }
    } else {
        let xdg = std::env::var("XDG_DATA_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from(&home).join(".local/share"));
        xdg.join("purroxy/recordings")
    }
}

fn default_component_path() -> PathBuf {
    if let Ok(p) = std::env::var("PURROXY_COMPONENT") {
        return PathBuf::from(p);
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("target/wasm32-wasip2/release/reference_capability.wasm")
}

fn main() {
    let library_root = default_library_root();
    if let Err(e) = std::fs::create_dir_all(&library_root) {
        eprintln!(
            "[desktop] WARN: could not create library {}: {e}",
            library_root.display()
        );
    }
    let component_path = default_component_path();
    let initial_settings = settings::load(&library_root, &component_path);
    settings::apply_env(&initial_settings);
    eprintln!("[desktop] library:   {}", library_root.display());
    eprintln!("[desktop] component: {}", component_path.display());
    eprintln!("[desktop] chrome:    {}", initial_settings.chrome_path);

    tauri::Builder::default()
        .manage(AppState {
            library_root,
            component_path,
            recorder_state: Arc::new(RecorderProcState::new()),
            settings: Mutex::new(initial_settings),
        })
        .invoke_handler(tauri::generate_handler![
            library_info,
            list_capabilities,
            run_capability,
            start_recording,
            stop_recording,
            discard_recording,
            delete_capability,
            reveal_in_finder,
            rename_capability,
            settings_get,
            settings_set,
            open_library_dir,
            debug_info,
            pick_save_bundle_path,
            pick_import_bundle_path,
            pick_library_dir,
            export_capability,
            import_bundle,
            mcp_info,
            mcp_test,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use recorder::types::{ActionKind, RecordedStep, RecordingManifest, StepIntent};
    use replay::{ExportOutcome, RunOutcome, RunRecord, StepOutcome};

    fn manifest_with_steps(steps: Vec<RecordedStep>) -> RecordingManifest {
        RecordingManifest {
            recording_id: "rec-test".into(),
            target_site: "https://example.com/".into(),
            capability_name: "test-cap".into(),
            bundle_version: 1,
            wit_version: "purroxy:capability@1.0.0".into(),
            steps,
        }
    }

    fn step(id: &str, action: ActionKind, role: &str, name: Option<&str>) -> RecordedStep {
        RecordedStep {
            id: id.into(),
            intent: StepIntent {
                target_role: role.into(),
                target_name_pattern: name.map(String::from),
                target_text_content: None,
                structural_anchor_roles: vec![],
                surrounding_context: None,
            },
            action,
            before_snapshot_ref: "snapshots/initial.json".into(),
            after_snapshot_ref: "snapshots/step-0001-after.json".into(),
        }
    }

    #[test]
    fn slugify_converts_typical_titles() {
        assert_eq!(slugify("Download Invoice"), "download-invoice");
        assert_eq!(slugify("  spaces   collapse  "), "spaces-collapse");
        assert_eq!(slugify("punct!@#here"), "punct-here");
        assert_eq!(slugify("ALL CAPS 1"), "all-caps-1");
    }

    #[test]
    fn slugify_empty_when_no_alphanumeric() {
        assert_eq!(slugify("!!!"), "");
        assert_eq!(slugify(""), "");
    }

    #[test]
    fn build_step_list_uses_intent_name_when_present() {
        let m = manifest_with_steps(vec![
            step("step-0001", ActionKind::Click { target_handle_id: 0 }, "button", Some("Sign in")),
            step("step-0002", ActionKind::Input { target_handle_id: 0, value: "x".into() }, "textbox", Some("Email")),
        ]);
        let list = build_step_list(&m, None);
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].action, "click");
        assert_eq!(list[0].intent, "Sign in");
        assert_eq!(list[0].repaired, false);
        assert_eq!(list[0].failed, false);
        assert_eq!(list[1].action, "input");
        assert_eq!(list[1].intent, "Email");
    }

    #[test]
    fn build_step_list_falls_back_to_url_for_navigate_without_name() {
        let m = manifest_with_steps(vec![step(
            "step-0001",
            ActionKind::Navigate { url: "https://x/".into() },
            "page",
            None,
        )]);
        let list = build_step_list(&m, None);
        assert_eq!(list[0].intent, "https://x/");
    }

    #[test]
    fn build_step_list_merges_last_run_per_step_results() {
        let m = manifest_with_steps(vec![
            step("step-0001", ActionKind::Click { target_handle_id: 0 }, "button", Some("A")),
            step("step-0002", ActionKind::Click { target_handle_id: 0 }, "button", Some("B")),
        ]);
        let lr = LastRun {
            at: "epoch:0".into(),
            status: "repaired".into(),
            duration_ms: 1234,
            reason: None,
            step_results: vec![
                LastRunStep { step_id: "step-0001".into(), repaired: true, executed: true, duration_ms: 600 },
                LastRunStep { step_id: "step-0002".into(), repaired: false, executed: false, duration_ms: 0 },
            ],
        };
        let list = build_step_list(&m, Some(&lr));
        assert!(list[0].repaired);
        assert_eq!(list[0].duration_ms, 600);
        assert!(!list[0].failed);
        assert!(list[1].failed); // executed=false -> failed=true
    }

    #[test]
    fn summarize_run_record_success_no_repairs() {
        let rec = RunRecord {
            run_id: "run-1".into(),
            recording_id: "rec-1".into(),
            started_at_ms: 1000,
            ended_at_ms: 5000,
            outcome: RunOutcome::Success,
            steps: vec![StepOutcome {
                step_id: "step-0001".into(),
                preflight: ExportOutcome::Ok,
                postflight: ExportOutcome::Ok,
                repaired: false,
                action_executed: true,
                duration_ms: 800,
            }],
            final_output: None,
            fuel_consumed: 0,
        };
        let s = summarize_run_record(&rec);
        assert_eq!(s.status, "success");
        assert_eq!(s.duration_ms, 4000);
        assert!(s.reason.is_none());
        assert_eq!(s.step_results.len(), 1);
        assert_eq!(s.step_results[0].duration_ms, 800);
    }

    #[test]
    fn summarize_run_record_repaired_when_any_step_repaired() {
        let rec = RunRecord {
            run_id: "run-1".into(),
            recording_id: "rec-1".into(),
            started_at_ms: 0,
            ended_at_ms: 1000,
            outcome: RunOutcome::Success,
            steps: vec![StepOutcome {
                step_id: "step-0001".into(),
                preflight: ExportOutcome::Ok,
                postflight: ExportOutcome::Ok,
                repaired: true,
                action_executed: true,
                duration_ms: 100,
            }],
            final_output: None,
            fuel_consumed: 0,
        };
        let s = summarize_run_record(&rec);
        assert_eq!(s.status, "repaired");
    }

    #[test]
    fn summarize_run_record_needs_review_becomes_failed_with_reason() {
        let rec = RunRecord {
            run_id: "run-1".into(),
            recording_id: "rec-1".into(),
            started_at_ms: 0,
            ended_at_ms: 0,
            outcome: RunOutcome::NeedsReview {
                reason: "preflight failed".into(),
                step_id: "step-0001".into(),
            },
            steps: vec![],
            final_output: None,
            fuel_consumed: 0,
        };
        let s = summarize_run_record(&rec);
        assert_eq!(s.status, "failed");
        assert_eq!(s.reason.as_deref(), Some("preflight failed"));
    }
}
