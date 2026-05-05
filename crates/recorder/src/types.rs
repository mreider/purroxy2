// Manifest and step types persisted to disk by the recorder.
//
// Aligned with PRD v2.0 §3 (capability bundle) and §5 (page-snapshot
// canonicalization). The bundle's WASM component lives elsewhere; the
// recorder only owns the JSON manifest and per-step snapshots.
//
// Canonicalization rules (from PRD §5):
// - nodes ordered by document position
// - attribute keys sorted lexicographically
// - no host-time-of-capture, no PRNG-derived fields
// - frame structure flattened with stable IDs

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RecordingManifest {
    pub recording_id: String,
    pub target_site: String,
    pub capability_name: String,
    pub bundle_version: u32,
    pub wit_version: String,
    pub steps: Vec<RecordedStep>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RecordedStep {
    pub id: String,
    pub intent: StepIntent,
    pub action: ActionKind,
    pub before_snapshot_ref: String,
    pub after_snapshot_ref: String,
}

// Mirror of WIT step-intent (purroxy:capability/v1).
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StepIntent {
    pub target_role: String,
    pub target_name_pattern: Option<String>,
    pub target_text_content: Option<String>,
    pub structural_anchor_roles: Vec<String>,
    pub surrounding_context: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ActionKind {
    Click {
        target_handle_id: u64,
    },
    Input {
        target_handle_id: u64,
        value: String,
    },
    Navigate {
        url: String,
    },
}

// Canonical page-snapshot persisted alongside the manifest.
#[derive(Debug, Serialize, Deserialize)]
pub struct PageSnapshot {
    pub url: String,
    pub title: String,
    pub viewport: (u32, u32),
    pub frames: Vec<Frame>,
    pub nodes: Vec<AccessibilityNode>,
    pub root_handle_id: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Frame {
    pub id: u64,
    pub parent: Option<u64>,
    pub url: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AccessibilityNode {
    pub id: u64,
    pub frame: u64,
    pub role: String,
    pub name: Option<String>,
    pub value: Option<String>,
    pub text: Option<String>,
    // Sorted lexicographically by key (canonical form).
    pub attributes: Vec<(String, String)>,
    pub parent: Option<u64>,
    pub children: Vec<u64>,
}
