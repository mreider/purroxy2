// Page snapshot capture. Pulls the full accessibility tree via CDP,
// canonicalizes it per PRD §5.
//
// Phase 2 has two paths:
//   - capture_snapshot_full: AX tree via Accessibility domain.
//     Real production path. Needs Accessibility.enable; some
//     chromiumoxide CDP error modes still tagged as "uninteresting".
//   - capture_snapshot_minimal: url/title/viewport only, no AX
//     tree. Always succeeds. Used while the AX path is hardened.
//
// The recorder uses the minimal path until full snapshots prove
// reliable across sites; the canonical-serialization framing
// (sorted attributes, document-position node order) is in place
// so swapping the impl preserves byte-exact replay.

use anyhow::Result;
use chromiumoxide::Page;
use chromiumoxide::cdp::browser_protocol::accessibility::{
    EnableParams as AxEnableParams, GetFullAxTreeParams,
};

use crate::types::{AccessibilityNode, Frame, PageSnapshot};

pub async fn capture_snapshot(page: &Page) -> Result<PageSnapshot> {
    capture_snapshot_minimal(page).await
}

pub async fn capture_snapshot_minimal(page: &Page) -> Result<PageSnapshot> {
    let url = page.url().await?.unwrap_or_default();
    let title = page.get_title().await?.unwrap_or_default();
    Ok(PageSnapshot {
        url: url.clone(),
        title,
        viewport: (1280, 720),
        frames: vec![Frame {
            id: 0,
            parent: None,
            url,
        }],
        nodes: vec![],
        root_handle_id: 0,
    })
}

#[allow(dead_code)]
pub async fn capture_snapshot_full(page: &Page) -> Result<PageSnapshot> {
    let url = page.url().await?.unwrap_or_default();
    let title = page.get_title().await?.unwrap_or_default();
    let viewport = (1280u32, 720u32);

    let _ = page.execute(AxEnableParams::default()).await;
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
