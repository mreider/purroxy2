// Purroxy recording shim. Injected via Page.addScriptToEvaluateOnNewDocument
// into every navigated page. Listens for clicks, input changes, and
// navigation, queues structured event records on `window.__purroxy_events`.
// The host drains the queue periodically via Runtime.evaluate.
//
// PRD §9.1: this shim must not capture credential field VALUES;
// password and otherwise-sensitive inputs are emitted with their
// labels but a redacted value placeholder.

(() => {
  if (window.__purroxy_installed) return;
  window.__purroxy_installed = true;
  window.__purroxy_events = [];

  function emit(record) {
    record.t_event = window.__purroxy_events.length;
    record.url = location.href;
    window.__purroxy_events.push(record);
  }

  function describeTarget(el) {
    if (!el || !el.getAttribute) return { role: 'unknown' };
    const tag = (el.tagName || '').toLowerCase();
    const role = el.getAttribute('role') || tag;
    let name = el.getAttribute('aria-label')
      || el.getAttribute('alt')
      || el.getAttribute('title')
      || el.getAttribute('placeholder')
      || (el.innerText ? el.innerText.slice(0, 200) : null);
    if (typeof name === 'string') name = name.trim();
    const id = el.id || null;
    const className = el.className && typeof el.className === 'string' ? el.className : null;
    return { role, name, id, className };
  }

  document.addEventListener('click', (e) => {
    const t = describeTarget(e.target);
    emit({ kind: 'click', target: t, x: e.clientX, y: e.clientY });
  }, true);

  document.addEventListener('input', (e) => {
    const el = e.target;
    if (!el || typeof el.value !== 'string') return;
    const t = describeTarget(el);
    const sensitive = (el.type === 'password')
      || /password|secret|otp|cvv|ssn/i.test(t.name || '');
    emit({
      kind: 'input',
      target: t,
      value: sensitive ? null : el.value,
      sensitive,
    });
  }, true);

  // Navigation hook: same-document navigations via pushState/replaceState
  // are observed via popstate; full navigations land via the host's
  // Page.frameNavigated CDP event.
  window.addEventListener('popstate', () => {
    emit({ kind: 'navigate', url: location.href });
  });
})();
