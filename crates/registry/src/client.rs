// Registry client trait. Phase 7 ships an in-memory implementation
// for tests; the production client talks to the Cloudflare Workers
// backend (PRD §0: "Cloudflare Workers stays. License validation,
// the community library, signed-bundle distribution, attestation
// verification: all of that is independent of the host language").

use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListingEntry {
    pub name: String,
    pub target_site: String,
    pub bundle_size: usize,
    pub registry_signature_present: bool,
}

pub trait Registry: Send + Sync {
    /// List installable capabilities matching the optional substring.
    fn list(&self, query: Option<&str>) -> Result<Vec<ListingEntry>>;
    /// Fetch the bundle bytes for a capability by name. The bytes are
    /// expected to be a verifiable .purroxy archive (see bundle.rs).
    fn fetch(&self, name: &str) -> Result<Vec<u8>>;
    /// Submit a bundle for review. Returns a submission id.
    fn submit(&self, bundle: &[u8]) -> Result<String>;
}

/// In-memory registry. Tests and Phase 4 dogfood use this.
#[derive(Default)]
pub struct MemoryRegistry {
    inner: std::sync::Arc<std::sync::Mutex<BTreeMap<String, Vec<u8>>>>,
}

impl MemoryRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Pre-populate with a (name, bundle bytes) pair. Used by tests.
    pub fn with(name: impl Into<String>, bundle: Vec<u8>) -> Self {
        let m = MemoryRegistry::default();
        m.inner.lock().unwrap().insert(name.into(), bundle);
        m
    }

    pub fn install(&self, name: impl Into<String>, bundle: Vec<u8>) {
        self.inner.lock().unwrap().insert(name.into(), bundle);
    }
}

impl Registry for MemoryRegistry {
    fn list(&self, query: Option<&str>) -> Result<Vec<ListingEntry>> {
        let g = self.inner.lock().unwrap();
        let mut out = Vec::new();
        for (name, bytes) in g.iter() {
            if let Some(q) = query {
                if !name.contains(q) {
                    continue;
                }
            }
            out.push(ListingEntry {
                name: name.clone(),
                target_site: "(unknown until fetched)".into(),
                bundle_size: bytes.len(),
                registry_signature_present: true,
            });
        }
        Ok(out)
    }

    fn fetch(&self, name: &str) -> Result<Vec<u8>> {
        let g = self.inner.lock().unwrap();
        g.get(name)
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("not found: {name}"))
    }

    fn submit(&self, bundle: &[u8]) -> Result<String> {
        // Stub: a real registry runs the static + fuzz checks
        // (PRD §6.6) before accepting. In-memory pretends acceptance.
        let id = format!("sub-{:x}", bundle.len());
        Ok(id)
    }
}
