// Phase 2 contract: page snapshots are canonically serialized so
// replay is byte-exact. These tests exercise the JSON shape directly,
// without launching a browser, so CI can run them everywhere.

use recorder::types::{
    AccessibilityNode, ActionKind, Frame, PageSnapshot, RecordedStep, RecordingManifest, StepIntent,
};

fn sample_node(id: u64, role: &str, attrs: Vec<(&str, &str)>) -> AccessibilityNode {
    AccessibilityNode {
        id,
        frame: 0,
        role: role.into(),
        name: None,
        value: None,
        text: None,
        attributes: attrs
            .into_iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect(),
        parent: None,
        children: vec![],
    }
}

#[test]
fn manifest_round_trips_through_json() {
    let m = RecordingManifest {
        recording_id: "rec-aaaa".into(),
        target_site: "https://example.com/".into(),
        capability_name: "demo".into(),
        bundle_version: 1,
        wit_version: "purroxy:capability@1.0.0".into(),
        steps: vec![RecordedStep {
            id: "step-0001".into(),
            intent: StepIntent {
                target_role: "button".into(),
                target_name_pattern: Some("Submit".into()),
                target_text_content: None,
                structural_anchor_roles: vec!["form".into()],
                surrounding_context: Some("https://example.com/checkout".into()),
            },
            action: ActionKind::Click {
                target_handle_id: 7,
            },
            before_snapshot_ref: "snapshots/initial.json".into(),
            after_snapshot_ref: "snapshots/step-0001-after.json".into(),
        }],
    };

    let s = serde_json::to_string(&m).expect("serialize");
    let back: RecordingManifest = serde_json::from_str(&s).expect("deserialize");
    assert_eq!(back.steps.len(), 1);
    assert_eq!(back.steps[0].id, "step-0001");
}

#[test]
fn snapshot_attributes_sorted_lexicographically_persisted_in_order() {
    // Attributes inside a node are sorted before persistence; the
    // canonical-serialization rule from PRD §5. The recorder writes
    // them sorted; a test against pre-sorted input verifies that
    // the JSON shape exposes attributes as a Vec<(String, String)>
    // (NOT a HashMap with non-deterministic order).
    let snap = PageSnapshot {
        url: "https://example.com/".into(),
        title: "Example".into(),
        viewport: (1280, 720),
        frames: vec![Frame {
            id: 0,
            parent: None,
            url: "https://example.com/".into(),
        }],
        nodes: vec![
            sample_node(0, "main", vec![("aria-busy", "false"), ("aria-hidden", "false")]),
            sample_node(1, "button", vec![("aria-disabled", "false"), ("type", "submit")]),
        ],
        root_handle_id: 0,
    };

    let a = serde_json::to_string(&snap).unwrap();
    let b = serde_json::to_string(&snap).unwrap();
    assert_eq!(a, b, "byte-exact across two serializations of same value");

    // The Vec preserves attribute order, so the persisted JSON does
    // too. Verify the ordering observed.
    let v: serde_json::Value = serde_json::from_str(&a).unwrap();
    let attrs0 = v["nodes"][0]["attributes"].as_array().unwrap();
    assert_eq!(attrs0[0][0], "aria-busy");
    assert_eq!(attrs0[1][0], "aria-hidden");
}

#[test]
fn empty_recording_manifest_persists() {
    let m = RecordingManifest {
        recording_id: "rec-empty".into(),
        target_site: "https://example.com/".into(),
        capability_name: "demo".into(),
        bundle_version: 1,
        wit_version: "purroxy:capability@1.0.0".into(),
        steps: vec![],
    };
    let s = serde_json::to_string_pretty(&m).unwrap();
    assert!(s.contains("\"steps\": []"));
}
