use anyhow::{Context, Result};
use std::path::PathBuf;

#[tokio::main]
async fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        eprintln!(
            "usage: replay <recording-dir> --component <wasm-path> [--out <run-record.json>] [--headless]"
        );
        std::process::exit(2);
    }
    let recording_dir = PathBuf::from(&args[1]);
    let mut component_path: Option<PathBuf> = None;
    let mut out: Option<PathBuf> = None;
    let mut headless = false;
    let mut i = 2;
    while i < args.len() {
        match args[i].as_str() {
            "--component" => {
                component_path = Some(PathBuf::from(args.get(i + 1).context("--component path")?));
                i += 2;
            }
            "--out" => {
                out = Some(PathBuf::from(args.get(i + 1).context("--out path")?));
                i += 2;
            }
            "--headless" => {
                headless = true;
                i += 1;
            }
            other => {
                eprintln!("unexpected arg: {other}");
                std::process::exit(2);
            }
        }
    }

    let opts = replay::ReplayOptions {
        recording_dir,
        component_path: component_path.context("--component is required")?,
        headless,
        run_record_path: out,
        event_tx: None,
    };
    let record = replay::replay(opts).await?;
    println!(
        "[replay] outcome={:?} steps={}",
        record.outcome,
        record.steps.len()
    );
    Ok(())
}
