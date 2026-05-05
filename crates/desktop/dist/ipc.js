// IPC adapter. Hides Tauri vs design-preview behind one shape.
//
// In Tauri: invoke real Rust commands, listen to recorder/replay events.
// In a plain browser (file://): fall back to window.MOCK so the design
// can be iterated without a live Rust backend.

(function () {
  const inTauri = !!(window.__TAURI__ && window.__TAURI__.core);
  const invoke = inTauri ? window.__TAURI__.core.invoke : null;

  function asISO(v) {
    if (!v) return null;
    if (typeof v === "string") return v;
    if (typeof v === "number") return new Date(v).toISOString();
    return null;
  }

  // Map Rust CapabilityListItem (name, target_site, steps, dir) onto
  // the richer shape the design expects (created_at, updated_at,
  // capability_id, last_run, step_list). Missing fields default; the
  // design tolerates absence on most of them.
  function adaptListItem(c) {
    return {
      name: c.name,
      target_site: c.target_site,
      steps: c.steps,
      dir: c.dir,
      created_at: c.created_at || null,
      updated_at: c.updated_at || null,
      capability_id: c.capability_id || c.name,
      last_run: c.last_run || null,
      step_list: c.step_list || null,
    };
  }

  // Map Rust RunRecord -> design-shape last_run. The run_capability
  // command inlines a canonical 'last_run_summary' object on the
  // returned value; prefer that. Fall back to deriving from the raw
  // record for back-compat.
  function adaptRunRecord(rec) {
    if (!rec) return { status: "failed", at: new Date().toISOString(), duration_ms: 0, reason: "no record" };
    if (rec.last_run_summary) {
      const s = rec.last_run_summary;
      return {
        at: s.at,
        status: s.status,
        duration_ms: s.duration_ms || 0,
        reason: s.reason || undefined,
        raw: rec,
      };
    }
    const status = rec.outcome === "success" ? "success" : "failed";
    return {
      at: new Date().toISOString(),
      status,
      duration_ms: (rec.ended_at_ms || 0) - (rec.started_at_ms || 0),
      reason: typeof rec.outcome === "object" ? Object.values(rec.outcome)[0]?.reason : undefined,
      raw: rec,
    };
  }

  const ipc = {
    inTauri,

    async libraryInfo() {
      if (inTauri) return await invoke("library_info");
      return { root: window.MOCK.settings.library_path, count: window.MOCK.seed.length };
    },

    async listCapabilities() {
      if (inTauri) {
        const items = await invoke("list_capabilities");
        return items.map(adaptListItem);
      }
      return window.MOCK.seed;
    },

    async runCapability(name) {
      if (inTauri) {
        const rec = await invoke("run_capability", { name });
        return adaptRunRecord(rec);
      }
      // Fallback: design-preview mode. Pretend success.
      return { at: new Date().toISOString(), status: "success", duration_ms: 4000 };
    },

    // ---- Stage B+ stubs. Real impl lands when Rust commands ship. ----
    // The UI calls these; today they no-op or throw "not implemented"
    // so design flows are testable without breaking.
    async startRecording({ name, url }) {
      if (inTauri) return await invoke("start_recording", { name, url });
      return { recording_id: "preview-" + Date.now(), output_dir: "(preview)" };
    },
    async stopRecording() {
      if (inTauri) return await invoke("stop_recording");
      return { saved: true, recording_id: "preview", output_dir: "(preview)", steps: 4 };
    },
    async discardRecording() {
      if (inTauri) return await invoke("discard_recording");
    },
    async deleteCapability(name) {
      if (inTauri) return await invoke("delete_capability", { name });
    },
    async renameCapability(from, to) {
      if (inTauri) return await invoke("rename_capability", { from, to });
    },
    async revealInFinder(name) {
      if (inTauri) return await invoke("reveal_in_finder", { name });
    },
    async openLibraryDir() {
      if (inTauri) return await invoke("open_library_dir");
    },
    async debugInfo() {
      if (inTauri) return await invoke("debug_info");
      return [
        "# Purroxy desktop debug info (preview)",
        "",
        "app_version:  preview",
        "library_path: " + window.MOCK.settings.library_path,
        "chrome_path:  " + window.MOCK.settings.chrome_path,
      ].join("\n");
    },

    // Bundle import/export.
    async pickSaveBundlePath(default_name) {
      if (inTauri) return await invoke("pick_save_bundle_path", { defaultName: default_name });
      return null;
    },
    async pickImportBundlePath() {
      if (inTauri) return await invoke("pick_import_bundle_path");
      return null;
    },
    async pickLibraryDir() {
      if (inTauri) return await invoke("pick_library_dir");
      return null;
    },
    async exportCapability(name, dest_path) {
      if (inTauri) return await invoke("export_capability", { name, destPath: dest_path });
    },
    async importBundle(bundle_path) {
      if (inTauri) return await invoke("import_bundle", { bundlePath: bundle_path });
      return "preview";
    },

    // MCP / Claude Desktop integration.
    async mcpInfo() {
      if (inTauri) return await invoke("mcp_info");
      return {
        binary_path: "/path/to/mcp",
        binary_exists: false,
        library_path: window.MOCK.settings.library_path,
        claude_config_snippet: '{\n  "mcpServers": { "purroxy": { "command": "/path/to/mcp" } }\n}',
      };
    },
    async mcpTest() {
      if (inTauri) return await invoke("mcp_test");
      return '{"jsonrpc":"2.0","id":1,"result":{...}}';
    },
    async settingsGet() {
      if (inTauri) {
        try { return await invoke("settings_get"); }
        catch (_) { /* not yet wired */ }
      }
      return window.MOCK.settings;
    },
    async settingsSet(key, value) {
      if (inTauri) return await invoke("settings_set", { key, value });
      return window.MOCK.settings;
    },

    // Event subscription. Tauri uses event channel; preview is a no-op.
    on(event, handler) {
      if (inTauri && window.__TAURI__.event) {
        let unlisten = null;
        window.__TAURI__.event.listen(event, (e) => handler(e.payload))
          .then((fn) => { unlisten = fn; });
        return () => { if (unlisten) unlisten(); };
      }
      return () => {};
    },
  };

  window.IPC = ipc;
})();
