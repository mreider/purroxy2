// Settings persistence. Read on startup, written by settings_set,
// applied as env vars so subprocesses (recorder) and in-process
// engines (replay) pick up changes without their own config plumbing.
//
// File: <library_root>/../config.json. Missing keys default. Bad
// JSON → log + fall back to defaults; never crash the app on a
// corrupt config.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub library_path: String,
    pub chrome_path: String,
    pub component_path: String,
    pub appearance: String,
}

impl Settings {
    pub fn defaults(library_path: &Path, component_path: &Path) -> Self {
        Self {
            library_path: library_path.to_string_lossy().to_string(),
            chrome_path: default_chrome_path(),
            component_path: component_path.to_string_lossy().to_string(),
            appearance: "system".to_string(),
        }
    }
}

pub fn default_chrome_path() -> String {
    if let Ok(p) = std::env::var("PURROXY_CHROME") {
        return p;
    }
    if cfg!(target_os = "macos") {
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome".into()
    } else if cfg!(target_os = "windows") {
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe".into()
    } else {
        "google-chrome".into()
    }
}

pub fn config_path(library_root: &Path) -> PathBuf {
    // The parent dir (Application Support/Purroxy on macOS) is shared
    // with the v1 Electron build's config.json; use a v2-specific
    // filename to avoid clobbering it.
    library_root
        .parent()
        .unwrap_or(library_root)
        .join("purroxy-v2-config.json")
}

pub fn load(library_root: &Path, component_path: &Path) -> Settings {
    let mut s = Settings::defaults(library_root, component_path);
    let path = config_path(library_root);
    if let Ok(raw) = std::fs::read_to_string(&path) {
        match serde_json::from_str::<Settings>(&raw) {
            Ok(loaded) => s = loaded,
            Err(e) => {
                eprintln!("[settings] WARN: bad config at {} ({e}); using defaults", path.display());
            }
        }
    }
    s
}

pub fn save(library_root: &Path, settings: &Settings) -> Result<(), String> {
    let path = config_path(library_root);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir {}: {e}", parent.display()))?;
    }
    let json = serde_json::to_string_pretty(settings).map_err(|e| format!("serialize: {e}"))?;
    std::fs::write(&path, json).map_err(|e| format!("write {}: {e}", path.display()))?;
    Ok(())
}

/// Apply settings to environment variables so child processes and
/// engines that read env at run time pick them up. Called on startup
/// and after every settings_set.
pub fn apply_env(s: &Settings) {
    // SAFETY: set_var is unsafe in newer std; we only set during
    // app startup or via settings_set called from a single Tauri
    // command at a time. No concurrent readers in the same process.
    unsafe {
        std::env::set_var("PURROXY_CHROME", &s.chrome_path);
        std::env::set_var("PURROXY_COMPONENT", &s.component_path);
        std::env::set_var("PURROXY_LIBRARY", &s.library_path);
    }
}
