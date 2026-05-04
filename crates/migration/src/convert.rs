// v1 -> v2 conversion. Pure data-shape mapping. The output is a
// RecordingManifest ready to be packaged by the registry crate;
// any host-resident logic from v1 is surfaced in MigrationReport
// rather than silently lost (PRD §0: "Conversion never silently
// drops behavior; if it can't preserve something, it says so").

use serde::Serialize;

use recorder::types::{
    ActionKind, RecordedStep, RecordingManifest, StepIntent,
};

use crate::v1::V1Capability;

#[derive(Debug, Serialize)]
pub struct MigrationReport {
    /// Capability name (v2 manifest's capability_name field).
    pub name: String,
    /// Status emitted on the v2 side. healthy | needs_review.
    pub status: MigrationStatus,
    /// Reasons attached when status is `needs_review`. Each entry
    /// is shown to the user in the first-launch wizard so they
    /// know what to verify or re-record.
    pub review_reasons: Vec<String>,
    /// Steps the converter dropped or could not classify.
    pub dropped_steps: Vec<DroppedStep>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MigrationStatus {
    Healthy,
    NeedsReview,
}

#[derive(Debug, Serialize)]
pub struct DroppedStep {
    pub original_type: String,
    pub reason: String,
}

pub struct ConvertOutcome {
    pub manifest: RecordingManifest,
    pub report: MigrationReport,
}

pub fn convert(v1: &V1Capability) -> ConvertOutcome {
    let mut steps: Vec<RecordedStep> = Vec::new();
    let mut dropped: Vec<DroppedStep> = Vec::new();
    let mut review_reasons: Vec<String> = Vec::new();

    for (i, s) in v1.steps.iter().enumerate() {
        let id = format!("step-{:04}", i);
        let intent = StepIntent {
            target_role: s
                .role
                .clone()
                .unwrap_or_else(|| infer_role_from_type(&s.r#type)),
            target_name_pattern: s.aria_label.clone().or_else(|| s.label.clone()),
            target_text_content: s.label.clone(),
            structural_anchor_roles: vec![],
            surrounding_context: s.selector.clone(),
        };
        let action = match s.r#type.as_str() {
            "click" => ActionKind::Click {
                target_handle_id: 0,
            },
            "input" => ActionKind::Input {
                target_handle_id: 0,
                value: s.value.clone().unwrap_or_default(),
            },
            "navigate" => ActionKind::Navigate {
                url: s.url.clone().unwrap_or_else(|| v1.url.clone()),
            },
            other => {
                dropped.push(DroppedStep {
                    original_type: other.into(),
                    reason: format!("v2 has no handler for action type {other:?}"),
                });
                continue;
            }
        };
        // v1 had no per-step snapshots persisted, so the manifest
        // references placeholder paths. Replay against converted
        // capabilities re-captures live snapshots; the host's
        // structural preflight gate from PRD §9.4 is what protects
        // semantic correctness.
        steps.push(RecordedStep {
            id,
            intent,
            action,
            before_snapshot_ref: "snapshots/converted-from-v1.json".into(),
            after_snapshot_ref: "snapshots/converted-from-v1.json".into(),
        });
    }

    if !v1.host_logic.is_empty() {
        review_reasons.push(format!(
            "v1 capability used host-resident logic ({}); v2 default behaviors may not reproduce it",
            v1.host_logic.join(", ")
        ));
    }
    if !dropped.is_empty() {
        review_reasons.push(format!(
            "{} step(s) dropped during conversion (unknown action type)",
            dropped.len()
        ));
    }
    if steps.is_empty() && !v1.steps.is_empty() {
        review_reasons.push(
            "all v1 steps were dropped during conversion; capability requires manual re-record"
                .into(),
        );
    }

    let status = if review_reasons.is_empty() {
        MigrationStatus::Healthy
    } else {
        MigrationStatus::NeedsReview
    };

    let manifest = RecordingManifest {
        recording_id: format!("rec-from-v1-{}", v1.id),
        target_site: v1.url.clone(),
        capability_name: v1.name.clone(),
        bundle_version: 1,
        wit_version: "purroxy:capability@1.0.0".into(),
        steps,
    };
    let report = MigrationReport {
        name: v1.name.clone(),
        status,
        review_reasons,
        dropped_steps: dropped,
    };
    ConvertOutcome { manifest, report }
}

fn infer_role_from_type(t: &str) -> String {
    match t {
        "click" => "button".into(),
        "input" => "textbox".into(),
        "navigate" => "page".into(),
        _ => "unknown".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cap(json: &str) -> V1Capability {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn pure_recording_converts_to_healthy() {
        let v1 = cap(r#"{
            "id": "abc",
            "name": "yahoo-recent",
            "url": "https://mail.yahoo.com/",
            "steps": [
                { "type": "click", "label": "Inbox" },
                { "type": "click", "label": "First message" }
            ]
        }"#);
        let out = convert(&v1);
        assert!(matches!(out.report.status, MigrationStatus::Healthy));
        assert_eq!(out.manifest.steps.len(), 2);
        assert_eq!(out.manifest.target_site, "https://mail.yahoo.com/");
    }

    #[test]
    fn host_logic_marks_needs_review() {
        let v1 = cap(r#"{
            "id": "abc",
            "name": "chase-balance",
            "url": "https://chase.com/",
            "steps": [{ "type": "click", "label": "Account summary" }],
            "host_logic": ["currency_normalization", "decimal_repair"]
        }"#);
        let out = convert(&v1);
        assert!(matches!(out.report.status, MigrationStatus::NeedsReview));
        let combined = out.report.review_reasons.join(" ");
        assert!(combined.contains("currency_normalization"));
        assert!(combined.contains("decimal_repair"));
    }

    #[test]
    fn unknown_step_type_is_dropped_with_reason() {
        let v1 = cap(r#"{
            "id": "x",
            "name": "x",
            "url": "https://example.com/",
            "steps": [
                { "type": "click", "label": "ok" },
                { "type": "scroll-magic", "label": "wat" }
            ]
        }"#);
        let out = convert(&v1);
        assert_eq!(out.manifest.steps.len(), 1);
        assert_eq!(out.report.dropped_steps.len(), 1);
        assert_eq!(out.report.dropped_steps[0].original_type, "scroll-magic");
        assert!(matches!(out.report.status, MigrationStatus::NeedsReview));
    }

    #[test]
    fn navigate_uses_step_url_else_capability_url() {
        let v1 = cap(r#"{
            "id": "x",
            "name": "x",
            "url": "https://example.com/",
            "steps": [
                { "type": "navigate" },
                { "type": "navigate", "url": "https://example.com/inbox" }
            ]
        }"#);
        let out = convert(&v1);
        assert_eq!(out.manifest.steps.len(), 2);
        match &out.manifest.steps[0].action {
            ActionKind::Navigate { url } => assert_eq!(url, "https://example.com/"),
            _ => panic!(),
        }
        match &out.manifest.steps[1].action {
            ActionKind::Navigate { url } => assert_eq!(url, "https://example.com/inbox"),
            _ => panic!(),
        }
    }

    #[test]
    fn input_value_carried_through() {
        let v1 = cap(r#"{
            "id": "x",
            "name": "x",
            "url": "https://example.com/",
            "steps": [{ "type": "input", "label": "Email", "value": "me@example.com" }]
        }"#);
        let out = convert(&v1);
        match &out.manifest.steps[0].action {
            ActionKind::Input { value, .. } => assert_eq!(value, "me@example.com"),
            _ => panic!(),
        }
    }

    #[test]
    fn intent_role_falls_back_to_inferred_when_v1_omits() {
        let v1 = cap(r#"{
            "id": "x",
            "name": "x",
            "url": "https://example.com/",
            "steps": [
                { "type": "click", "label": "x" },
                { "type": "input", "label": "y", "value": "z" }
            ]
        }"#);
        let out = convert(&v1);
        assert_eq!(out.manifest.steps[0].intent.target_role, "button");
        assert_eq!(out.manifest.steps[1].intent.target_role, "textbox");
    }

    #[test]
    fn explicit_role_is_preserved() {
        let v1 = cap(r#"{
            "id": "x",
            "name": "x",
            "url": "https://example.com/",
            "steps": [{ "type": "click", "label": "x", "role": "link" }]
        }"#);
        let out = convert(&v1);
        assert_eq!(out.manifest.steps[0].intent.target_role, "link");
    }

    #[test]
    fn empty_v1_steps_produces_empty_v2_manifest() {
        let v1 = cap(r#"{
            "id": "x",
            "name": "x",
            "url": "https://example.com/",
            "steps": []
        }"#);
        let out = convert(&v1);
        assert!(out.manifest.steps.is_empty());
        assert!(matches!(out.report.status, MigrationStatus::Healthy));
    }
}
