// v1 capability JSON shape. Reverse-engineered from the v1 Electron
// codebase per the PRD's description of v1 capability storage. The
// real on-disk format may have evolved across v1 minor versions; the
// converter is permissive (extra fields ignored, missing optional
// fields default).

use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct V1Capability {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub url: String,
    #[serde(default)]
    pub steps: Vec<V1Step>,
    #[serde(default)]
    pub parameters: Vec<V1Parameter>,
    #[serde(default)]
    pub extractions: Vec<V1Extraction>,
    /// Arbitrary host-resident logic flag: when present, the v1
    /// host code did something the v2 default behaviors may not
    /// reproduce. The migration surfaces this in MigrationReport.
    #[serde(default)]
    pub host_logic: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct V1Step {
    pub r#type: String,         // "click", "input", "navigate"
    #[serde(default)]
    pub selector: Option<String>,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub url: Option<String>,    // navigate target
    #[serde(default)]
    pub value: Option<String>,  // input value
    #[serde(default)]
    pub role: Option<String>,
    #[serde(default)]
    pub aria_label: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct V1Parameter {
    pub name: String,
    pub kind: String,
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct V1Extraction {
    pub name: String,
    pub kind: String,
    #[serde(default)]
    pub sensitive: bool,
    #[serde(default)]
    pub description: Option<String>,
}
