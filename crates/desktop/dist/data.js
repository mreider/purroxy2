// Mock data + IPC simulation — emulates Tauri commands and events.

window.MOCK = (function() {
  const now = Date.now();
  const min = 60_000, hour = 3_600_000, day = 86_400_000;

  const seed = [
    {
      name: "login-flow",
      target_site: "example.com",
      steps: 6,
      created_at: new Date(now - 14 * day).toISOString(),
      updated_at: new Date(now - 2 * min).toISOString(),
      dir: "/Users/op/Library/Application Support/Purroxy/recordings/login-flow",
      capability_id: "cap_8f3a92b7c4",
      last_run: { at: new Date(now - 2 * min).toISOString(), status: "success", duration_ms: 4180 },
      step_list: [
        { idx: 1, action: "navigate", role: "page", intent: "https://example.com/login", duration_ms: 740 },
        { idx: 2, action: "click",    role: "link",     intent: "Sign in",                 duration_ms: 420 },
        { idx: 3, action: "type",     role: "textbox",  intent: "Email — paul@garrity.co", duration_ms: 380 },
        { idx: 4, action: "type",     role: "textbox",  intent: "Password — •••••••",       duration_ms: 410, vault: true },
        { idx: 5, action: "click",    role: "button",   intent: "Continue",                duration_ms: 1010, repaired: false },
        { idx: 6, action: "wait",     role: "page",     intent: "dashboard loaded",        duration_ms: 1220 },
      ],
    },
    {
      name: "download-invoice",
      target_site: "acme.app",
      steps: 12,
      created_at: new Date(now - 6 * day).toISOString(),
      updated_at: new Date(now - 3 * hour).toISOString(),
      dir: "/Users/op/Library/Application Support/Purroxy/recordings/download-invoice",
      capability_id: "cap_b14d7e9a02",
      last_run: { at: new Date(now - 3 * hour).toISOString(), status: "failed", duration_ms: 8420, reason: "Could not locate \"Download invoice\" button (drift)" },
      step_list: [
        { idx: 1,  action: "navigate", role: "page",    intent: "https://acme.app/billing", duration_ms: 980 },
        { idx: 2,  action: "click",    role: "tab",     intent: "Invoices",                 duration_ms: 360 },
        { idx: 3,  action: "click",    role: "button",  intent: "Filter by month",          duration_ms: 410 },
        { idx: 4,  action: "select",   role: "combobox",intent: "October 2026",             duration_ms: 280 },
        { idx: 5,  action: "click",    role: "row",     intent: "INV-2089 — $4,210.00",     duration_ms: 540, repaired: true },
        { idx: 6,  action: "click",    role: "button",  intent: "Download invoice",         duration_ms: 0, failed: true },
      ],
    },
    {
      name: "dmv-plate-lookup",
      target_site: "ohbmv.gov",
      steps: 9,
      created_at: new Date(now - 28 * day).toISOString(),
      updated_at: new Date(now - 6 * hour).toISOString(),
      dir: "/Users/op/Library/Application Support/Purroxy/recordings/dmv-plate-lookup",
      capability_id: "cap_4c92ba701f",
      last_run: { at: new Date(now - 6 * hour).toISOString(), status: "repaired", duration_ms: 5230 },
      step_list: [
        { idx: 1, action: "navigate", role: "page",    intent: "https://ohbmv.gov/lookup",  duration_ms: 820 },
        { idx: 2, action: "click",    role: "button",  intent: "License plate search",      duration_ms: 320 },
        { idx: 3, action: "type",     role: "textbox", intent: "Plate — {{plate}}",         duration_ms: 290, param: true },
        { idx: 4, action: "click",    role: "button",  intent: "Search",                    duration_ms: 1180, repaired: true },
        { idx: 5, action: "wait",     role: "page",    intent: "results loaded",            duration_ms: 940 },
        { idx: 6, action: "extract",  role: "table",   intent: "Owner record",              duration_ms: 410 },
      ],
    },
    {
      name: "yahoo-mail-search",
      target_site: "mail.yahoo.com",
      steps: 7,
      created_at: new Date(now - 9 * day).toISOString(),
      updated_at: new Date(now - 1 * day).toISOString(),
      dir: "/Users/op/Library/Application Support/Purroxy/recordings/yahoo-mail-search",
      capability_id: "cap_7d3e2f4912",
      last_run: { at: new Date(now - 1 * day).toISOString(), status: "success", duration_ms: 3210 },
    },
    {
      name: "chase-statement-export",
      target_site: "chase.com",
      steps: 14,
      created_at: new Date(now - 4 * day).toISOString(),
      updated_at: new Date(now - 4 * day).toISOString(),
      dir: "/Users/op/Library/Application Support/Purroxy/recordings/chase-statement-export",
      capability_id: "cap_a92b14fe87",
      last_run: null, // never run
    },
    {
      name: "twilio-usage-csv",
      target_site: "console.twilio.com",
      steps: 5,
      created_at: new Date(now - 11 * hour).toISOString(),
      updated_at: new Date(now - 11 * hour).toISOString(),
      dir: "/Users/op/Library/Application Support/Purroxy/recordings/twilio-usage-csv",
      capability_id: "cap_2bc89e1f4d",
      last_run: { at: new Date(now - 11 * hour).toISOString(), status: "success", duration_ms: 2890 },
    },
  ];

  const settings = {
    library_path: "/Users/op/Library/Application Support/Purroxy/recordings",
    chrome_path: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    component_path: "/Users/op/Library/Application Support/Purroxy/components/repair.wasm",
    appearance: "system",
  };

  const log_lines = [
    { ts: "12:08:02.481", lvl: "info",  msg: "purroxy desktop starting (v0.4.2)" },
    { ts: "12:08:02.510", lvl: "info",  msg: "library: " + settings.library_path },
    { ts: "12:08:02.611", lvl: "ok",    msg: "loaded 6 capabilities" },
    { ts: "12:08:14.220", lvl: "info",  msg: "replay login-flow start" },
    { ts: "12:08:18.404", lvl: "ok",    msg: "replay login-flow done in 4.18s" },
    { ts: "12:34:01.118", lvl: "info",  msg: "replay download-invoice start" },
    { ts: "12:34:09.539", lvl: "warn",  msg: "step 5 — repaired (score 0.91)" },
    { ts: "12:34:11.001", lvl: "error", msg: "step 6 — could not locate \"Download invoice\" button" },
    { ts: "12:34:11.002", lvl: "error", msg: "replay download-invoice failed (drift)" },
  ];

  return { seed, settings, log_lines };
})();
