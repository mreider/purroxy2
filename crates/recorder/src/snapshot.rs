// Page snapshot capture. Pulls the full accessibility tree via CDP,
// canonicalizes it per PRD §5: nodes ordered by document position,
// attribute keys sorted lexicographically, no host-time-of-capture,
// no PRNG-derived fields.
//
// Phase 2 scope: capture role, name, value per node from the AX tree
// in document order. Property/attribute extraction beyond that lands
// in followups; the canonical-serialization framing is in place so
// adding more fields keeps the same byte-exact replay guarantee.

use anyhow::Result;
use chromiumoxide::Page;
use chromiumoxide::cdp::browser_protocol::accessibility::GetFullAxTreeParams;

use crate::types::{AccessibilityNode, Frame, PageSnapshot};

pub async fn capture_snapshot(page: &Page) -> Result<PageSnapshot> {
    let url = page.url().await?.unwrap_or_default();
    let title = page.get_title().await?.unwrap_or_default();
    let viewport = (1280u32, 720u32);

    let ax = page.execute(GetFullAxTreeParams::default()).await?;
    let mut nodes = Vec::new();
    let mut root_id = 0u64;

    for (i, n) in ax.nodes.iter().enumerate() {
        let id = i as u64;
        if i == 0 {
            root_id = id;
        }

        let role = ax_value_string(&n.role).unwrap_or_else(|| "unknown".into());
        let name = ax_value_string(&n.name);
        let value = ax_value_string(&n.value);

        // Properties become attributes; sort lexicographically.
        let mut attributes: Vec<(String, String)> = Vec::new();
        if let Some(props) = &n.properties {
            for p in props {
                let key = format!("{:?}", p.name).to_lowercase();
                let v = &p.value.value;
                let val = if let Some(s) = v.as_ref().and_then(|x| x.as_str()) {
                    s.to_string()
                } else if let Some(b) = v.as_ref().and_then(|x| x.as_bool()) {
                    b.to_string()
                } else if let Some(n) = v.as_ref().and_then(|x| x.as_i64()) {
                    n.to_string()
                } else {
                    continue;
                };
                attributes.push((key, val));
            }
        }
        attributes.sort_by(|a, b| a.0.cmp(&b.0));

        nodes.push(AccessibilityNode {
            id,
            frame: 0,
            role,
            name,
            value,
            text: None,
            attributes,
            parent: None,
            children: vec![],
        });
    }

    Ok(PageSnapshot {
        url: url.clone(),
        title,
        viewport,
        frames: vec![Frame {
            id: 0,
            parent: None,
            url,
        }],
        nodes,
        root_handle_id: root_id,
    })
}

fn ax_value_string(
    v: &Option<chromiumoxide::cdp::browser_protocol::accessibility::AxValue>,
) -> Option<String> {
    let s = v.as_ref()?.value.as_ref()?;
    s.as_str().map(String::from)
}
