// Recording loop. Launches a controlled Chromium instance via
// chromiumoxide, injects shim.js into every page, and drains the
// shim's event queue on a poll interval. Captured events become
// recorded steps with before/after page snapshots.
//
// Phase 2 scope: clicks, inputs, popstate-style navigation. Iframes,
// shadow DOM, file uploads, dropdown composition, and infinite-scroll
// recognition land in Phase 2 followups.

use anyhow::{Context, Result};
use chromiumoxide::{Browser, BrowserConfig, Page};
use futures::StreamExt;
use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::signal;
use tokio::time::sleep;

use crate::snapshot::capture_snapshot;
use crate::types::{ActionKind, PageSnapshot, RecordedStep, RecordingManifest, StepIntent};

const SHIM_JS: &str = include_str!("shim.js");

#[derive(Debug, Deserialize)]
struct ShimEvent {
    kind: String,
    #[serde(default)]
    target: Option<ShimTarget>,
    #[serde(default)]
    value: Option<String>,
    #[serde(default)]
    sensitive: Option<bool>,
    #[serde(default)]
    url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ShimTarget {
    role: Option<String>,
    name: Option<String>,
}

pub struct RecorderOptions {
    pub start_url: String,
    pub output_dir: PathBuf,
    pub capability_name: String,
    pub poll_interval_ms: u64,
    /// If set, the recording loop terminates after this many
    /// milliseconds of wall-clock even without an interactive
    /// stop signal. Used for non-interactive smoke tests.
    pub auto_stop_ms: Option<u64>,
    /// Run the controlled browser headless. Default for the user
    /// flow is `false` (visible window so the user can interact);
    /// smoke tests pass `true`.
    pub headless: bool,
    /// When true, emit machine-readable NDJSON events on stdout
    /// (one JSON object per line). Used by the desktop app to
    /// drive live progress UI. Human-readable status messages go
    /// to stderr in this mode.
    pub emit_events: bool,
}

fn iso_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let d = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    format!(
        "{}.{:03}Z-epoch",
        d.as_secs(),
        d.subsec_millis()
    )
}

fn emit(enabled: bool, ev: serde_json::Value) {
    if !enabled {
        return;
    }
    if let Ok(s) = serde_json::to_string(&ev) {
        println!("{s}");
    }
}

fn say(events: bool, msg: impl AsRef<str>) {
    if events {
        eprintln!("{}", msg.as_ref());
    } else {
        println!("{}", msg.as_ref());
    }
}

#[cfg(unix)]
async fn wait_for_sigterm() {
    use tokio::signal::unix::{signal, SignalKind};
    match signal(SignalKind::terminate()) {
        Ok(mut s) => {
            s.recv().await;
        }
        Err(_) => std::future::pending::<()>().await,
    }
}

#[cfg(not(unix))]
async fn wait_for_sigterm() {
    std::future::pending::<()>().await;
}

pub async fn record(opts: RecorderOptions) -> Result<RecordingManifest> {
    let chrome_path = std::env::var("PURROXY_CHROME").unwrap_or_else(|_| {
        if cfg!(target_os = "macos") {
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome".into()
        } else if cfg!(target_os = "windows") {
            "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe".into()
        } else {
            "google-chrome".into()
        }
    });
    let mut cfg = BrowserConfig::builder().chrome_executable(&chrome_path);
    if !opts.headless {
        cfg = cfg.with_head();
    }
    let (mut browser, mut handler) = Browser::launch(
        cfg.build()
            .map_err(|e| anyhow::anyhow!("browser config: {e}"))?,
    )
    .await?;

    let handler_task = tokio::task::spawn(async move {
        // Drain forever; the handler is what drives CDP responses
        // back to the Browser/Page handles. Stopping it on a single
        // event error closes the channel and breaks every CDP call
        // that comes after.
        while handler.next().await.is_some() {}
    });

    let page = browser.new_page(&opts.start_url).await?;
    page.evaluate_on_new_document(SHIM_JS).await?;
    page.evaluate(SHIM_JS).await.ok(); // also install on already-loaded page

    say(opts.emit_events, format!("[recorder] recording {} -> {}", opts.start_url, opts.output_dir.display()));
    say(opts.emit_events, "[recorder] interact with the page; press Ctrl+C to finish.");

    std::fs::create_dir_all(&opts.output_dir)?;

    let recording_id = format!("rec-{}", random_suffix());
    let mut steps: Vec<RecordedStep> = Vec::new();
    let mut last_step_id: u64 = 0;
    let mut last_snapshot_ref = "snapshots/initial.json".to_string();
    let initial = capture_snapshot(&page).await?;
    write_snapshot(&opts.output_dir, "initial", &initial)?;

    let manifest_path = opts.output_dir.join("manifest.json");
    // Write empty manifest immediately so a hard kill mid-recording
    // still leaves a parseable file in the library dir.
    persist_manifest(&manifest_path, &recording_id, &opts.start_url, &opts.capability_name, &steps)?;

    emit(opts.emit_events, serde_json::json!({
        "v": 1,
        "event": "started",
        "at": iso_now(),
        "recording_id": recording_id,
        "start_url": opts.start_url,
        "capability_name": opts.capability_name,
        "output_dir": opts.output_dir.to_string_lossy(),
    }));

    let stop_ctrl_c = tokio::spawn(async {
        let _ = signal::ctrl_c().await;
    });
    tokio::pin!(stop_ctrl_c);

    let stop_term = tokio::spawn(async { wait_for_sigterm().await; });
    tokio::pin!(stop_term);

    let auto_stop = match opts.auto_stop_ms {
        Some(ms) => Box::pin(sleep(Duration::from_millis(ms))) as std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>>,
        None => Box::pin(std::future::pending()) as std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>>,
    };
    tokio::pin!(auto_stop);

    let poll = sleep(Duration::from_millis(opts.poll_interval_ms));
    tokio::pin!(poll);

    let stop_reason: &'static str = loop {
        tokio::select! {
            _ = &mut stop_ctrl_c => {
                say(opts.emit_events, "\n[recorder] stop signal received.");
                break "ctrl_c";
            }
            _ = &mut stop_term => {
                say(opts.emit_events, "\n[recorder] SIGTERM received.");
                break "sigterm";
            }
            _ = &mut auto_stop => {
                say(opts.emit_events, "\n[recorder] auto-stop reached.");
                break "auto_stop";
            }
            _ = &mut poll => {
                let new_events = drain_events(&page).await?;
                for ev in new_events {
                    let step_id_s = format!("step-{:04}", last_step_id);
                    let after_ref = format!("snapshots/{step_id_s}-after.json");
                    let after = capture_snapshot(&page).await?;
                    let action = match ev.kind.as_str() {
                        "click" => ActionKind::Click { target_handle_id: 0 },
                        "input" => {
                            let was_sensitive = ev.sensitive.unwrap_or(false);
                            ActionKind::Input {
                                target_handle_id: 0,
                                value: if was_sensitive {
                                    String::new()
                                } else {
                                    ev.value.unwrap_or_default()
                                },
                            }
                        }
                        "navigate" => ActionKind::Navigate {
                            url: ev.url.clone().unwrap_or_default(),
                        },
                        _ => continue,
                    };
                    let intent = StepIntent {
                        target_role: ev.target.as_ref().and_then(|t| t.role.clone()).unwrap_or_else(|| "unknown".into()),
                        target_name_pattern: ev.target.as_ref().and_then(|t| t.name.clone()),
                        target_text_content: None,
                        structural_anchor_roles: vec![],
                        surrounding_context: ev.url.clone(),
                    };
                    write_snapshot(&opts.output_dir, &format!("{step_id_s}-after"), &after)?;
                    steps.push(RecordedStep {
                        id: step_id_s.clone(),
                        intent,
                        action,
                        before_snapshot_ref: last_snapshot_ref.clone(),
                        after_snapshot_ref: after_ref.clone(),
                    });
                    last_snapshot_ref = after_ref;
                    last_step_id += 1;
                    let pushed = steps.last().unwrap();
                    let intent_name = pushed.intent.target_name_pattern.clone();
                    if opts.emit_events {
                        emit(true, serde_json::json!({
                            "v": 1,
                            "event": "step",
                            "at": iso_now(),
                            "recording_id": recording_id,
                            "step_id": step_id_s,
                            "step_index": steps.len(),
                            "kind": ev.kind,
                            "intent": {
                                "role": pushed.intent.target_role,
                                "name": intent_name.clone(),
                            },
                        }));
                    } else if let Some(t) = &intent_name {
                        println!("[recorder] step {step_id_s} {kind} target=\"{t}\"", kind = ev.kind);
                    } else {
                        println!("[recorder] step {step_id_s} {kind}", kind = ev.kind);
                    }
                    // Persist after every step so a kill leaves a usable file.
                    persist_manifest(&manifest_path, &recording_id, &opts.start_url, &opts.capability_name, &steps)?;
                }
                poll.set(sleep(Duration::from_millis(opts.poll_interval_ms)));
            }
        }
    };

    let manifest = RecordingManifest {
        recording_id: recording_id.clone(),
        target_site: opts.start_url.clone(),
        capability_name: opts.capability_name.clone(),
        bundle_version: 1,
        wit_version: "purroxy:capability@1.0.0".into(),
        steps,
    };

    let json = serde_json::to_string_pretty(&manifest)?;
    std::fs::write(&manifest_path, json)?;
    say(
        opts.emit_events,
        format!(
            "[recorder] wrote {} steps -> {}",
            manifest.steps.len(),
            manifest_path.display()
        ),
    );
    emit(opts.emit_events, serde_json::json!({
        "v": 1,
        "event": "finished",
        "at": iso_now(),
        "recording_id": recording_id,
        "stop_reason": stop_reason,
        "steps": manifest.steps.len(),
        "manifest_path": manifest_path.to_string_lossy(),
    }));

    let _ = browser.close().await;
    let _ = browser.wait().await;
    handler_task.abort();
    Ok(manifest)
}

fn persist_manifest(
    path: &Path,
    recording_id: &str,
    start_url: &str,
    capability_name: &str,
    steps: &[RecordedStep],
) -> Result<()> {
    let manifest = RecordingManifest {
        recording_id: recording_id.to_string(),
        target_site: start_url.to_string(),
        capability_name: capability_name.to_string(),
        bundle_version: 1,
        wit_version: "purroxy:capability@1.0.0".into(),
        steps: steps.to_vec(),
    };
    let json = serde_json::to_string_pretty(&manifest)?;
    std::fs::write(path, json)?;
    Ok(())
}

async fn drain_events(page: &Page) -> Result<Vec<ShimEvent>> {
    let raw = page
        .evaluate(
            r#"(() => {
                const out = window.__purroxy_events || [];
                window.__purroxy_events = [];
                return JSON.stringify(out);
            })()"#,
        )
        .await
        .context("draining shim events")?;
    let s: String = raw.into_value().unwrap_or_default();
    if s.is_empty() || s == "[]" {
        return Ok(vec![]);
    }
    Ok(serde_json::from_str(&s).context("parsing shim events")?)
}

fn write_snapshot(dir: &Path, name: &str, snap: &PageSnapshot) -> Result<()> {
    let snap_dir = dir.join("snapshots");
    std::fs::create_dir_all(&snap_dir)?;
    let json = serde_json::to_string_pretty(snap)?;
    std::fs::write(snap_dir.join(format!("{name}.json")), json)?;
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
