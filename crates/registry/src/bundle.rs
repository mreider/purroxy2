// Bundle pack / unpack / verify. PRD §3 capability bundle format.
//
// pack(recording_dir, logic_wasm, signing_key) -> .purroxy bytes
// unpack(bytes, dest_dir) -> verified recording dir on disk
//
// The signature covers a canonical byte payload built from the
// archive contents in deterministic order. Tamper anywhere and
// verification fails (tested).

use anyhow::{anyhow, Context, Result};
use std::collections::BTreeMap;
use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};
use zip::write::{ExtendedFileOptions, FileOptions};
use zip::CompressionMethod;

use security::{SigningKey, VerifyingKey};

const SIGNATURE_FILE: &str = "signature.bin";
const PUBKEY_FILE: &str = "public_key.bin";

/// Files that participate in the canonical signing payload.
fn payload_excludes(path: &str) -> bool {
    path == SIGNATURE_FILE || path == PUBKEY_FILE
}

/// Build the canonical payload bytes for signing or verifying.
/// Deterministic regardless of the order files were added.
pub fn canonical_payload(files: &BTreeMap<String, Vec<u8>>) -> Vec<u8> {
    let mut buf = Vec::new();
    for (path, content) in files {
        if payload_excludes(path) {
            continue;
        }
        buf.extend_from_slice(&(path.len() as u32).to_be_bytes());
        buf.extend_from_slice(path.as_bytes());
        buf.extend_from_slice(&(content.len() as u64).to_be_bytes());
        buf.extend_from_slice(content);
    }
    buf
}

pub struct PackInputs {
    pub recording_dir: PathBuf,
    pub logic_wasm: Option<PathBuf>,
}

/// Build a .purroxy archive from a recording dir + optional WASM
/// component. Signs with the provided key, embeds the verifying key.
pub fn pack(inputs: &PackInputs, key: &SigningKey) -> Result<Vec<u8>> {
    let mut files: BTreeMap<String, Vec<u8>> = BTreeMap::new();

    let manifest_path = inputs.recording_dir.join("manifest.json");
    let manifest_bytes = std::fs::read(&manifest_path)
        .with_context(|| format!("reading {}", manifest_path.display()))?;
    files.insert("manifest.json".into(), manifest_bytes);

    let snapshots_dir = inputs.recording_dir.join("snapshots");
    if snapshots_dir.is_dir() {
        for entry in std::fs::read_dir(&snapshots_dir)? {
            let entry = entry?;
            let p = entry.path();
            if !p.is_file() {
                continue;
            }
            let name = p
                .file_name()
                .and_then(|n| n.to_str())
                .ok_or_else(|| anyhow!("snapshot path lacks utf-8 name"))?;
            let bytes = std::fs::read(&p)?;
            files.insert(format!("snapshots/{name}"), bytes);
        }
    }

    if let Some(wasm) = &inputs.logic_wasm {
        let bytes = std::fs::read(wasm)
            .with_context(|| format!("reading wasm {}", wasm.display()))?;
        files.insert("logic.wasm".into(), bytes);
    }

    let payload = canonical_payload(&files);
    let signature = key.sign(&payload);
    let pubkey_bytes = key.verifying_key().to_bytes();

    files.insert(SIGNATURE_FILE.into(), signature);
    files.insert(PUBKEY_FILE.into(), pubkey_bytes.to_vec());

    write_zip(&files)
}

fn write_zip(files: &BTreeMap<String, Vec<u8>>) -> Result<Vec<u8>> {
    let mut buf = Cursor::new(Vec::new());
    {
        let mut zw = zip::ZipWriter::new(&mut buf);
        let opts: FileOptions<'_, ExtendedFileOptions> = FileOptions::default()
            .compression_method(CompressionMethod::Deflated);
        for (path, content) in files {
            zw.start_file(path, opts.clone())?;
            zw.write_all(content)?;
        }
        zw.finish()?;
    }
    Ok(buf.into_inner())
}

#[derive(Debug)]
pub enum UnpackError {
    NotAZip,
    MissingFile(&'static str),
    BadSignature,
    NotVerified,
    Io(String),
}

impl std::fmt::Display for UnpackError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            UnpackError::NotAZip => write!(f, "bundle is not a valid zip archive"),
            UnpackError::MissingFile(name) => write!(f, "bundle is missing required file: {name}"),
            UnpackError::BadSignature => write!(f, "signature length is wrong"),
            UnpackError::NotVerified => write!(f, "bundle signature did not verify"),
            UnpackError::Io(e) => write!(f, "io: {e}"),
        }
    }
}
impl std::error::Error for UnpackError {}

/// Read a .purroxy archive into memory, verify, and write the
/// extracted files (manifest, snapshots, logic.wasm) under
/// dest_dir. Signature and public_key files are preserved at
/// dest_dir/signature.bin and dest_dir/public_key.bin so the
/// installation remains verifiable on every load (PRD §7.5).
pub fn unpack(archive: &[u8], dest_dir: &Path) -> Result<PathBuf, UnpackError> {
    let cursor = Cursor::new(archive);
    let mut zip = zip::ZipArchive::new(cursor).map_err(|_| UnpackError::NotAZip)?;
    let mut files: BTreeMap<String, Vec<u8>> = BTreeMap::new();
    for i in 0..zip.len() {
        let mut f = zip
            .by_index(i)
            .map_err(|e| UnpackError::Io(e.to_string()))?;
        let name = f.name().to_string();
        let mut buf = Vec::new();
        f.read_to_end(&mut buf)
            .map_err(|e| UnpackError::Io(e.to_string()))?;
        files.insert(name, buf);
    }

    let sig = files
        .get(SIGNATURE_FILE)
        .cloned()
        .ok_or(UnpackError::MissingFile(SIGNATURE_FILE))?;
    let pk = files
        .get(PUBKEY_FILE)
        .cloned()
        .ok_or(UnpackError::MissingFile(PUBKEY_FILE))?;

    let payload = canonical_payload(&files);
    let vk = VerifyingKey::from_bytes(&pk).map_err(|_| UnpackError::BadSignature)?;
    vk.verify(&payload, &sig).map_err(|_| UnpackError::NotVerified)?;

    std::fs::create_dir_all(dest_dir).map_err(|e| UnpackError::Io(e.to_string()))?;
    for (path, content) in &files {
        let target = dest_dir.join(path);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|e| UnpackError::Io(e.to_string()))?;
        }
        std::fs::write(&target, content).map_err(|e| UnpackError::Io(e.to_string()))?;
    }
    Ok(dest_dir.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;
    use security::keychain::MemoryKeystore;

    fn tmp(name: &str) -> PathBuf {
        let mut p = std::env::temp_dir();
        let ns = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        p.push(format!("purroxy-bundle-test-{name}-{ns:x}"));
        p
    }

    fn fixture_recording() -> PathBuf {
        let p = tmp("rec");
        std::fs::create_dir_all(p.join("snapshots")).unwrap();
        std::fs::write(p.join("manifest.json"), br#"{"recording_id":"r","target_site":"https://example.com/","capability_name":"test","bundle_version":1,"wit_version":"purroxy:capability@1.0.0","steps":[]}"#).unwrap();
        std::fs::write(p.join("snapshots/initial.json"), b"{}").unwrap();
        p
    }

    #[test]
    fn pack_then_unpack_round_trips() {
        let store = MemoryKeystore::new();
        let key = SigningKey::load_or_generate(&store).unwrap();
        let recording = fixture_recording();
        let bytes = pack(
            &PackInputs {
                recording_dir: recording.clone(),
                logic_wasm: None,
            },
            &key,
        )
        .unwrap();
        let dest = tmp("out");
        unpack(&bytes, &dest).expect("verify");
        let manifest = std::fs::read_to_string(dest.join("manifest.json")).unwrap();
        assert!(manifest.contains("\"capability_name\":\"test\""));

        let _ = std::fs::remove_dir_all(&recording);
        let _ = std::fs::remove_dir_all(&dest);
    }

    #[test]
    fn detects_tampered_manifest() {
        let store = MemoryKeystore::new();
        let key = SigningKey::load_or_generate(&store).unwrap();
        let recording = fixture_recording();
        let mut bytes = pack(
            &PackInputs {
                recording_dir: recording.clone(),
                logic_wasm: None,
            },
            &key,
        )
        .unwrap();

        // Re-zip with a tampered manifest but the original signature.
        let mut files: BTreeMap<String, Vec<u8>> = BTreeMap::new();
        let mut zip = zip::ZipArchive::new(Cursor::new(&bytes)).unwrap();
        for i in 0..zip.len() {
            let mut f = zip.by_index(i).unwrap();
            let name = f.name().to_string();
            let mut buf = Vec::new();
            f.read_to_end(&mut buf).unwrap();
            files.insert(name, buf);
        }
        files.insert(
            "manifest.json".into(),
            br#"{"recording_id":"EVIL","target_site":"https://example.com/","capability_name":"test","bundle_version":1,"wit_version":"purroxy:capability@1.0.0","steps":[]}"#.to_vec(),
        );
        bytes = write_zip(&files).unwrap();

        let dest = tmp("tamper");
        let r = unpack(&bytes, &dest);
        assert!(matches!(r, Err(UnpackError::NotVerified)), "got {:?}", r);
        let _ = std::fs::remove_dir_all(&recording);
    }

    #[test]
    fn missing_signature_rejects() {
        let bytes = write_zip(&BTreeMap::from([("manifest.json".into(), b"{}".to_vec())]))
            .unwrap();
        let dest = tmp("nosig");
        let r = unpack(&bytes, &dest);
        assert!(matches!(r, Err(UnpackError::MissingFile(SIGNATURE_FILE))));
    }

    #[test]
    fn canonical_payload_is_order_independent() {
        let mut a = BTreeMap::new();
        a.insert("z.txt".into(), b"hello".to_vec());
        a.insert("a.txt".into(), b"world".to_vec());
        let p1 = canonical_payload(&a);

        let mut b = BTreeMap::new();
        b.insert("a.txt".into(), b"world".to_vec());
        b.insert("z.txt".into(), b"hello".to_vec());
        let p2 = canonical_payload(&b);

        assert_eq!(p1, p2);
    }

    #[test]
    fn signature_and_pubkey_excluded_from_payload() {
        let mut files = BTreeMap::new();
        files.insert("manifest.json".into(), b"x".to_vec());
        files.insert(SIGNATURE_FILE.into(), b"FAKE".to_vec());
        files.insert(PUBKEY_FILE.into(), b"FAKE".to_vec());
        let p = canonical_payload(&files);
        assert!(!p.windows(4).any(|w| w == b"FAKE"));
    }
}
