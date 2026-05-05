// New-recording wizard (3 steps + edge states)

const { useState: useStateW, useEffect: useEffectW } = React;

function slugify(s) {
  return s.toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 40);
}

function NewRecordingWizard({ onClose, onSaved }) {
  const [step, setStep] = useStateW(1);
  const [name, setName] = useStateW("");
  const [url, setUrl] = useStateW("");
  const [confirmHttp, setConfirmHttp] = useStateW(false);
  const [confirmDiscard, setConfirmDiscard] = useStateW(false);
  const [confirmEmpty, setConfirmEmpty] = useStateW(false);
  const [steps, setSteps] = useStateW([]);
  const [edge, setEdge] = useStateW(null); // 'crash' | null
  const [savedSummary, setSavedSummary] = useStateW(null);

  const slug = slugify(name);
  const isHttp = url && /^http:\/\//i.test(url);
  const isHttps = url && /^https:\/\//i.test(url);
  const canSubmit1 = slug.length >= 2 && url && (isHttps || isHttp);

  // Simulated step capture during step 2
  useEffectW(() => {
    if (step !== 2) return;
    let i = 0;
    const seq = [
      { action: "navigate", intent: url || "https://example.com" },
      { action: "click",    intent: "link 'Sign in'" },
      { action: "type",     intent: "textbox 'Email'" },
      { action: "type",     intent: "textbox 'Password'" },
      { action: "click",    intent: "button 'Continue'" },
      { action: "wait",     intent: "page 'Dashboard'" },
    ];
    const t = setInterval(() => {
      if (i >= seq.length) { clearInterval(t); return; }
      const now = new Date();
      const time = String(now.getHours()).padStart(2,"0") + ":" + String(now.getMinutes()).padStart(2,"0") + ":" + String(now.getSeconds()).padStart(2,"0");
      setSteps(s => [{ ...seq[i], idx: s.length + 1, time }, ...s]);
      i++;
    }, 1100);
    return () => clearInterval(t);
  }, [step, url]);

  // Esc closes wizard (per accessibility rules)
  useEffectW(() => {
    const h = (e) => { if (e.key === "Escape" && !confirmDiscard && !confirmEmpty) onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose, confirmDiscard, confirmEmpty]);

  function startRecording() {
    if (isHttp && !confirmHttp) { setConfirmHttp(true); return; }
    setStep(2);
  }
  function stopAndSave() {
    if (steps.length === 0) { setConfirmEmpty(true); return; }
    setSavedSummary({ name: slug, steps: steps.length, target: new URL(url).hostname });
    setStep(3);
  }
  function discard() {
    onClose();
  }

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && step !== 2) onClose(); }}>
      <div className="modal wizard">
        {/* Step indicator */}
        <div className="wizard-steps">
          <div className={"wizard-step" + (step === 1 ? " is-active" : step > 1 ? " is-done" : "")}>
            <span className="dot">{step > 1 ? "✓" : "1"}</span> Setup
          </div>
          <span className="line"></span>
          <div className={"wizard-step" + (step === 2 ? " is-active" : step > 2 ? " is-done" : "")}>
            <span className="dot">{step > 2 ? "✓" : "2"}</span> Record
          </div>
          <span className="line"></span>
          <div className={"wizard-step" + (step === 3 ? " is-active" : "")}>
            <span className="dot">3</span> Save
          </div>
        </div>

        {step === 1 && (
          <>
            <div className="modal-head">
              <div className="modal-title">New recording</div>
              <div className="modal-subtitle">Give it a name and the URL where you'll start. We'll spawn a Chrome window when you click Start.</div>
            </div>
            <div className="modal-body">
              <div className="field">
                <label className="field-label">Name</label>
                <input className="input" autoFocus placeholder="e.g. download-invoice"
                       value={name} onChange={(e) => setName(e.target.value)} />
                <div className="field-hint mono">slug: <span style={{ color: "var(--fg)" }}>{slug || "—"}</span></div>
              </div>
              <div className="field">
                <label className="field-label">Starting URL</label>
                <input className="input input-mono" placeholder="https://example.com/login"
                       value={url} onChange={(e) => { setUrl(e.target.value); setConfirmHttp(false); }} />
                {isHttp && (
                  <div className="field-hint warn">
                    {confirmHttp ? "⚠ Continuing with insecure http:// — credentials may be exposed." : "⚠ http:// is insecure. Click Start again to confirm."}
                  </div>
                )}
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn" onClick={onClose}>Cancel <span className="kbd-hint">esc</span></button>
              <button className="btn btn-primary" disabled={!canSubmit1} onClick={startRecording}>
                <Icon name="zap" size={12} /> Start recording <span className="kbd-hint">⏎</span>
              </button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div className="modal-head">
              <div className="modal-title">Recording in Chrome</div>
              <div className="modal-subtitle">Switch to the Chrome window we just opened. Click through your task. We'll capture each step.</div>
            </div>
            <div className="modal-body">
              <div className="rec-monitor">
                <div className="rec-status-card">
                  <div className="rec-pulse"></div>
                  <div className="rec-status-text">
                    <div className="label">Last action</div>
                    <div className="last">{steps[0] ? steps[0].action + " · " + steps[0].intent : "waiting for first action…"}</div>
                  </div>
                  <div className="rec-counter">{String(steps.length).padStart(2, "0")}</div>
                </div>

                {edge === "crash" && (
                  <div className="error-card" style={{ marginTop: 0 }}>
                    <div className="error-card-head">
                      <div className="error-icon"><Icon name="alert" /></div>
                      <div style={{ flex: 1 }}>
                        <h3>Recorder process crashed.</h3>
                        <p>The Chrome window exited unexpectedly. You can keep the {steps.length} step{steps.length === 1 ? "" : "s"} captured so far, or discard.</p>
                      </div>
                    </div>
                    <div className="error-card-actions">
                      <button className="btn btn-primary" onClick={stopAndSave} disabled={steps.length === 0}>Save partial recording</button>
                      <button className="btn" onClick={onClose}>Discard</button>
                    </div>
                  </div>
                )}

                <div className="rec-steps-feed">
                  {steps.length === 0 && (
                    <div style={{ padding: "20px", textAlign: "center", color: "var(--fg-subtle)", fontSize: "var(--fs-13)" }}>
                      No steps yet. Interact with the Chrome window to begin.
                    </div>
                  )}
                  {steps.map(s => (
                    <div className="rec-step" key={s.idx}>
                      <span className="step-no">#{String(s.idx).padStart(2, "0")}</span>
                      <span className="step-action">{s.action}</span>
                      <span className="step-intent">{s.intent}</span>
                      <span className="step-time">{s.time}</span>
                    </div>
                  ))}
                </div>

                <div style={{ fontSize: "var(--fs-12)", color: "var(--fg-subtle)" }}>
                  Tip: closing the Chrome window auto-finalizes the recording.
                </div>
              </div>
            </div>
            <div className="modal-foot">
              <div className="left">
                <button className="btn btn-ghost" style={{ color: "var(--status-fail)" }} onClick={() => setConfirmDiscard(true)}>
                  <Icon name="trash" /> Discard
                </button>
              </div>
              <button className="btn" onClick={() => setEdge(edge === "crash" ? null : "crash")} style={{ opacity: 0.6 }} title="Demo: simulate crash">⚠ simulate crash</button>
              <button className="btn btn-primary" onClick={stopAndSave}>
                <Icon name="stop" size={10} /> Stop &amp; save <span className="kbd-hint">⏎</span>
              </button>
            </div>
          </>
        )}

        {step === 3 && savedSummary && (
          <>
            <div className="modal-head">
              <div className="modal-title">Saved <span style={{ fontFamily: "var(--font-mono)", color: "var(--accent)" }}>{savedSummary.name}</span></div>
              <div className="modal-subtitle">Captured {savedSummary.steps} steps on {savedSummary.target}. Run it now to verify it works.</div>
            </div>
            <div className="modal-body">
              <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "8px 16px", fontSize: "var(--fs-13)" }}>
                <span style={{ color: "var(--fg-subtle)" }}>Steps</span>
                <span style={{ fontFamily: "var(--font-mono)" }}>{savedSummary.steps}</span>
                <span style={{ color: "var(--fg-subtle)" }}>Target</span>
                <span style={{ fontFamily: "var(--font-mono)" }}>{savedSummary.target}</span>
                <span style={{ color: "var(--fg-subtle)" }}>Saved at</span>
                <span style={{ fontFamily: "var(--font-mono)" }}>{new Date().toLocaleTimeString()}</span>
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn" onClick={() => onSaved(savedSummary, false)}>Done</button>
              <button className="btn btn-primary" onClick={() => onSaved(savedSummary, true)}>
                <Icon name="play" size={10} /> Run now <span className="kbd-hint">⏎</span>
              </button>
            </div>
          </>
        )}

        {confirmDiscard && (
          <ConfirmModal
            title="Discard recording?"
            body={`Discarding will lose the ${steps.length} step${steps.length === 1 ? "" : "s"} captured so far. This can't be undone.`}
            confirmLabel="Discard"
            onConfirm={discard}
            onCancel={() => setConfirmDiscard(false)}
          />
        )}
        {confirmEmpty && (
          <ConfirmModal
            title="Save empty recording?"
            body="No steps were captured. You can save anyway as a stub, or discard."
            confirmLabel="Discard"
            onConfirm={() => { setConfirmEmpty(false); discard(); }}
            onCancel={() => setConfirmEmpty(false)}
          />
        )}
      </div>
    </div>
  );
}

window.NewRecordingWizard = NewRecordingWizard;
