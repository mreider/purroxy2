// Main app — routing, run simulation, mounts everything

const { useState, useEffect, useReducer, useCallback, useRef } = React;

function App() {
  const [route, setRoute] = useState({ name: "library", filter: "all" });
  const [appState, setAppState] = useState("loaded"); // loading | loaded | error | empty
  const [caps, setCaps] = useState(window.MOCK.seed);
  const [sort, setSort] = useState("recent");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [ctxMenu, setCtxMenu] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [runState, setRunState] = useState({}); // name -> { running, step }

  // Theme: respect prefers-color-scheme
  useEffect(() => {
    const m = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.classList.remove("theme-light", "theme-dark");
      document.documentElement.classList.add(m.matches ? "theme-dark" : "theme-light");
    };
    apply();
    m.addEventListener?.("change", apply);
    document.documentElement.classList.add("density-comfortable");
    return () => m.removeEventListener?.("change", apply);
  }, []);

  // Counts for sidebar
  const counts = {
    all: caps.length,
    recent: caps.filter(c => c.last_run).length,
    failed: caps.filter(c => c.last_run?.status === "failed").length,
    sites: (() => {
      const m = {};
      caps.forEach(c => { m[c.target_site] = (m[c.target_site] || 0) + 1; });
      return Object.entries(m).map(([domain, count]) => ({ domain, count })).sort((a, b) => b.count - a.count);
    })(),
  };

  // Keyboard shortcuts
  useEffect(() => {
    const h = (e) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key === "n") { e.preventDefault(); setShowWizard(true); }
      else if (meta && e.key === ",") { e.preventDefault(); setShowSettings(true); }
      else if (meta && e.key === "r" && route.name === "detail") { e.preventDefault(); runCap(currentCap()); }
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  });

  function currentCap() {
    if (route.name !== "detail") return null;
    return caps.find(c => c.name === route.name_) || caps.find(c => c.name === route.cap);
  }

  const openDetail = (cap) => setRoute({ name: "detail", cap: cap.name });
  const detailCap = route.name === "detail" ? caps.find(c => c.name === route.cap) : null;

  // Simulated run
  function runCap(cap) {
    if (!cap || runState[cap.name]?.running) return;
    const total = cap.steps;
    const id = "t-" + Date.now() + "-" + cap.name;
    const repaired = cap.last_run?.status === "repaired";
    const willFail = cap.name === "download-invoice"; // demo: this one fails
    const stepIntents = (cap.step_list || []).map(s => `${s.action} '${s.intent.split('—')[0].trim()}'`);

    setRunState(s => ({ ...s, [cap.name]: { running: true, step: 0 } }));
    setToasts(t => [{ id, cap: cap.name, name: cap.name, state: "running", step: 0, total, intent: "starting…" }, ...t]);

    let step = 0;
    const tick = () => {
      step++;
      const intent = stepIntents[step - 1] || `step ${step}`;
      setRunState(s => ({ ...s, [cap.name]: { running: true, step } }));
      setToasts(ts => ts.map(t => t.id === id ? { ...t, step, intent } : t));

      if (willFail && step === Math.min(6, total)) {
        // Fail
        setTimeout(() => {
          setRunState(s => ({ ...s, [cap.name]: { running: false, step: 0 } }));
          setToasts(ts => ts.map(t => t.id === id ? { ...t, state: "fail", reason: "Could not locate \"Download invoice\" button (drift)." } : t));
          setCaps(cs => cs.map(c => c.name === cap.name ? { ...c, last_run: { at: new Date().toISOString(), status: "failed", duration_ms: 8420, reason: "Could not locate \"Download invoice\" button (drift)" } } : c));
        }, 600);
        return;
      }

      if (step < total) {
        setTimeout(tick, 380 + Math.random() * 350);
      } else {
        setTimeout(() => {
          setRunState(s => ({ ...s, [cap.name]: { running: false, step: 0 } }));
          const dur = 3000 + Math.floor(Math.random() * 2500);
          const finalStatus = repaired ? "repaired" : "success";
          setToasts(ts => ts.map(t => t.id === id ? { ...t, state: "success", duration: dur, repaired } : t));
          setCaps(cs => cs.map(c => c.name === cap.name ? { ...c, last_run: { at: new Date().toISOString(), status: finalStatus, duration_ms: dur } } : c));
        }, 500);
      }
    };
    setTimeout(tick, 600);
  }

  function dismissToast(id) { setToasts(ts => ts.filter(t => t.id !== id)); }
  function viewToastDetail(name) {
    const cap = caps.find(c => c.name === name);
    if (cap) openDetail(cap);
  }

  function deleteCap(cap) {
    setCaps(cs => cs.filter(c => c.name !== cap.name));
    setConfirmDelete(null);
    if (route.name === "detail" && route.cap === cap.name) {
      setRoute({ name: "library", filter: "all" });
    }
  }
  function renameCap(from, to) {
    if (!to || from === to) return;
    setCaps(cs => cs.map(c => c.name === from ? { ...c, name: to } : c));
    if (route.name === "detail" && route.cap === from) setRoute({ name: "detail", cap: to });
  }

  function openCtx(cap, x, y) {
    setCtxMenu({
      x, y, items: [
        { label: "Open", icon: "external", onClick: () => openDetail(cap) },
        { label: "Run", icon: "play", kbd: "⌘R", onClick: () => runCap(cap) },
        "sep",
        { label: "Rename", icon: "pencil", onClick: () => openDetail(cap) },
        { label: "Duplicate", icon: "duplicate", onClick: () => {} },
        { label: "Reveal in Finder", icon: "reveal", onClick: () => {} },
        "sep",
        { label: "Delete", icon: "trash", danger: true, kbd: "⌘⌫", onClick: () => setConfirmDelete(cap) },
      ]
    });
  }

  // Activity for status bar
  const runningNames = Object.keys(runState).filter(n => runState[n].running);
  const activity = runningNames.length > 0
    ? { active: true, label: `replaying ${runningNames[0]}…` + (runningNames.length > 1 ? ` (+${runningNames.length - 1})` : "") }
    : appState === "error" ? { active: false, label: "error" } : { active: false, label: "idle" };

  // ---- Demo controls (top-right floating, not Tweaks) ----
  function setStateDemo(s) {
    setAppState(s);
    if (s === "empty") setCaps([]);
    else if (s === "loaded" || s === "loading") setCaps(window.MOCK.seed);
  }

  return (
    <WindowFrame title="Purroxy">
      <div className={"app" + (sidebarCollapsed ? " sidebar-collapsed" : "")}>
        <Sidebar
          collapsed={sidebarCollapsed}
          route={route}
          setRoute={setRoute}
          counts={counts}
          onToggle={() => setSidebarCollapsed(c => !c)}
        />
        <div className="main">
          <Header
            route={route}
            setRoute={setRoute}
            current={detailCap}
            onNewRecording={() => setShowWizard(true)}
            onOpenSettings={() => setShowSettings(true)}
          />

          {appState === "loading" && <LoadingState />}
          {appState === "error" && <ErrorState path={window.MOCK.settings.library_path} onOpenSettings={() => setShowSettings(true)} />}
          {appState === "loaded" && route.name === "library" && (
            <LibraryView
              caps={caps}
              route={route}
              runState={runState}
              onOpen={openDetail}
              onRun={runCap}
              onContext={openCtx}
              onNew={() => setShowWizard(true)}
              sort={sort}
              setSort={setSort}
            />
          )}
          {appState === "loaded" && route.name === "detail" && detailCap && (
            <DetailView
              cap={detailCap}
              onBack={() => setRoute({ name: "library", filter: "all" })}
              onRun={runCap}
              onDelete={(c) => setConfirmDelete(c)}
              onRename={renameCap}
              isRunning={runState[detailCap.name]?.running}
              runStep={runState[detailCap.name]?.step}
            />
          )}
          {appState === "empty" && (
            <div className="content"><div className="content-inner"><EmptyState onNew={() => setShowWizard(true)} /></div></div>
          )}
        </div>

        <ToastStack toasts={toasts} onDismiss={dismissToast} onView={viewToastDetail} />

        {showLog && <LogDrawer lines={window.MOCK.log_lines} onClose={() => setShowLog(false)} />}
      </div>

      <StatusBar
        libraryPath={window.MOCK.settings.library_path}
        activity={activity}
        onToggleLog={() => setShowLog(o => !o)}
        logOpen={showLog}
      />

      {showWizard && <NewRecordingWizard
        onClose={() => setShowWizard(false)}
        onSaved={(summary, runNow) => {
          setShowWizard(false);
          const newCap = {
            name: summary.name,
            target_site: summary.target,
            steps: summary.steps,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            dir: window.MOCK.settings.library_path + "/" + summary.name,
            capability_id: "cap_" + Math.random().toString(16).slice(2, 12),
            last_run: null,
          };
          setCaps(cs => [newCap, ...cs]);
          if (runNow) setTimeout(() => runCap(newCap), 200);
        }}
      />}

      {showSettings && <SettingsSheet
        settings={window.MOCK.settings}
        onClose={() => setShowSettings(false)}
      />}

      {confirmDelete && <ConfirmModal
        title={`Delete ${confirmDelete.name}?`}
        body={`This permanently removes the recording and all its captured steps. This can't be undone.`}
        mono={confirmDelete.dir}
        confirmLabel="Delete"
        onConfirm={() => deleteCap(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />}

      {ctxMenu && <ContextMenu x={ctxMenu.x} y={ctxMenu.y} items={ctxMenu.items} onClose={() => setCtxMenu(null)} />}

      {/* Demo state switcher (small floating chip — for stakeholder review) */}
      <DemoSwitcher current={appState} onChange={setStateDemo} />
    </WindowFrame>
  );
}

// Floating chip in bottom-left of viewport for swapping between empty/loaded/loading/error states.
function DemoSwitcher({ current, onChange }) {
  const states = ["loaded", "empty", "error", "loading"];
  return (
    <div style={{
      position: "fixed", bottom: 14, left: 14, zIndex: 200,
      display: "flex", gap: 4, padding: 4,
      background: "rgba(20,20,24,0.85)", border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: 8, backdropFilter: "blur(8px)",
      fontSize: 11, fontFamily: "var(--font-mono)", color: "rgba(255,255,255,0.6)"
    }}>
      <span style={{ padding: "4px 8px", color: "rgba(255,255,255,0.45)" }}>state:</span>
      {states.map(s => (
        <button key={s} onClick={() => onChange(s)} style={{
          background: current === s ? "rgba(255,255,255,0.12)" : "transparent",
          border: 0, padding: "4px 8px", borderRadius: 4,
          color: current === s ? "white" : "rgba(255,255,255,0.6)",
          fontFamily: "inherit", fontSize: "inherit", cursor: "pointer"
        }}>{s}</button>
      ))}
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
