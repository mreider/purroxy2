// Library / Empty / Error / Loading screens

const { useState: useStateL, useEffect: useEffectL, useRef: useRefL, useMemo: useMemoL } = React;

function CapabilityRow({ cap, isRunning, runStep, totalSteps, onOpen, onRun, onContext }) {
  const st = statusOf(cap);
  return (
    <div className={"cap-row" + (isRunning ? " is-running" : "")}
         onClick={(e) => {
           if (e.target.closest(".run-btn-wrap, .cap-row-actions")) return;
           onOpen(cap);
         }}
         onContextMenu={(e) => { e.preventDefault(); onContext(cap, e.clientX, e.clientY); }}>
      <div className="cap-favicon">{siteInitials(cap.target_site)}</div>
      <div className="cap-body">
        <div className="cap-name">{cap.name}</div>
        <div className="cap-meta">
          <span className="domain">{cap.target_site}</span>
          <span className="dot">·</span>
          <span>{cap.steps} steps</span>
          <span className="dot">·</span>
          <span className="last-run">
            <span className={"status-dot status-" + st.kind}></span>
            <span>{st.text}</span>
          </span>
          {cap.last_run?.status === "failed" && cap.last_run.reason && (
            <>
              <span className="dot">·</span>
              <span className="pill fail" title={cap.last_run.reason}>drift</span>
            </>
          )}
          {cap.last_run?.status === "repaired" && (
            <>
              <span className="dot">·</span>
              <span className="pill warn">repaired</span>
            </>
          )}
        </div>
      </div>

      <div className="cap-row-actions">
        <button className="icon-btn" title="More…" onClick={(e) => { e.stopPropagation(); onContext(cap, e.clientX, e.clientY); }}>
          <Icon name="more" />
        </button>
      </div>

      <div className="run-btn-wrap">
        {isRunning ? (
          <button className="btn" disabled>
            <span className="spinner"></span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-12)" }}>{runStep}/{totalSteps}</span>
          </button>
        ) : (
          <button className="btn btn-primary" onClick={(e) => { e.stopPropagation(); onRun(cap); }} title="Run (⌘R)">
            <Icon name="play" size={11} />
            Run
          </button>
        )}
      </div>
    </div>
  );
}

function LibraryView({ caps, route, runState, onOpen, onRun, onContext, onNew, sort, setSort }) {
  // Apply filter
  const filtered = useMemoL(() => {
    let r = caps;
    if (route.filter === "recent") {
      r = [...r].filter(c => c.last_run).sort((a, b) =>
        new Date(b.last_run.at) - new Date(a.last_run.at)).slice(0, 6);
    } else if (route.filter === "failed") {
      r = r.filter(c => c.last_run?.status === "failed");
    } else if (route.filter?.startsWith("site:")) {
      const site = route.filter.slice(5);
      r = r.filter(c => c.target_site === site);
    }
    // Sort
    if (sort === "recent") {
      r = [...r].sort((a, b) => {
        const at = a.last_run ? new Date(a.last_run.at).getTime() : 0;
        const bt = b.last_run ? new Date(b.last_run.at).getTime() : 0;
        return bt - at;
      });
    } else if (sort === "name") {
      r = [...r].sort((a, b) => a.name.localeCompare(b.name));
    } else if (sort === "created") {
      r = [...r].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }
    return r;
  }, [caps, route.filter, sort]);

  const titleMap = {
    "all":    { t: "All recordings", s: "Run a saved automation, or record a new one." },
    "recent": { t: "Recent",         s: "Last six runs across the library." },
    "failed": { t: "Needs attention", s: "Recordings whose last run failed." },
  };
  const heading = route.filter?.startsWith("site:")
    ? { t: route.filter.slice(5), s: "Recordings targeting this site." }
    : (titleMap[route.filter] || titleMap.all);

  return (
    <div className="content">
      <div className="content-inner">
        <div className="section-bar">
          <div>
            <div className="section-title">{heading.t}</div>
            <div style={{ fontSize: "var(--fs-13)", color: "var(--fg-subtle)", marginTop: 4 }}>
              {heading.s}
            </div>
          </div>
          <div className="section-tools">
            <span className="section-count">{filtered.length} recording{filtered.length === 1 ? "" : "s"}</span>
            <select className="sort-btn" value={sort} onChange={(e) => setSort(e.target.value)} style={{ background: "transparent", border: 0, cursor: "pointer" }}>
              <option value="recent">Recent first</option>
              <option value="name">Name (A-Z)</option>
              <option value="created">Newest</option>
            </select>
          </div>
        </div>

        {filtered.length === 0 && route.filter === "all" && (
          <EmptyState onNew={onNew} />
        )}

        {filtered.length === 0 && route.filter !== "all" && (
          <div style={{ padding: "60px 20px", textAlign: "center", color: "var(--fg-subtle)", fontSize: "var(--fs-14)" }}>
            No recordings match this filter.
          </div>
        )}

        {filtered.length > 0 && (
          <div className="cap-list">
            {filtered.map(c => (
              <CapabilityRow
                key={c.name}
                cap={c}
                isRunning={runState[c.name]?.running}
                runStep={runState[c.name]?.step}
                totalSteps={c.steps}
                onOpen={onOpen}
                onRun={onRun}
                onContext={onContext}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState({ onNew }) {
  return (
    <div className="empty-state">
      <div className="empty-state-art"><img src="brand/icon-192.png" alt="" /></div>
      <h2>No recordings yet.</h2>
      <p>Record yourself clicking through a website once. Purroxy replays it later — and repairs small drifts when the page changes.</p>
      <div className="empty-state-actions">
        <button className="btn btn-primary btn-lg" onClick={onNew}>
          <Icon name="plus" /> Record your first automation
          <span className="kbd-hint">⌘N</span>
        </button>
      </div>
      <a className="empty-state-link">Read the getting-started guide →</a>
    </div>
  );
}

function ErrorState({ path, error, onOpenSettings }) {
  return (
    <div className="content">
      <div className="content-inner">
        <div className="section-bar">
          <div className="section-title">Library unavailable</div>
        </div>
        <div className="error-card">
          <div className="error-card-head">
            <div className="error-icon"><Icon name="alert" /></div>
            <div style={{ flex: 1 }}>
              <h3>Couldn't read your library directory.</h3>
              <p>Check that the folder exists and that Purroxy has permission to access it. You can change the location in Settings.</p>
            </div>
          </div>
          <div className="path-block" title={path}>{path}</div>
          <div className="path-block" style={{ color: "var(--status-fail)" }}>OS error 13: Permission denied (os error 13)</div>
          <div className="error-card-actions">
            <button className="btn btn-primary" onClick={onOpenSettings}>
              <Icon name="settings" /> Open Settings
            </button>
            <button className="btn">Retry</button>
            <button className="btn btn-ghost"><Icon name="copy" /> Copy error</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="content">
      <div className="content-inner">
        <div className="section-bar">
          <div className="skeleton-block" style={{ width: 180, height: 22 }}></div>
        </div>
        <div className="cap-list">
          {[0,1,2,3].map(i => (
            <div className="skeleton-row" key={i}>
              <div className="skeleton-block" style={{ width: 32, height: 32 }}></div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div className="skeleton-block" style={{ width: 140 + i * 30, height: 14 }}></div>
                <div className="skeleton-block" style={{ width: 240, height: 11 }}></div>
              </div>
              <div className="skeleton-block" style={{ width: 56, height: 28, borderRadius: 5 }}></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { LibraryView, EmptyState, ErrorState, LoadingState, CapabilityRow });
