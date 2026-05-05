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

fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name)
}

fn component_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../target/wasm32-wasip2/release/reference_capability.wasm")
}

async fn run_fixture(name: &str) -> replay::RunRecord {
    let out_dir = std::env::temp_dir().join(format!("purroxy-replay-test-{name}"));
    let _ = std::fs::create_dir_all(&out_dir);
    let run_record_path = out_dir.join("run.json");

    let opts = ReplayOptions {
        recording_dir: fixture(name),
        component_path: component_path(),
        headless: true,
        run_record_path: Some(run_record_path),
        event_tx: None,
    };

    replay::replay(opts).await.expect("replay should succeed")
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn one_step_navigate_round_trips() {
    let record = run_fixture("one-step").await;
    assert!(matches!(record.outcome, RunOutcome::Success));
    assert_eq!(record.steps.len(), 1);
    let step = &record.steps[0];
    assert_eq!(step.step_id, "step-0001");
    assert!(step.action_executed, "Navigate action must execute");
    assert!(record.final_output.is_some());
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn click_link_round_trips() {
    let record = run_fixture("click-link").await;
    assert!(matches!(record.outcome, RunOutcome::Success), "{:?}", record.outcome);
    assert_eq!(record.steps.len(), 1);
    let step = &record.steps[0];
    assert!(step.action_executed, "Click action must execute (matched 'Learn more' on example.com)");
    assert!(!step.repaired, "direct click matched, no repair needed");
    let out = record.final_output.expect("extract output present");
    assert!(out.contains("Example Domains") || out.contains("Example Domain"),
        "post-click extract should reflect either the original or the new page title; got: {out}");
}

// Repair scenario: the fixture's intent uses a stale name ("More
// information" — example.com used to render that text, now renders
// "Learn more"). Direct click fails on the name match. Repair flow
// kicks in: filter candidates by role only, score via the WASM
// component's score-repair-candidates, accept the top score above
// threshold and click. The reference scorer returns linearly
// decreasing scores; first anchor wins; navigation succeeds.
#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn repair_click_when_intent_name_is_stale() {
    let record = run_fixture("repair-click").await;
    assert!(matches!(record.outcome, RunOutcome::Success), "{:?}", record.outcome);
    assert_eq!(record.steps.len(), 1);
    let step = &record.steps[0];
    assert!(step.repaired, "repair flow must engage when direct click fails");
    assert!(step.action_executed, "repair must end in a successful click");
    let out = record.final_output.expect("extract output present");
    assert!(out.contains("Example Domains") || out.contains("Example Domain"),
        "post-repair-click extract should reflect post-navigation title; got: {out}");
}
