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
    };
    let manifest = recorder::record(opts).await?;
    println!(
        "[recorder] done. recording_id={} steps={}",
        manifest.recording_id,
        manifest.steps.len()
    );
    Ok(())
}
