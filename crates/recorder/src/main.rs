use anyhow::{Context, Result};
use std::path::PathBuf;

#[tokio::main]
async fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        eprintln!("usage: recorder record <url> [--out <dir>] [--name <capability-name>]");
        std::process::exit(2);
    }
    if args[1] != "record" {
        eprintln!("unknown subcommand: {}", args[1]);
        std::process::exit(2);
    }
    let url = args.get(2).context("missing <url>")?.clone();
    let mut out = PathBuf::from("recording");
    let mut name = "untitled".to_string();
    let mut auto_stop_ms: Option<u64> = None;
    let mut headless = false;
    let mut emit_events = false;
    let mut i = 3;
    while i < args.len() {
        match args[i].as_str() {
            "--out" => {
                out = PathBuf::from(args.get(i + 1).context("--out needs a value")?);
                i += 2;
            }
            "--name" => {
                name = args.get(i + 1).context("--name needs a value")?.clone();
                i += 2;
            }
            "--auto-stop-ms" => {
                auto_stop_ms = Some(args.get(i + 1).context("--auto-stop-ms needs a value")?.parse()?);
                i += 2;
            }
            "--headless" => {
                headless = true;
                i += 1;
            }
            "--events" => {
                let val = args.get(i + 1).context("--events needs a value")?;
                match val.as_str() {
                    "ndjson" => emit_events = true,
                    "none" => emit_events = false,
                    other => {
                        eprintln!("unknown --events value: {other} (expected 'ndjson' or 'none')");
                        std::process::exit(2);
                    }
                }
                i += 2;
            }
            other => {
                eprintln!("unexpected arg: {other}");
                std::process::exit(2);
            }
        }
    }

    let opts = recorder::RecorderOptions {
        start_url: url,
        output_dir: out,
        capability_name: name,
        poll_interval_ms: 250,
        auto_stop_ms,
        headless,
        emit_events,
    };
    match recorder::record(opts).await {
        Ok(manifest) => {
            if emit_events {
                eprintln!(
                    "[recorder] done. recording_id={} steps={}",
                    manifest.recording_id,
                    manifest.steps.len()
                );
            } else {
                println!(
                    "[recorder] done. recording_id={} steps={}",
                    manifest.recording_id,
                    manifest.steps.len()
                );
            }
            Ok(())
        }
        Err(err) => {
            if emit_events {
                let payload = serde_json::json!({
                    "v": 1,
                    "event": "error",
                    "message": err.to_string(),
                });
                if let Ok(s) = serde_json::to_string(&payload) {
                    println!("{s}");
                }
            }
            Err(err)
        }
    }
}
