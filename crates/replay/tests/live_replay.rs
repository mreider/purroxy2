// Live replay smoke. Launches headless Chromium against
// https://example.com/, replays a one-step (Navigate) recording
// using the reference capability component, and asserts the run
// record shape.
//
// #[ignore] by default because it requires Chrome installed and
// network access. Run with:
//   cargo test -p replay --release -- --ignored

use replay::{ReplayOptions, RunOutcome};
use std::path::PathBuf;

fn fixture_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/one-step")
}

fn component_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../target/wasm32-wasip2/release/reference_capability.wasm")
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn one_step_navigate_round_trips() {
    let out_dir = std::env::temp_dir().join("purroxy-replay-test");
    let _ = std::fs::create_dir_all(&out_dir);
    let run_record_path = out_dir.join("run.json");

    let opts = ReplayOptions {
        recording_dir: fixture_dir(),
        component_path: component_path(),
        headless: true,
        run_record_path: Some(run_record_path.clone()),
    };

    let record = replay::replay(opts).await.expect("replay should succeed");
    assert!(matches!(record.outcome, RunOutcome::Success), "outcome should be Success, got {:?}", record.outcome);
    assert_eq!(record.steps.len(), 1, "exactly one step");
    let step = &record.steps[0];
    assert_eq!(step.step_id, "step-0001");
    assert!(step.action_executed, "Navigate action must execute");
    assert!(record.final_output.is_some(), "extract must produce output");
}
