// Run record produced by a replay invocation. Captures inputs,
// per-step outcomes, observations, repairs, final output. Persisted
// as JSON next to the recording.

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct RunRecord {
    pub run_id: String,
    pub recording_id: String,
    pub started_at_ms: u64,
    pub ended_at_ms: u64,
    pub outcome: RunOutcome,
    pub steps: Vec<StepOutcome>,
    /// Final extracted+redacted output as a JSON-stringified Output.
    pub final_output: Option<String>,
    /// Component fuel consumed in total. Future work; placeholder 0
    /// for now.
    pub fuel_consumed: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
pub enum RunOutcome {
    Success,
    NeedsReview { reason: String, step_id: String },
    Aborted { reason: String },
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StepOutcome {
    pub step_id: String,
    pub preflight: ExportOutcome,
    pub postflight: ExportOutcome,
    pub repaired: bool,
    pub action_executed: bool,
    #[serde(default)]
    pub duration_ms: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum ExportOutcome {
    Ok,
    Err { code: String, message: String },
    Skipped,
}
