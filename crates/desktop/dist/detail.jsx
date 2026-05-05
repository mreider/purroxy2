// Recording detail (full-screen replace) + Settings sheet

const { useState: useStateD, useEffect: useEffectD, useRef: useRefD } = React;

function DetailView({ cap, onBack, onRun, onDelete, onRename, isRunning, runStep }) {
  const [editing, setEditing] = useStateD(false);
  const [name, setName] = useStateD(cap.name);
  const [copied, setCopied] = useStateD(false);
  const [reRecord, setReRecord] = useStateD(false);

  const lr = cap.last_run;
  const stList = cap.step_list || [];

  return (
    <div className="content">
      <div className="content-inner wide">
        <div className="detail-head">
          <div className="detail-favicon">{siteInitials(cap.target_site)}</div>
          <div className="detail-head-info">
            {editing ? (
              <input
                className="detail-name"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => { setEditing(false); onRename?.(cap.name, name); }}
                onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); if (e.key === "Escape") { setName(cap.name); setEditing(false); } }}
              />
            ) : (
              <div className="detail-name" tabIndex={0} onDoubleClick={() => setEditing(true)} title="Double-click to rename">{name}</div>
            )}
            <div className="detail-meta-row">
              <span className="mono">{cap.target_site}</span>
              <span style={{ color: "var(--fg-faint)" }}>·</span>
              <span>{cap.steps} steps</span>
              <span style={{ color: "var(--fg-faint)" }}>·</span>
              <span>created {relTime(cap.created_at)}</span>
              <span style={{ color: "var(--fg-faint)" }}>·</span>
              <span>updated {relTime(cap.updated_at)}</span>
              <span style={{ color: "var(--fg-faint)" }}>·</span>
              <button className="kbd" style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}
                      onClick={() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }}>
                <Icon name={copied ? "check" : "copy"} size={10} />
                {cap.capability_id}
              </button>
            </div>
          </div>
          <div className="detail-actions">
            <button className="btn" onClick={() => setEditing(true)}><Icon name="pencil" /> Rename</button>
            <button className="btn btn-primary" onClick={() => onRun(cap)} disabled={isRunning}>
              {isRunning ? <><span className="spinner"></span> Running… {runStep}/{cap.steps}</> : <><Icon name="play" size={11} /> Run <span className="kbd-hint">⌘R</span></>}
            </button>
          </div>
        </div>

        {/* Last run panel */}
        <div className="detail-section">
          <div className="detail-section-head">
            <div className="detail-section-title">Last run</div>
            <div className="detail-section-sub">{lr ? new Date(lr.at).toLocaleString() : "Never run"}</div>
          </div>
          {lr ? (
            <>
              <div className="lastrun-grid">
                <div className="lastrun-cell">
                  <div className="label">Outcome</div>
                  <div className={"val " + (lr.status === "success" ? "success" : lr.status === "repaired" ? "warn" : "fail")}>
                    {lr.status}
                  </div>
                </div>
                <div className="lastrun-cell">
                  <div className="label">Duration</div>
                  <div className="val">{fmtDuration(lr.duration_ms)}</div>
                </div>
                <div className="lastrun-cell">
                  <div className="label">Steps repaired</div>
                  <div className="val">{stList.filter(s => s.repaired).length}</div>
                </div>
                <div className="lastrun-cell">
                  <div className="label">When</div>
                  <div className="val" style={{ fontSize: "var(--fs-15)" }}>{relTime(lr.at)}</div>
                </div>
              </div>
              {lr.status === "failed" && lr.reason && (
                <div className="error-card">
                  <div className="error-card-head">
                    <div className="error-icon"><Icon name="alert" /></div>
                    <div style={{ flex: 1 }}>
                      <h3>{lr.reason}</h3>
                      <p>The capability scorer couldn't find a confident match for this step. You can re-record this single step, or re-record the whole flow.</p>
                    </div>
                  </div>
                  <div className="error-card-actions">
                    <button className="btn btn-primary"><Icon name="redo" /> Re-record this step</button>
                    <button className="btn">Try run again</button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div style={{ padding: "20px", border: "1px solid var(--border)", borderRadius: 8, color: "var(--fg-muted)", fontSize: "var(--fs-13)" }}>
              This recording has never been run. Click <strong>Run</strong> above to verify it works.
            </div>
          )}
        </div>

        {/* Steps list */}
        <div className="detail-section">
          <div className="detail-section-head">
            <div className="detail-section-title">Steps</div>
            <div className="detail-section-sub">{stList.length} captured · ordered, top to bottom</div>
          </div>
          <div className="steps-table">
            {stList.map(s => {
              const dotKind = s.failed ? "fail" : s.repaired ? "warn" : "success";
              return (
                <div className="steps-row" key={s.idx}>
                  <span className="idx">{String(s.idx).padStart(2, "0")}</span>
                  <span className="action">{s.action}</span>
                  <span className="intent">
                    <span className="role">{s.role}</span>
                    {s.intent}
                    {s.vault && <span className="pill accent" style={{ marginLeft: 8 }}>vault</span>}
                    {s.param && <span className="pill" style={{ marginLeft: 8 }}>param</span>}
                    {s.repaired && <span className="pill warn" style={{ marginLeft: 8 }}>repaired</span>}
                  </span>
                  <span className="duration">{s.failed ? "—" : fmtDuration(s.duration_ms)}</span>
                  <span className="badge"><span className={"status-dot status-" + dotKind}></span></span>
                </div>
              );
            })}
            {stList.length === 0 && (
              <div style={{ padding: 16, color: "var(--fg-subtle)", fontSize: "var(--fs-13)" }}>
                Step snapshots are loaded on demand. None to show.
              </div>
            )}
          </div>
        </div>

        {/* Metadata */}
        <div className="detail-section">
          <div className="detail-section-head">
            <div className="detail-section-title">Metadata</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: "10px 18px", fontSize: "var(--fs-13)" }}>
            <span style={{ color: "var(--fg-subtle)" }}>Capability ID</span>
            <span style={{ fontFamily: "var(--font-mono)" }}>{cap.capability_id}</span>
            <span style={{ color: "var(--fg-subtle)" }}>Directory</span>
            <span style={{ fontFamily: "var(--font-mono)", color: "var(--fg-muted)" }}>{cap.dir}</span>
            <span style={{ color: "var(--fg-subtle)" }}>Target site</span>
            <span style={{ fontFamily: "var(--font-mono)" }}>{cap.target_site}</span>
            <span style={{ color: "var(--fg-subtle)" }}>Created</span>
            <span>{new Date(cap.created_at).toLocaleString()}</span>
            <span style={{ color: "var(--fg-subtle)" }}>Updated</span>
            <span>{new Date(cap.updated_at).toLocaleString()}</span>
          </div>
        </div>

        {/* Danger zone */}
        <div className="detail-section">
          <div className="detail-section-head">
            <div className="detail-section-title" style={{ color: "var(--status-fail)" }}>Danger zone</div>
          </div>
          <div className="danger-zone">
            <div className="danger-zone-row">
              <div className="info">
                <div className="t">Re-record</div>
                <div className="d">Replaces all current steps. The old recording is gone.</div>
              </div>
              <button className="btn" onClick={() => setReRecord(true)}><Icon name="redo" /> Re-record</button>
            </div>
            <div className="danger-zone-row">
              <div className="info">
                <div className="t">Delete recording</div>
                <div className="d">Permanently removes <code style={{ fontFamily: "var(--font-mono)" }}>{cap.name}</code> from your library.</div>
              </div>
              <button className="btn btn-danger" onClick={() => onDelete(cap)}>
                <Icon name="trash" /> Delete <span className="kbd-hint">⌘⌫</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {reRecord && (
        <ConfirmModal
          title={`Re-record ${cap.name}?`}
          body={`This will start a new recording session and replace the current ${cap.steps} steps. The old recording will be gone.`}
          confirmLabel="Re-record"
          danger={false}
          onConfirm={() => { setReRecord(false); /* would open wizard */ }}
          onCancel={() => setReRecord(false)}
        />
      )}
    </div>
  );
}

function SettingsSheet({ settings, onClose, onChangeSetting }) {
  const [appearance, setAppearance] = useStateD(settings.appearance);
  const [chromePath, setChromePath] = useStateD(settings.chrome_path);
  const [componentPath, setComponentPath] = useStateD(settings.component_path);
  const [advanced, setAdvanced] = useStateD(false);
  const [mcp, setMcp] = useStateD(null);
  const [mcpTestResult, setMcpTestResult] = useStateD(null);

  useEffectD(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  useEffectD(() => {
    window.IPC.mcpInfo().then(setMcp).catch(() => {});
  }, []);

  function applyTheme(v) {
    setAppearance(v);
    document.documentElement.classList.remove("theme-light", "theme-dark");
    if (v === "light") document.documentElement.classList.add("theme-light");
    else if (v === "dark") document.documentElement.classList.add("theme-dark");
    else {
      const m = window.matchMedia("(prefers-color-scheme: dark)").matches;
      document.documentElement.classList.add(m ? "theme-dark" : "theme-light");
    }
    onChangeSetting?.("appearance", v);
  }

  function commitChrome() {
    if (chromePath !== settings.chrome_path) onChangeSetting?.("chrome_path", chromePath);
  }
  function commitComponent() {
    if (componentPath !== settings.component_path) onChangeSetting?.("component_path", componentPath);
  }

  return (
    <>
      <div className="overlay" onMouseDown={onClose} style={{ animation: "overlay-in var(--dur-fast) var(--ease-out)" }} />
      <aside className="sheet">
        <div className="sheet-head">
          <Icon name="settings" />
          <div className="sheet-title">Settings</div>
          <button className="header-icon-btn" onClick={onClose}><Icon name="close" /></button>
        </div>
        <div className="sheet-body">

          <div className="sheet-section">
            <h4>Library</h4>
            <div className="field">
              <label className="field-label">Recordings folder</label>
              <div className="field-row-paths">
                <input className="input input-mono input-readonly" readOnly value={settings.library_path} />
                <button className="btn" onClick={async () => {
                  try {
                    const p = await window.IPC.pickLibraryDir();
                    if (p) onChangeSetting?.("library_path", p);
                  } catch (_) {}
                }}>Change…</button>
              </div>
              <div className="field-hint">All your recordings live here. Each is a folder; safe to back up or sync. Changes take effect on next launch.</div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn" onClick={() => window.IPC.openLibraryDir().catch(() => {})}><Icon name="reveal" /> Reveal in Finder</button>
            </div>
          </div>

          <div className="sheet-section">
            <h4>Chrome</h4>
            <div className="field">
              <label className="field-label">Browser binary</label>
              <input
                className="input input-mono"
                value={chromePath}
                onChange={(e) => setChromePath(e.target.value)}
                onBlur={commitChrome}
                onKeyDown={(e) => { if (e.key === "Enter") { commitChrome(); e.target.blur(); } }}
              />
              <div className="field-hint">Path to the Google Chrome executable used for recording and replay.</div>
            </div>
          </div>

          <div className="sheet-section">
            <h4>Appearance</h4>
            <div className="field">
              <label className="field-label">Theme</label>
              <div className="segmented">
                {["system", "light", "dark"].map(v => (
                  <button key={v} className={appearance === v ? "is-on" : ""} onClick={() => applyTheme(v)}>
                    {v.charAt(0).toUpperCase() + v.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="sheet-section">
            <h4 style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }} onClick={() => setAdvanced(!advanced)}>
              <Icon name={advanced ? "chevron_d" : "chevron_r"} size={10} />
              Capability component
              <span className="pill" style={{ marginLeft: 6 }}>advanced</span>
            </h4>
            {advanced && (
              <div className="field">
                <label className="field-label">WASM repair component</label>
                <input
                  className="input input-mono"
                  value={componentPath}
                  onChange={(e) => setComponentPath(e.target.value)}
                  onBlur={commitComponent}
                  onKeyDown={(e) => { if (e.key === "Enter") { commitComponent(); e.target.blur(); } }}
                />
                <div className="field-hint">Sandboxed scorer used when a recorded element can't be found at replay.</div>
              </div>
            )}
          </div>

          <div className="sheet-section">
            <h4>Claude Desktop (MCP)</h4>
            {mcp && !mcp.binary_exists && (
              <div className="field-hint" style={{ color: "var(--status-fail)" }}>
                MCP binary not found at {mcp.binary_path}. Build with <code>cargo build -p mcp --release</code>.
              </div>
            )}
            {mcp && mcp.binary_exists && (
              <>
                <div className="field">
                  <label className="field-label">Server binary</label>
                  <input className="input input-mono input-readonly" readOnly value={mcp.binary_path} />
                  <div className="field-hint">Add to Claude Desktop's <code>claude_desktop_config.json</code> under <code>mcpServers</code>.</div>
                </div>
                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <button className="btn" onClick={async () => {
                    try { await navigator.clipboard.writeText(mcp.claude_config_snippet); } catch (_) {}
                  }}><Icon name="copy" /> Copy config snippet</button>
                  <button className="btn" onClick={async () => {
                    setMcpTestResult("testing…");
                    try {
                      const out = await window.IPC.mcpTest();
                      setMcpTestResult("✓ " + out.slice(0, 80));
                    } catch (err) {
                      setMcpTestResult("✗ " + String(err));
                    }
                  }}>Test connection</button>
                </div>
                {mcpTestResult && (
                  <div className="field-hint mono" style={{ wordBreak: "break-all" }}>{mcpTestResult}</div>
                )}
              </>
            )}
          </div>

          <div className="sheet-section">
            <h4>Diagnostics</h4>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button className="btn" style={{ justifyContent: "flex-start" }} onClick={async () => {
                try {
                  const text = await window.IPC.debugInfo();
                  await navigator.clipboard.writeText(text);
                } catch (_) {}
              }}><Icon name="copy" /> Copy debug info</button>
            </div>
            <div className="field-hint" style={{ marginTop: 12 }}>Library path changes take effect on next launch.</div>
          </div>

        </div>
      </aside>
    </>
  );
}

Object.assign(window, { DetailView, SettingsSheet });
