// Install flow. Pulls a bundle from a Registry, verifies it via
// bundle::unpack (which checks signature + embedded public key),
// and lays it out in a per-user library directory. PRD §7.5:
// "Bundle signatures are verified at install time and at every load".

use anyhow::{Context, Result};
use std::path::{Path, PathBuf};

use crate::bundle::{unpack, UnpackError};
use crate::client::Registry;

pub struct InstallOptions<'a> {
    pub library_root: &'a Path,
    pub capability_name: &'a str,
}

pub fn install_from_registry<R: Registry>(
    registry: &R,
    opts: &InstallOptions<'_>,
) -> Result<PathBuf> {
    let bytes = registry
        .fetch(opts.capability_name)
        .with_context(|| format!("fetching {}", opts.capability_name))?;
    install_from_bytes(&bytes, opts)
}

pub fn install_from_bytes(bytes: &[u8], opts: &InstallOptions<'_>) -> Result<PathBuf> {
    let dest = opts.library_root.join(opts.capability_name);
    if dest.exists() {
        std::fs::remove_dir_all(&dest)
            .with_context(|| format!("clearing existing install at {}", dest.display()))?;
    }
    match unpack(bytes, &dest) {
        Ok(p) => Ok(p),
        Err(e @ UnpackError::NotVerified) => {
            // Verification failure: do NOT leave a partially-extracted
            // directory; the install is rejected.
            let _ = std::fs::remove_dir_all(&dest);
            Err(anyhow::anyhow!("install rejected: {e}"))
        }
        Err(e) => Err(anyhow::anyhow!("install failed: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bundle::{pack, PackInputs};
    use crate::client::MemoryRegistry;
    use security::keychain::MemoryKeystore;
    use security::SigningKey;

    fn fixture_recording() -> PathBuf {
        let mut p = std::env::temp_dir();
        let ns = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        p.push(format!("purroxy-install-test-rec-{ns:x}"));
        std::fs::create_dir_all(p.join("snapshots")).unwrap();
        std::fs::write(p.join("manifest.json"), br#"{"recording_id":"r","target_site":"https://example.com/","capability_name":"my-cap","bundle_version":1,"wit_version":"purroxy:capability@1.0.0","steps":[]}"#).unwrap();
        std::fs::write(p.join("snapshots/initial.json"), b"{}").unwrap();
        p
    }

    #[test]
    fn install_round_trip_through_memory_registry() {
        let store = MemoryKeystore::new();
        let key = SigningKey::load_or_generate(&store).unwrap();
        let recording = fixture_recording();
        let bundle = pack(
            &PackInputs {
                recording_dir: recording.clone(),
                logic_wasm: None,
            },
            &key,
        )
        .unwrap();

        let registry = MemoryRegistry::with("my-cap", bundle);
        let mut library = std::env::temp_dir();
        let ns = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        library.push(format!("purroxy-library-{ns:x}"));

        let installed = install_from_registry(
            &registry,
            &InstallOptions {
                library_root: &library,
                capability_name: "my-cap",
            },
        )
        .unwrap();

        assert!(installed.join("manifest.json").exists());
        let _ = std::fs::remove_dir_all(&recording);
        let _ = std::fs::remove_dir_all(&library);
    }

    #[test]
    fn install_refuses_unverifiable_bundle() {
        // A bytes blob that's not a valid zip → unpack fails →
        // install returns Err.
        let mut library = std::env::temp_dir();
        let ns = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        library.push(format!("purroxy-library-bad-{ns:x}"));

        let r = install_from_bytes(
            b"not a zip",
            &InstallOptions {
                library_root: &library,
                capability_name: "bad-cap",
            },
        );
        assert!(r.is_err());
        let _ = std::fs::remove_dir_all(&library);
    }
}
