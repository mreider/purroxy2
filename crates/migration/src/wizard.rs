// First-launch migration wizard. Reads every v1 capability JSON
// from a v1 install dir, runs convert() on each, writes:
//   <v2_library>/<name>/manifest.json
//   <v2_library>/<name>/migration-report.json
// Returns a summary so the wizard UI (Phase 4) can render results.

use anyhow::{Context, Result};
use serde::Serialize;
use std::path::{Path, PathBuf};

use crate::convert::{convert, ConvertOutcome, MigrationStatus};
use crate::v1::V1Capability;

#[derive(Debug, Serialize)]
pub struct WizardSummary {
    pub total_v1_capabilities: usize,
    pub healthy: usize,
    pub needs_review: usize,
    pub failed_to_parse: usize,
    pub failed_paths: Vec<String>,
}

pub fn migrate_dir(v1_dir: &Path, v2_library: &Path) -> Result<WizardSummary> {
    let mut summary = WizardSummary {
        total_v1_capabilities: 0,
        healthy: 0,
        needs_review: 0,
        failed_to_parse: 0,
        failed_paths: vec![],
    };
    if !v1_dir.is_dir() {
        return Ok(summary);
    }
    std::fs::create_dir_all(v2_library)
        .with_context(|| format!("creating v2 library {}", v2_library.display()))?;

    for entry in std::fs::read_dir(v1_dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        summary.total_v1_capabilities += 1;
        let raw = match std::fs::read_to_string(&path) {
            Ok(s) => s,
            Err(_) => {
                summary.failed_to_parse += 1;
                summary.failed_paths.push(path.display().to_string());
                continue;
            }
        };
        let v1: V1Capability = match serde_json::from_str(&raw) {
            Ok(v) => v,
            Err(_) => {
                summary.failed_to_parse += 1;
                summary.failed_paths.push(path.display().to_string());
                continue;
            }
        };
        let out = convert(&v1);
        write_outcome(&out, v2_library)?;
        match out.report.status {
            MigrationStatus::Healthy => summary.healthy += 1,
            MigrationStatus::NeedsReview => summary.needs_review += 1,
        }
    }
    Ok(summary)
}

fn write_outcome(out: &ConvertOutcome, v2_library: &Path) -> Result<PathBuf> {
    let dir = v2_library.join(&out.manifest.capability_name);
    std::fs::create_dir_all(&dir)
        .with_context(|| format!("mkdir {}", dir.display()))?;
    std::fs::write(
        dir.join("manifest.json"),
        serde_json::to_string_pretty(&out.manifest)?,
    )?;
    std::fs::write(
        dir.join("migration-report.json"),
        serde_json::to_string_pretty(&out.report)?,
    )?;
    Ok(dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(label: &str) -> PathBuf {
        let mut p = std::env::temp_dir();
        let ns = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        p.push(format!("purroxy-migration-{label}-{ns:x}"));
        p
    }

    #[test]
    fn migrates_a_dir_of_v1_jsons() {
        let v1 = tmp("v1");
        std::fs::create_dir_all(&v1).unwrap();
        std::fs::write(
            v1.join("a.json"),
            r#"{"id":"a","name":"alpha","url":"https://example.com/","steps":[{"type":"click","label":"x"}]}"#,
        )
        .unwrap();
        std::fs::write(
            v1.join("b.json"),
            r#"{"id":"b","name":"beta","url":"https://example.com/","steps":[{"type":"click","label":"y"}],"host_logic":["x"]}"#,
        )
        .unwrap();
        // a non-json file that should be ignored
        std::fs::write(v1.join("notes.txt"), b"ignore me").unwrap();
        // a malformed json that should count as failed_to_parse
        std::fs::write(v1.join("bad.json"), b"{not-json}").unwrap();

        let v2 = tmp("v2");
        let summary = migrate_dir(&v1, &v2).unwrap();
        assert_eq!(summary.total_v1_capabilities, 3);
        assert_eq!(summary.healthy, 1);
        assert_eq!(summary.needs_review, 1);
        assert_eq!(summary.failed_to_parse, 1);

        assert!(v2.join("alpha/manifest.json").exists());
        assert!(v2.join("alpha/migration-report.json").exists());
        assert!(v2.join("beta/manifest.json").exists());
        assert!(v2.join("beta/migration-report.json").exists());

        let _ = std::fs::remove_dir_all(&v1);
        let _ = std::fs::remove_dir_all(&v2);
    }

    #[test]
    fn missing_v1_dir_returns_empty_summary() {
        let v1 = tmp("missing-v1");
        let v2 = tmp("missing-v2");
        let summary = migrate_dir(&v1, &v2).unwrap();
        assert_eq!(summary.total_v1_capabilities, 0);
    }
}
