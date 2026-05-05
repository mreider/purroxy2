// Recorder subprocess management. The desktop never imports the
// recorder library — it spawns the recorder binary, streams its
// NDJSON event output back to the frontend via Tauri events, and
// shuts it down with SIGTERM on Stop.
//
// Loose-coupling rationale: the recorder is a separate process so
// (a) crashes can't take the UI with them, (b) the binary path is
// configurable via PURROXY_RECORDER_BIN for swapping impls, and
// (c) the contract between desktop and recorder is the NDJSON line
// stream, not Rust types.
//
// One active recording at a time. start_recording while busy returns
// an error. stop_recording finalizes; discard_recording stops + rm.
//
// Architecture: when start_recording succeeds we hand the child to a
// watcher task and keep only the PID + watcher JoinHandle in state.
// The watcher waits for child exit, emits `recorder:closed`, and
// returns. Stop sends SIGTERM to the PID; the watcher completes.
// Unexpected crash = `recorder:closed` arrives without a preceding
// `recorder:finished`, which the frontend interprets.

use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

#[derive(Debug, Clone, Serialize)]
pub struct StartedRecording {
    pub recording_id: String,
    pub output_dir: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct StopResult {
    pub saved: bool,
    pub recording_id: String,
    pub output_dir: String,
    pub steps: usize,
}

struct ActiveRecording {
    recording_id: String,
    pid: u32,
    output_dir: PathBuf,
    watcher: JoinHandle<i32>, // resolves to exit code (or -1 on unknown)
}

#[derive(Default)]
pub struct RecorderProcState {
    inner: Mutex<Option<ActiveRecording>>,
}

impl RecorderProcState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }
}

fn recorder_binary() -> PathBuf {
    if let Ok(p) = std::env::var("PURROXY_RECORDER_BIN") {
        return PathBuf::from(p);
    }
    let exe = std::env::current_exe().unwrap_or_else(|_| PathBuf::from("desktop"));
    if let Some(dir) = exe.parent() {
        let cand = dir.join(if cfg!(windows) { "recorder.exe" } else { "recorder" });
        if cand.exists() {
            return cand;
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join(if cfg!(windows) { "target/release/recorder.exe" } else { "target/release/recorder" })
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
    let trimmed = out.trim_matches('-').to_string();
    if trimmed.is_empty() { "untitled".into() } else { trimmed }
}

pub async fn start(
    state: Arc<RecorderProcState>,
    app: AppHandle,
    library_root: PathBuf,
    name: String,
    url: String,
) -> Result<StartedRecording, String> {
    {
        let guard = state.inner.lock().await;
        if guard.is_some() {
            return Err("a recording is already in progress; stop it first".into());
        }
    }

    let slug = slugify(&name);
    let output_dir = library_root.join(&slug);
    if output_dir.exists() {
        return Err(format!(
            "recording already exists at {}; choose a different name",
            output_dir.display()
        ));
    }
    std::fs::create_dir_all(&output_dir).map_err(|e| format!("mkdir: {e}"))?;

    let bin = recorder_binary();
    if !bin.exists() {
        return Err(format!(
            "recorder binary not found at {}; set PURROXY_RECORDER_BIN to override",
            bin.display()
        ));
    }

    let mut cmd = Command::new(&bin);
    cmd.arg("record")
        .arg(&url)
        .arg("--out")
        .arg(&output_dir)
        .arg("--name")
        .arg(&slug)
        .arg("--events")
        .arg("ndjson")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let mut child = cmd.spawn().map_err(|e| format!("spawn recorder: {e}"))?;
    let stdout = child.stdout.take().ok_or_else(|| "no stdout".to_string())?;
    let stderr = child.stderr.take().ok_or_else(|| "no stderr".to_string())?;
    let pid = child.id().ok_or_else(|| "child has no PID".to_string())?;

    let recording_id = format!("rec-{}", random_suffix());

    // stdout NDJSON pump.
    {
        let app = app.clone();
        let id = recording_id.clone();
        tokio::spawn(async move {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let line = line.trim();
                if line.is_empty() {
                    continue;
                }
                match serde_json::from_str::<serde_json::Value>(line) {
                    Ok(mut v) => {
                        if let Some(obj) = v.as_object_mut() {
                            obj.entry("frontend_recording_id".to_string())
                                .or_insert_with(|| serde_json::Value::String(id.clone()));
                        }
                        let event_name = v
                            .get("event")
                            .and_then(|e| e.as_str())
                            .unwrap_or("unknown")
                            .to_string();
                        let _ = app.emit(&format!("recorder:{event_name}"), v);
                    }
                    Err(_) => {
                        let _ = app.emit(
                            "recorder:log",
                            serde_json::json!({
                                "frontend_recording_id": id,
                                "line": line,
                            }),
                        );
                    }
                }
            }
        });
    }

    // stderr -> log events.
    {
        let app = app.clone();
        let id = recording_id.clone();
        tokio::spawn(async move {
            let reader = BufReader::new(stderr);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = app.emit(
                    "recorder:log",
                    serde_json::json!({
                        "frontend_recording_id": id,
                        "stream": "stderr",
                        "line": line,
                    }),
                );
            }
        });
    }

    // Watcher: owns the Child, awaits exit, emits recorder:closed.
    let watcher = {
        let app = app.clone();
        let state = state.clone();
        let id = recording_id.clone();
        let output_dir_clone = output_dir.clone();
        tokio::spawn(async move {
            let exit_code = match child.wait().await {
                Ok(status) => status.code().unwrap_or(-1),
                Err(_) => -1,
            };
            // If the active state still references this recording,
            // the exit was unsolicited (the user didn't call stop).
            let was_unexpected = {
                let guard = state.inner.lock().await;
                matches!(&*guard, Some(a) if a.recording_id == id)
            };
            let _ = app.emit(
                "recorder:closed",
                serde_json::json!({
                    "v": 1,
                    "event": "closed",
                    "frontend_recording_id": id,
                    "exit_code": exit_code,
                    "unexpected": was_unexpected,
                    "output_dir": output_dir_clone.to_string_lossy(),
                }),
            );
            if was_unexpected {
                // Clear active state so a subsequent start can succeed.
                let mut guard = state.inner.lock().await;
                if matches!(&*guard, Some(a) if a.recording_id == id) {
                    *guard = None;
                }
            }
            exit_code
        })
    };

    {
        let mut guard = state.inner.lock().await;
        *guard = Some(ActiveRecording {
            recording_id: recording_id.clone(),
            pid,
            output_dir: output_dir.clone(),
            watcher,
        });
    }

    Ok(StartedRecording {
        recording_id,
        output_dir: output_dir.to_string_lossy().to_string(),
    })
}

pub async fn stop(state: Arc<RecorderProcState>) -> Result<StopResult, String> {
    let active = {
        let mut guard = state.inner.lock().await;
        guard.take().ok_or_else(|| "no active recording".to_string())?
    };

    #[cfg(unix)]
    unsafe {
        libc::kill(active.pid as i32, libc::SIGTERM);
    }
    #[cfg(not(unix))]
    {
        // Windows: best-effort terminate. Future: ConsoleCtrlEvent.
        let _ = std::process::Command::new("taskkill")
            .arg("/PID")
            .arg(active.pid.to_string())
            .arg("/T")
            .status();
    }

    let exit = tokio::time::timeout(Duration::from_secs(5), active.watcher).await;
    let _ = match exit {
        Ok(Ok(code)) => code,
        Ok(Err(_)) | Err(_) => {
            // Watcher hung or timed out. SIGKILL fallback (Unix).
            #[cfg(unix)]
            unsafe {
                libc::kill(active.pid as i32, libc::SIGKILL);
            }
            -1
        }
    };

    let manifest_path = active.output_dir.join("manifest.json");
    let steps = match std::fs::read_to_string(&manifest_path) {
        Ok(raw) => match serde_json::from_str::<recorder::types::RecordingManifest>(&raw) {
            Ok(m) => m.steps.len(),
            Err(_) => 0,
        },
        Err(_) => 0,
    };

    Ok(StopResult {
        saved: steps > 0,
        recording_id: active.recording_id,
        output_dir: active.output_dir.to_string_lossy().to_string(),
        steps,
    })
}

pub async fn discard(state: Arc<RecorderProcState>) -> Result<(), String> {
    let res = stop(state).await;
    let dir = match res {
        Ok(r) => r.output_dir,
        Err(_) => return Ok(()),
    };
    let dir_path = PathBuf::from(&dir);
    if dir_path.join("manifest.json").exists() || dir_path.join("snapshots").exists() {
        let _ = std::fs::remove_dir_all(&dir_path);
    }
    Ok(())
}

fn random_suffix() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    format!("{:x}", nanos & 0xffff_ffff)
}
