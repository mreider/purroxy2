import { BrowserWindow, WebContentsView, ipcMain } from 'electron'

let recording = false
let cleanup: (() => void) | null = null

// Injected into every execution context
const CONTEXT_SCRIPT = `
(() => {
  if (window.__purroxyCtx) return;
  window.__purroxyCtx = true;

  function getSelector(el) {
    if (!el || el === document.body || el === document.documentElement) return 'body';
    if (el.id) return '#' + CSS.escape(el.id);
    for (const attr of ['data-testid', 'name', 'aria-label', 'data-cy', 'data-test', 'role']) {
      const val = el.getAttribute(attr);
      if (val) {
        const sel = el.tagName.toLowerCase() + '[' + attr + '="' + CSS.escape(val) + '"]';
        try { if (document.querySelectorAll(sel).length === 1) return sel; } catch {}
      }
    }
    if ((el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') && el.name) {
      const sel = el.tagName.toLowerCase() + '[name="' + CSS.escape(el.name) + '"]';
      try { if (document.querySelectorAll(sel).length === 1) return sel; } catch {}
    }
    const path = [];
    let cur = el;
    while (cur && cur !== document.body && cur.parentElement) {
      let seg = cur.tagName.toLowerCase();
      const parent = cur.parentElement;
      const sibs = Array.from(parent.children).filter(c => c.tagName === cur.tagName);
      if (sibs.length > 1) seg += ':nth-of-type(' + (sibs.indexOf(cur) + 1) + ')';
      path.unshift(seg);
      cur = parent;
    }
    return path.join(' > ');
  }

  function getLabel(el) {
    // Walk up to find a label
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel;
    const title = el.getAttribute('title');
    if (title) return title;
    const placeholder = el.getAttribute('placeholder');
    if (placeholder) return placeholder;
    // Check for associated <label>
    if (el.id) {
      const lbl = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (lbl) return lbl.textContent.trim().slice(0, 80);
    }
    // Check parent label
    const parentLabel = el.closest('label');
    if (parentLabel) return parentLabel.textContent.trim().slice(0, 80);
    // Nearby text
    const text = (el.innerText || el.textContent || '').trim().slice(0, 80);
    if (text) return text;
    return el.tagName.toLowerCase();
  }

  // Get element info at coordinates
  window.__purroxyElementAt = function(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    return {
      selector: getSelector(el),
      tagName: el.tagName.toLowerCase(),
      label: getLabel(el),
      isInput: ['INPUT','TEXTAREA','SELECT'].includes(el.tagName),
      inputType: el.getAttribute && el.getAttribute('type') || '',
      value: el.value || ''
    };
  };

  // Snapshot all form-like values on the page
  // Includes native inputs AND common custom component patterns
  window.__purroxyFormSnapshot = function() {
    const snapshot = {};

    // Native form elements
    document.querySelectorAll('input, textarea, select').forEach(el => {
      const sel = getSelector(el);
      const isPassword = el.type === 'password';
      let val = '';
      if (el.tagName === 'SELECT') {
        val = el.options[el.selectedIndex]?.text || el.value || '';
      } else if (el.type === 'checkbox' || el.type === 'radio') {
        val = el.checked ? 'checked' : 'unchecked';
      } else {
        val = isPassword ? (el.value ? '••••••' : '') : (el.value || '');
      }
      snapshot[sel] = {
        selector: sel,
        tagName: el.tagName.toLowerCase(),
        label: getLabel(el),
        value: val,
        sensitive: isPassword
      };
    });

    // Custom dropdown/select components — look for common SPA patterns
    // Elements with role="listbox", role="combobox", or common class patterns
    document.querySelectorAll('[role="combobox"], [role="listbox"], [data-value], [class*="select"], [class*="dropdown"], [class*="picker"]').forEach(el => {
      const sel = getSelector(el);
      if (snapshot[sel]) return; // Already captured as native
      // Try to read displayed value from inner text or data-value
      const val = el.getAttribute('data-value') ||
                  el.querySelector('[class*="singleValue"], [class*="selected"], [class*="current"]')?.textContent?.trim() ||
                  el.textContent?.trim()?.slice(0, 100) || '';
      if (val) {
        snapshot[sel] = {
          selector: sel,
          tagName: el.tagName.toLowerCase(),
          label: getLabel(el),
          value: val,
          sensitive: false
        };
      }
    });

    return snapshot;
  };

  // Track input completions via blur
  window.__purroxyBlurQueue = window.__purroxyBlurQueue || [];
  document.addEventListener('blur', (e) => {
    const el = e.target;
    if (el && ['INPUT','TEXTAREA','SELECT'].includes(el.tagName)) {
      const isPassword = el.type === 'password';
      window.__purroxyBlurQueue.push({
        selector: getSelector(el),
        tagName: el.tagName.toLowerCase(),
        label: getLabel(el),
        value: isPassword ? '••••••' : (el.value || ''),
        isPassword: isPassword
      });
    }
  }, true);

  // Backup click capture — catches clicks that input-event might miss
  window.__purroxyClickQueue = window.__purroxyClickQueue || [];
  document.addEventListener('mousedown', (e) => {
    const el = e.target.closest('a, button, [role="button"], [role="tab"], [role="menuitem"], [role="link"], [onclick], [class*="btn"], [class*="button"]') || e.target;
    window.__purroxyClickQueue.push({
      selector: getSelector(el),
      tagName: el.tagName.toLowerCase(),
      label: getLabel(el)
    });
  }, true);

  // Debounced scroll tracking — tracks ANY scrollable element, not just window
  window.__purroxyScrollQueue = window.__purroxyScrollQueue || [];
  const scrollState = new WeakMap();
  function onScroll(e) {
    const target = e.target === document ? document.documentElement : e.target;
    if (!target || !target.scrollTop && target.scrollTop !== 0) return;

    let state = scrollState.get(target);
    if (!state) {
      state = { lastTop: target.scrollTop, timer: null };
      scrollState.set(target, state);
    }

    clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      const newTop = target.scrollTop;
      const dist = Math.abs(newTop - state.lastTop);
      if (dist > 50) {
        window.__purroxyScrollQueue.push({
          selector: target === document.documentElement ? 'window' : getSelector(target),
          scrollY: newTop,
          direction: newTop > state.lastTop ? 'down' : 'up',
          distance: dist
        });
        state.lastTop = newTop;
      }
    }, 400);
  }
  document.addEventListener('scroll', onScroll, true);

  // Detect new content loading (infinite scroll, lazy load)
  window.__purroxyContentQueue = window.__purroxyContentQueue || [];
  let contentTimer = null;
  const observer = new MutationObserver((mutations) => {
    let addedCount = 0;
    for (const m of mutations) {
      addedCount += m.addedNodes.length;
    }
    if (addedCount < 3) return; // Ignore tiny DOM changes
    clearTimeout(contentTimer);
    contentTimer = setTimeout(() => {
      window.__purroxyContentQueue.push({
        addedElements: addedCount,
        timestamp: Date.now()
      });
    }, 500);
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
`

export function setupRecorder(mainWindow: BrowserWindow, getSiteView: () => WebContentsView | null) {

  let lastFormSnapshot: Record<string, any> = {}

  async function injectContext(siteView: WebContentsView) {
    try { await siteView.webContents.executeJavaScript(CONTEXT_SCRIPT) } catch {}
  }

  async function getElementAtPoint(siteView: WebContentsView, x: number, y: number) {
    try {
      return await siteView.webContents.executeJavaScript(
        `window.__purroxyElementAt && window.__purroxyElementAt(${x}, ${y})`
      )
    } catch { return null }
  }

  async function takeFormSnapshot(siteView: WebContentsView): Promise<Record<string, any>> {
    try {
      return await siteView.webContents.executeJavaScript(
        `window.__purroxyFormSnapshot && window.__purroxyFormSnapshot()`
      ) || {}
    } catch { return {} }
  }

  // Placeholder values that aren't real user selections
  const PLACEHOLDER_PATTERNS = /^(select|choose|pick|-- ?select|-- ?choose|none|all|placeholder|\s*)$/i

  function isPlaceholder(val: string): boolean {
    return !val || PLACEHOLDER_PATTERNS.test(val.trim())
  }

  async function diffFormState(siteView: WebContentsView) {
    const newSnapshot = await takeFormSnapshot(siteView)
    const changes: any[] = []

    for (const [sel, newField] of Object.entries(newSnapshot)) {
      const oldField = lastFormSnapshot[sel]
      if (isPlaceholder(newField.value)) continue // Skip placeholder values

      if (!oldField) {
        // Only report genuinely new fields if they don't look like defaults
        // Skip — we only care about value CHANGES, not initial discovery
      } else if (oldField.value !== newField.value) {
        // Value actually changed — this is a real user action
        changes.push(newField)
      }
    }

    lastFormSnapshot = newSnapshot
    return changes
  }

  async function drainQueue(siteView: WebContentsView, name: string) {
    try {
      return await siteView.webContents.executeJavaScript(
        `(() => { const q = window.${name} || []; window.${name} = []; return q; })()`
      )
    } catch { return [] }
  }

  ipcMain.handle('recorder:start', async () => {
    const siteView = getSiteView()
    if (!siteView) return false

    if (cleanup) { cleanup(); cleanup = null }

    recording = true
    await injectContext(siteView)

    // Take initial form snapshot
    lastFormSnapshot = await takeFormSnapshot(siteView)

    // Track recently emitted clicks to deduplicate between input-event and backup queue
    let recentClicks: string[] = []

    function emitClick(info: { selector: string; tagName: string; label: string }) {
      const key = info.selector + '|' + info.label
      if (recentClicks.includes(key)) return // Dedup
      recentClicks.push(key)
      setTimeout(() => { recentClicks = recentClicks.filter(k => k !== key) }, 1000)

      mainWindow.webContents.send('recorder:action', {
        type: 'click',
        timestamp: Date.now(),
        selector: info.selector,
        tagName: info.tagName,
        label: info.label
      })

      // After each click, diff form state to catch custom dropdowns
      setTimeout(async () => {
        if (!recording) return
        const changes = await diffFormState(siteView)
        for (const change of changes) {
          mainWindow.webContents.send('recorder:action', {
            type: 'select',
            timestamp: Date.now(),
            selector: change.selector,
            tagName: change.tagName,
            label: change.label,
            value: change.value,
            sensitive: change.sensitive
          })
        }
      }, 600)
    }

    // Primary: Chromium-level input events (mouseDown — element is still present)
    const inputHandler = async (_event: unknown, inputEvent: Electron.Event & { type: string; x?: number; y?: number }) => {
      if (!recording) return
      if (inputEvent.type === 'mouseDown' && (inputEvent as any).x != null) {
        const me = inputEvent as any
        const elInfo = await getElementAtPoint(siteView, me.x, me.y)
        if (elInfo) emitClick(elInfo)
      }
    }
    siteView.webContents.on('input-event' as any, inputHandler)

    // Poll for all queued events
    const pollInterval = setInterval(async () => {
      if (!recording) return

      // Backup click queue (catches clicks input-event missed)
      const clicks = await drainQueue(siteView, '__purroxyClickQueue')
      for (const click of clicks) {
        emitClick(click)
      }

      // Blur queue (native input completions)
      const blurs = await drainQueue(siteView, '__purroxyBlurQueue')
      for (const blur of blurs) {
        if (blur.value) {
          mainWindow.webContents.send('recorder:action', {
            type: 'type',
            timestamp: Date.now(),
            selector: blur.selector,
            tagName: blur.tagName,
            label: blur.label,
            value: blur.value,
            sensitive: blur.isPassword
          })
        }
      }

      // Scroll queue
      const scrolls = await drainQueue(siteView, '__purroxyScrollQueue')
      for (const scroll of scrolls) {
        mainWindow.webContents.send('recorder:action', {
          type: 'scroll',
          timestamp: Date.now(),
          selector: scroll.selector || 'window',
          label: 'Scroll ' + scroll.direction + ' ' + scroll.distance + 'px',
          value: String(scroll.scrollY)
        })
      }

      // Content loaded (infinite scroll / lazy load)
      const contentEvents = await drainQueue(siteView, '__purroxyContentQueue')
      for (const evt of contentEvents) {
        mainWindow.webContents.send('recorder:action', {
          type: 'wait',
          timestamp: Date.now(),
          label: 'Content loaded (' + evt.addedElements + ' elements)',
        })
      }

      // Periodic form diff
      const changes = await diffFormState(siteView)
      for (const change of changes) {
        mainWindow.webContents.send('recorder:action', {
          type: 'select',
          timestamp: Date.now(),
          selector: change.selector,
          tagName: change.tagName,
          label: change.label,
          value: change.value,
          sensitive: change.sensitive
        })
      }
    }, 800)

    // Capture navigation
    const navHandler = (_e: unknown, navUrl: string) => {
      if (!recording) return
      mainWindow.webContents.send('recorder:action', {
        type: 'navigate',
        timestamp: Date.now(),
        url: navUrl,
        label: 'Navigate to page'
      })
    }
    siteView.webContents.on('did-navigate', navHandler as any)
    siteView.webContents.on('did-navigate-in-page', navHandler as any)

    // Re-inject context and re-snapshot on page loads
    const loadHandler = async () => {
      if (!recording) return
      await injectContext(siteView)
      lastFormSnapshot = await takeFormSnapshot(siteView)
    }
    siteView.webContents.on('did-finish-load', loadHandler)
    siteView.webContents.on('did-frame-finish-load', loadHandler as any)

    cleanup = () => {
      clearInterval(pollInterval)
      siteView.webContents.removeListener('input-event' as any, inputHandler)
      siteView.webContents.removeListener('did-navigate', navHandler as any)
      siteView.webContents.removeListener('did-navigate-in-page', navHandler as any)
      siteView.webContents.removeListener('did-finish-load', loadHandler)
      siteView.webContents.removeListener('did-frame-finish-load', loadHandler as any)
    }

    return true
  })

  ipcMain.handle('recorder:stop', async () => {
    recording = false
    if (cleanup) { cleanup(); cleanup = null }
    lastFormSnapshot = {}
    const siteView = getSiteView()
    if (siteView) {
      try { await siteView.webContents.executeJavaScript('window.__purroxyCtx = false;') } catch {}
    }
    return true
  })

  ipcMain.handle('recorder:isRecording', () => {
    return recording
  })
}
