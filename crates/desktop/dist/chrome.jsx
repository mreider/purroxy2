// Shared UI primitives — chrome (window, sidebar, header, statusbar) + small bits.

const { useState, useEffect, useRef, useCallback, useMemo } = React;

// --- helpers ---------------------------------------------------------------
function relTime(iso) {
  if (!iso) return "never";
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 30) return "just now";
  if (d < 60) return Math.floor(d) + "s ago";
  if (d < 3600) return Math.floor(d / 60) + "m ago";
  if (d < 86400) return Math.floor(d / 3600) + "h ago";
  if (d < 86400 * 2) return "yesterday";
  if (d < 86400 * 7) return Math.floor(d / 86400) + "d ago";
  return new Date(iso).toLocaleDateString();
}
function fmtDuration(ms) {
  if (ms == null) return "—";
  if (ms < 1000) return ms + "ms";
  return (ms / 1000).toFixed(2) + "s";
}
function siteInitials(domain) {
  if (!domain) return "·";
  const t = domain.replace(/^www\./, "").split(".")[0];
  return t.slice(0, 2).toUpperCase();
}
function statusOf(c) {
  if (!c.last_run) return { kind: "neutral", label: "never run", text: "never run" };
  const s = c.last_run.status;
  if (s === "success")  return { kind: "success", label: "success",  text: "succeeded " + relTime(c.last_run.at) };
  if (s === "repaired") return { kind: "warn",    label: "repaired", text: "repaired " + relTime(c.last_run.at) };
  if (s === "failed")   return { kind: "fail",    label: "failed",   text: "failed " + relTime(c.last_run.at) };
  return { kind: "neutral", label: s, text: s };
}
function truncMid(s, max) {
  if (s.length <= max) return s;
  const keep = max - 1;
  return s.slice(0, Math.ceil(keep / 2)) + "…" + s.slice(s.length - Math.floor(keep / 2));
}

// --- Window / chrome -------------------------------------------------------
function WindowFrame({ children, title = "Purroxy" }) {
  return (
    <div className="viewport">
      <div className="window">
        <div className="titlebar">
          <div className="titlebar-controls">
            <span></span><span></span><span></span>
          </div>
          <div className="titlebar-title">{title}</div>
          <div style={{ width: 52 }}></div>
        </div>
        {children}
      </div>
    </div>
  );
}

// --- Sidebar ---------------------------------------------------------------
function Sidebar({ collapsed, route, setRoute, counts, onToggle }) {
  const Item = ({ to, icon, children, count, active }) => (
    <button
      className={"sidebar-link" + (active ? " is-active" : "")}
      onClick={() => setRoute(to)}
      title={collapsed ? children : undefined}
    >
      <Icon name={icon} />
      <span>{children}</span>
      {count != null && <span className="count">{count}</span>}
    </button>
  );

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="sidebar-brand-mark">
          <img src="brand/icon-192.png" alt="" />
        </div>
        {!collapsed && (
          <div className="sidebar-brand-text">
            <div className="sidebar-brand-name">Purroxy</div>
            <div className="sidebar-brand-tag">v0.4.2 · local</div>
          </div>
        )}
      </div>

      <div className="sidebar-section">
        <Item to={{ name: "library", filter: "all"    }} icon="library" count={counts.all}    active={route.name === "library" && route.filter === "all"}>All recordings</Item>
        <Item to={{ name: "library", filter: "recent" }} icon="recent"  count={counts.recent} active={route.name === "library" && route.filter === "recent"}>Recent</Item>
        <Item to={{ name: "library", filter: "failed" }} icon="failed"  count={counts.failed} active={route.name === "library" && route.filter === "failed"}>Needs attention</Item>
      </div>

      {!collapsed && <div className="sidebar-section-label">Sites</div>}
      <div className="sidebar-section">
        {counts.sites.slice(0, 4).map(s => (
          <Item key={s.domain} to={{ name: "library", filter: "site:" + s.domain }} icon="globe" count={s.count}
                active={route.name === "library" && route.filter === "site:" + s.domain}>
            {s.domain}
          </Item>
        ))}
      </div>

      <div className="sidebar-spacer"></div>

      <div className="sidebar-footer">
        <button className="sidebar-link" onClick={onToggle} title="Collapse sidebar">
          <Icon name="sidebar" />
          <span>Collapse</span>
        </button>
      </div>
    </aside>
  );
}

// --- Header ----------------------------------------------------------------
function Header({ route, setRoute, onNewRecording, onImport, onOpenSettings, current }) {
  const isDetail = route.name === "detail";
  return (
    <div className="header">
      {isDetail ? (
        <>
          <button className="header-icon-btn" onClick={() => setRoute({ name: "library", filter: "all" })} title="Back">
            <Icon name="back" />
          </button>
          <div className="header-title">
            <span className="crumb-up" onClick={() => setRoute({ name: "library", filter: "all" })}>Recordings</span>
            <span className="crumb-sep">/</span>
            <span className="crumb-current" style={{ fontFamily: "var(--font-mono)" }}>{current?.name}</span>
          </div>
        </>
      ) : (
        <div className="header-title">Purroxy</div>
      )}

      <div className="header-spacer"></div>

      {!isDetail && (
        <>
          <div className="header-search">
            <Icon name="search" />
            <input placeholder="Search recordings…" />
            <kbd>⌘K</kbd>
          </div>
          {onImport && (
            <button className="btn" onClick={onImport} title="Import .purroxy bundle">
              <Icon name="external" /> Import
            </button>
          )}
          <button className="btn" onClick={onNewRecording}>
            <Icon name="plus" />
            New
            <span className="kbd-hint">⌘N</span>
          </button>
        </>
      )}
      <button className="header-icon-btn" onClick={onOpenSettings} title="Settings (⌘,)">
        <Icon name="settings" />
      </button>
    </div>
  );
}

// --- Status bar ------------------------------------------------------------
function StatusBar({ libraryPath, activity, onToggleLog, logOpen }) {
  return (
    <div className="statusbar">
      <div className="statusbar-left">
        <Icon name="folder" />
        <span>library:</span>
        <span className="statusbar-path" title={libraryPath}>{truncMid(libraryPath, 56)}</span>
      </div>
      <div className="statusbar-spacer"></div>
      <div className={"statusbar-activity" + (activity.active ? " is-active" : "")}>
        <span className="pulse"></span>
        <span>{activity.label}</span>
      </div>
      <button className={"statusbar-log-btn" + (logOpen ? " is-on" : "")} onClick={onToggleLog}>
        <Icon name="log" />
        <span>log</span>
      </button>
    </div>
  );
}

// --- Toast stack -----------------------------------------------------------
function ToastStack({ toasts, onDismiss, onView }) {
  return (
    <div className="toast-stack">
      {toasts.map(t => {
        const cls = "toast" + (t.state === "success" ? " is-success" : t.state === "fail" ? " is-fail" : "");
        return (
          <div className={cls} key={t.id}>
            <div className="toast-head">
              <span className={"status-dot " + (t.state === "success" ? "status-success" : t.state === "fail" ? "status-fail" : t.state === "warn" ? "status-warn" : "status-neutral")}></span>
              <span className="name">{t.name}</span>
              <button className="dismiss" onClick={() => onDismiss(t.id)}><Icon name="close" size={12} /></button>
            </div>
            {t.state === "running" && (
              <>
                <div className="toast-detail">
                  <span className="step-no">Step {t.step}/{t.total}</span> · {t.intent}
                </div>
                <div className="toast-progress"><div className="bar" style={{ width: (100 * t.step / t.total) + "%" }}></div></div>
              </>
            )}
            {t.state === "success" && (
              <>
                <div className="toast-detail">Ran in {fmtDuration(t.duration)}{t.repaired ? " · 1 step repaired" : ""}.</div>
                <div className="toast-actions"><button className="link" onClick={() => onView(t.cap)}>View details →</button></div>
              </>
            )}
            {t.state === "fail" && (
              <>
                <div className="toast-detail">{t.reason}</div>
                <div className="toast-actions"><button className="link" onClick={() => onView(t.cap)}>View details →</button></div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

// --- Log drawer ------------------------------------------------------------
function LogDrawer({ lines, onClose }) {
  return (
    <div className="log-drawer">
      <div className="log-drawer-head">
        <h4>Recent activity</h4>
        <div style={{ flex: 1 }}></div>
        <button className="header-icon-btn" onClick={onClose}><Icon name="close" /></button>
      </div>
      <div className="log-drawer-body">
        {lines.map((l, i) => (
          <div className="log-line" key={i}>
            <span className="ts">{l.ts}</span>
            <span className={"lvl " + l.lvl}>{l.lvl}</span>
            <span className="msg">{l.msg}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Context menu ----------------------------------------------------------
function ContextMenu({ x, y, items, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);
  // Keep within viewport
  const style = { left: x, top: y };
  return (
    <div className="ctx-menu" style={style} ref={ref}>
      {items.map((it, i) => it === "sep"
        ? <div className="ctx-sep" key={i}></div>
        : (
          <div key={i} className={"ctx-item" + (it.danger ? " danger" : "")} onClick={() => { it.onClick?.(); onClose(); }}>
            {it.icon && <span className="icon"><Icon name={it.icon} /></span>}
            <span>{it.label}</span>
            {it.kbd && <span className="kbd kbd-r">{it.kbd}</span>}
          </div>
        )
      )}
    </div>
  );
}

// --- Confirm modal ---------------------------------------------------------
function ConfirmModal({ title, body, confirmLabel = "Delete", danger = true, onConfirm, onCancel, mono }) {
  useEffect(() => {
    const h = (e) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") onConfirm();
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onConfirm, onCancel]);

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="modal" style={{ width: 440 }}>
        <div className="modal-head">
          <div className="modal-title">{title}</div>
        </div>
        <div className="modal-body">
          <div style={{ fontSize: "var(--fs-14)", color: "var(--fg-muted)", lineHeight: 1.5 }}>
            {body}
            {mono && <div style={{ marginTop: 12, fontFamily: "var(--font-mono)", padding: "8px 10px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--fg)" }}>{mono}</div>}
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onCancel}>Cancel <span className="kbd-hint">esc</span></button>
          <button className={"btn " + (danger ? "btn-danger" : "btn-primary")} onClick={onConfirm} autoFocus>{confirmLabel} <span className="kbd-hint">⏎</span></button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, {
  relTime, fmtDuration, siteInitials, statusOf, truncMid,
  WindowFrame, Sidebar, Header, StatusBar,
  ToastStack, LogDrawer, ContextMenu, ConfirmModal,
});
