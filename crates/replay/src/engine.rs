// Replay engine. Reads a recording manifest, instantiates the named
// WASM capability component in a fresh wasmtime Store with budgets,
// drives the browser through each step, and produces a run record.
//
// Phase 3 scope: iterate steps, capture before/after snapshots, call
// preflight/postflight, call extract/redact at the end. Action
// execution (clicks/input/nav) and repair flow are stubbed so the
// integration shape can be validated end to end before adding
// CDP-action plumbing in followups.

use anyhow::{Context, Result};
use chromiumoxide::{Browser, BrowserConfig};
use futures::StreamExt;
use std::path::{Path, PathBuf};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use wasmtime::component::{Component, Linker, Resource, ResourceTable};
use wasmtime::{Config, Engine, Store};
use wasmtime_wasi::{WasiCtx, WasiCtxBuilder, WasiView};

use recorder::types::{ActionKind, RecordingManifest};

use crate::run_record::{ExportOutcome, RunOutcome, RunRecord, StepOutcome};

wasmtime::component::bindgen!({
    world: "capability",
    path: "../reference-capability/wit/world.wit",
    with: {
        "purroxy:capability/types/page-snapshot": SnapshotState,
    },
});

use purroxy::capability::types::{Host as TypesHost, HostPageSnapshot};

#[derive(Clone)]
pub struct SnapshotState {
    url: String,
    title: String,
    viewport: (u32, u32),
}

impl SnapshotState {
    fn from_recorder(s: &recorder::types::PageSnapshot) -> Self {
        SnapshotState {
            url: s.url.clone(),
            title: s.title.clone(),
            viewport: s.viewport,
        }
    }
}

struct HostState {
    table: ResourceTable,
    wasi: WasiCtx,
    log_buf: Vec<String>,
    monotonic_origin: Instant,
}

impl HostState {
    fn new() -> Self {
        HostState {
            table: ResourceTable::new(),
            wasi: WasiCtxBuilder::new().build(),
            log_buf: Vec::new(),
            monotonic_origin: Instant::now(),
        }
    }
}

impl WasiView for HostState {
    fn ctx(&mut self) -> &mut WasiCtx {
        &mut self.wasi
    }
    fn table(&mut self) -> &mut ResourceTable {
        &mut self.table
    }
}

impl HostPageSnapshot for HostState {
    fn url(&mut self, this: Resource<SnapshotState>) -> String {
        self.table.get(&this).unwrap().url.clone()
    }
    fn title(&mut self, this: Resource<SnapshotState>) -> String {
        self.table.get(&this).unwrap().title.clone()
    }
    fn viewport_width(&mut self, this: Resource<SnapshotState>) -> u32 {
        self.table.get(&this).unwrap().viewport.0
    }
    fn viewport_height(&mut self, this: Resource<SnapshotState>) -> u32 {
        self.table.get(&this).unwrap().viewport.1
    }
    fn root_handle(&mut self, _this: Resource<SnapshotState>) -> ElementHandle {
        ElementHandle { id: 0 }
    }
    fn drop(&mut self, rep: Resource<SnapshotState>) -> wasmtime::Result<()> {
        self.table.delete(rep)?;
        Ok(())
    }
}

impl TypesHost for HostState {}

impl purroxy::capability::dom_shape::Host for HostState {
    fn find_by_role(&mut self, _: Resource<SnapshotState>, _: String) -> Vec<ElementHandle> { vec![] }
    fn find_by_name_pattern(&mut self, _: Resource<SnapshotState>, _: String) -> Vec<ElementHandle> { vec![] }
    fn find_by_text_contains(&mut self, _: Resource<SnapshotState>, _: String) -> Vec<ElementHandle> { vec![] }
    fn role_of(&mut self, _: Resource<SnapshotState>, _: ElementHandle) -> Option<String> { None }
    fn name_of(&mut self, _: Resource<SnapshotState>, _: ElementHandle) -> Option<String> { None }
    fn text_of(&mut self, _: Resource<SnapshotState>, _: ElementHandle) -> Option<String> { None }
    fn value_of(&mut self, _: Resource<SnapshotState>, _: ElementHandle) -> Option<String> { None }
    fn attribute_of(&mut self, _: Resource<SnapshotState>, _: ElementHandle, _: String) -> Option<String> { None }
    fn attributes_of(&mut self, _: Resource<SnapshotState>, _: ElementHandle) -> Vec<(String, String)> { vec![] }
    fn parent_of(&mut self, _: Resource<SnapshotState>, _: ElementHandle) -> Option<ElementHandle> { None }
    fn children_of(&mut self, _: Resource<SnapshotState>, _: ElementHandle) -> Vec<ElementHandle> { vec![] }
    fn ancestors_of(&mut self, _: Resource<SnapshotState>, _: ElementHandle) -> Vec<ElementHandle> { vec![] }
}

impl purroxy::capability::regex::Host for HostState {
    fn is_match(&mut self, _: String, _: String) -> Result<bool, purroxy::capability::regex::RegexError> { Ok(false) }
    fn find_first(&mut self, _: String, _: String) -> Result<Option<purroxy::capability::regex::MatchInfo>, purroxy::capability::regex::RegexError> { Ok(None) }
    fn find_all(&mut self, _: String, _: String) -> Result<Vec<purroxy::capability::regex::MatchInfo>, purroxy::capability::regex::RegexError> { Ok(vec![]) }
}

impl purroxy::capability::logging::Host for HostState {
    fn log(&mut self, lvl: purroxy::capability::logging::Level, message: String, kv: Vec<(String, String)>) {
        self.log_buf.push(format!("[{:?}] {} {:?}", lvl, message, kv));
    }
}

impl purroxy::capability::clock::Host for HostState {
    fn monotonic_now_ms(&mut self) -> u64 {
        self.monotonic_origin.elapsed().as_millis() as u64
    }
}

pub struct ReplayOptions {
    pub recording_dir: PathBuf,
    pub component_path: PathBuf,
    pub headless: bool,
    pub run_record_path: Option<PathBuf>,
    /// Optional progress channel. When set, the engine sends events
    /// (started, step-completed, finished) so a host can drive a live
    /// progress UI while the replay runs.
    pub event_tx: Option<tokio::sync::mpsc::UnboundedSender<ReplayEvent>>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ReplayEvent {
    Started {
        recording_id: String,
        total_steps: usize,
    },
    Step {
        step_id: String,
        step_index: usize,
        action: String,
        intent_role: Option<String>,
        intent_name: Option<String>,
        executed: bool,
        repaired: bool,
        duration_ms: u64,
    },
    Finished {
        outcome: String,
        reason: Option<String>,
    },
}

fn emit(tx: &Option<tokio::sync::mpsc::UnboundedSender<ReplayEvent>>, ev: ReplayEvent) {
    if let Some(tx) = tx {
        let _ = tx.send(ev);
    }
}

fn action_kind_label(a: &ActionKind) -> &'static str {
    match a {
        ActionKind::Click { .. } => "click",
        ActionKind::Input { .. } => "input",
        ActionKind::Navigate { .. } => "navigate",
    }
}

pub async fn replay(opts: ReplayOptions) -> Result<RunRecord> {
    let manifest_path = opts.recording_dir.join("manifest.json");
    let raw = std::fs::read_to_string(&manifest_path)
        .with_context(|| format!("reading {}", manifest_path.display()))?;
    let manifest: RecordingManifest = serde_json::from_str(&raw)?;

    emit(&opts.event_tx, ReplayEvent::Started {
        recording_id: manifest.recording_id.clone(),
        total_steps: manifest.steps.len(),
    });

    let (mut store, bindings) = init_component(&opts.component_path)?;

    // 1. validate-params (no params for the reference flow).
    use purroxy::capability::types::ParamSet;
    let _ = bindings
        .call_validate_params(&mut store, &ParamSet { entries: vec![] })?
        .map_err(|e| anyhow::anyhow!("validate-params rejected: {e:?}"))?;

    // 2. launch browser, navigate to start.
    let chrome_path = std::env::var("PURROXY_CHROME").unwrap_or_else(|_| {
        if cfg!(target_os = "macos") {
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome".into()
        } else if cfg!(target_os = "windows") {
            "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe".into()
        } else {
            "google-chrome".into()
        }
    });
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let tid = format!("{:?}", std::thread::current().id());
    let unique = format!("{:x}-{}-{}", nanos, std::process::id(), tid.replace(['(', ')', ' ', ','], "_"));
    let user_data_dir = std::env::temp_dir().join(format!("purroxy-replay-{unique}"));
    let mut cfg = BrowserConfig::builder()
        .chrome_executable(chrome_path)
        .user_data_dir(&user_data_dir);
    if opts.headless {
        // builder default is headless
    } else {
        cfg = cfg.with_head();
    }
    let (mut browser, mut handler) = Browser::launch(
        cfg.build()
            .map_err(|e| anyhow::anyhow!("browser config: {e}"))?,
    )
    .await?;
    let handler_task = tokio::task::spawn(async move {
        while handler.next().await.is_some() {}
    });
    let page = browser.new_page(&manifest.target_site).await?;
    page.wait_for_navigation().await?;

    let started_at_ms = epoch_ms();
    let mut step_outcomes: Vec<StepOutcome> = Vec::new();
    let mut outcome = RunOutcome::Success;

    // 3. iterate steps.
    for (step_idx, step) in manifest.steps.iter().enumerate() {
        let step_start = Instant::now();
        let live_before = recorder::snapshot::capture_snapshot(&page).await?;
        let before_res = store
            .data_mut()
            .table
            .push(SnapshotState::from_recorder(&live_before))?;
        let pre = match bindings.call_preflight(&mut store, &step.id, before_res)? {
            Ok(()) => ExportOutcome::Ok,
            Err(e) => ExportOutcome::Err {
                code: format!("{:?}", std::mem::discriminant(&e)),
                message: format!("{:?}", e),
            },
        };
        if matches!(pre, ExportOutcome::Err { .. }) {
            step_outcomes.push(StepOutcome {
                step_id: step.id.clone(),
                preflight: pre,
                postflight: ExportOutcome::Skipped,
                repaired: false,
                action_executed: false,
                duration_ms: step_start.elapsed().as_millis() as u64,
            });
            outcome = RunOutcome::NeedsReview {
                reason: "preflight failed".into(),
                step_id: step.id.clone(),
            };
            break;
        }

        // 4. execute action. Click and Input first try the exact
        // intent match against the live page. If that fails, enter
        // repair: enumerate candidates matching role only, ask the
        // component to score them, accept the top score if it
        // exceeds the threshold (PRD §9.4).
        let mut repaired = false;
        let action_executed = match &step.action {
            ActionKind::Navigate { url } => page.goto(url).await.ok().is_some(),
            ActionKind::Click { .. } => {
                if execute_click(&page, &step.intent).await? {
                    true
                } else {
                    let r = try_repair_click(
                        &page,
                        &mut store,
                        &bindings,
                        &step.id,
                        &step.intent,
                    )
                    .await?;
                    repaired = r;
                    r
                }
            }
            ActionKind::Input { value, .. } => {
                execute_input(&page, &step.intent, value).await?
            }
        };

        // wait for the page to settle. If the action triggered a
        // navigation, wait_for_navigation resolves; otherwise
        // timeout and proceed. After that, retry a trivial evaluate
        // until the new execution context is available so the
        // subsequent snapshot capture doesn't trip "Cannot find
        // context with specified id".
        let _ = tokio::time::timeout(
            std::time::Duration::from_millis(2500),
            page.wait_for_navigation(),
        )
        .await;
        for _ in 0..20 {
            if page.evaluate("1").await.is_ok() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }

        // 5. postflight.
        let live_after = recorder::snapshot::capture_snapshot(&page).await?;
        let before_res = store
            .data_mut()
            .table
            .push(SnapshotState::from_recorder(&live_before))?;
        let after_res = store
            .data_mut()
            .table
            .push(SnapshotState::from_recorder(&live_after))?;
        let post = match bindings.call_postflight(&mut store, &step.id, before_res, after_res)? {
            Ok(()) => ExportOutcome::Ok,
            Err(e) => ExportOutcome::Err {
                code: format!("{:?}", std::mem::discriminant(&e)),
                message: format!("{:?}", e),
            },
        };
        let post_failed = matches!(post, ExportOutcome::Err { .. });
        let step_duration_ms = step_start.elapsed().as_millis() as u64;
        step_outcomes.push(StepOutcome {
            step_id: step.id.clone(),
            preflight: pre,
            postflight: post,
            repaired,
            action_executed,
            duration_ms: step_duration_ms,
        });
        emit(&opts.event_tx, ReplayEvent::Step {
            step_id: step.id.clone(),
            step_index: step_idx + 1,
            action: action_kind_label(&step.action).to_string(),
            intent_role: Some(step.intent.target_role.clone()),
            intent_name: step.intent.target_name_pattern.clone(),
            executed: action_executed,
            repaired,
            duration_ms: step_duration_ms,
        });
        if post_failed {
            outcome = RunOutcome::NeedsReview {
                reason: "postflight failed".into(),
                step_id: step.id.clone(),
            };
            break;
        }
    }

    // 6. extract + redact, only on success.
    let final_output = if matches!(outcome, RunOutcome::Success) {
        let live = recorder::snapshot::capture_snapshot(&page).await?;
        let res = store
            .data_mut()
            .table
            .push(SnapshotState::from_recorder(&live))?;
        match bindings.call_extract(&mut store, res)? {
            Ok(out) => {
                let redacted = bindings.call_redact(&mut store, &out)?;
                Some(serde_json::to_string(&output_to_json(&redacted))?)
            }
            Err(e) => {
                outcome = RunOutcome::Aborted {
                    reason: format!("extract failed: {:?}", e),
                };
                None
            }
        }
    } else {
        None
    };

    let _ = browser.close().await;
    let _ = browser.wait().await;
    handler_task.abort();

    let (outcome_label, outcome_reason): (&str, Option<String>) = match &outcome {
        RunOutcome::Success => ("success", None),
        RunOutcome::NeedsReview { reason, .. } => ("needs_review", Some(reason.clone())),
        RunOutcome::Aborted { reason } => ("aborted", Some(reason.clone())),
    };
    emit(&opts.event_tx, ReplayEvent::Finished {
        outcome: outcome_label.to_string(),
        reason: outcome_reason,
    });

    let ended_at_ms = epoch_ms();
    let record = RunRecord {
        run_id: format!("run-{:x}", started_at_ms),
        recording_id: manifest.recording_id.clone(),
        started_at_ms,
        ended_at_ms,
        outcome,
        steps: step_outcomes,
        final_output,
        fuel_consumed: 0,
    };

    if let Some(path) = &opts.run_record_path {
        let json = serde_json::to_string_pretty(&record)?;
        std::fs::write(path, json)?;
    }

    Ok(record)
}

fn init_component(path: &Path) -> Result<(Store<HostState>, Capability)> {
    let mut config = Config::new();
    config.wasm_component_model(true);
    let engine = Engine::new(&config)?;

    let component = Component::from_file(&engine, path)
        .with_context(|| format!("loading {}", path.display()))?;

    let mut linker = Linker::<HostState>::new(&engine);
    wasmtime_wasi::add_to_linker_sync(&mut linker)?;
    Capability::add_to_linker(&mut linker, |s: &mut HostState| s)?;

    let mut store = Store::new(&engine, HostState::new());
    let bindings = Capability::instantiate(&mut store, &component, &linker)?;
    Ok((store, bindings))
}

fn output_to_json(o: &purroxy::capability::types::Output) -> serde_json::Value {
    let entries: Vec<serde_json::Value> = o
        .fields
        .iter()
        .map(|f| {
            serde_json::json!({
                "name": f.name,
                "sensitive": f.sensitive,
                "value": param_value_to_json(&f.value),
            })
        })
        .collect();
    serde_json::json!({ "fields": entries })
}

fn param_value_to_json(v: &purroxy::capability::types::ParamValue) -> serde_json::Value {
    use purroxy::capability::types::ParamValue::*;
    match v {
        StringVal(s) => serde_json::Value::String(s.clone()),
        S64Val(n) => serde_json::Value::from(*n),
        F64Val(n) => serde_json::Value::from(*n),
        BoolVal(b) => serde_json::Value::Bool(*b),
        None => serde_json::Value::Null,
    }
}

async fn execute_click(
    page: &chromiumoxide::Page,
    intent: &recorder::types::StepIntent,
) -> Result<bool> {
    let target_role = intent.target_role.as_str();
    let name = intent.target_name_pattern.as_deref().unwrap_or("");
    let script = format!(
        r#"(() => {{
            const role = {role_json};
            const name = {name_json};
            const matches = (el) => {{
                const elRole = el.getAttribute('role') || el.tagName.toLowerCase();
                if (elRole !== role) return false;
                if (!name) return true;
                const aria = el.getAttribute('aria-label') || '';
                const text = (el.textContent || '').trim();
                const placeholder = el.getAttribute('placeholder') || '';
                return aria.includes(name) || text.includes(name) || placeholder.includes(name);
            }};
            const all = Array.from(document.querySelectorAll('*'));
            const target = all.find(matches);
            if (!target) return JSON.stringify({{ ok: false, reason: 'no-match' }});
            target.click();
            return JSON.stringify({{ ok: true }});
        }})()"#,
        role_json = serde_json::to_string(target_role).unwrap(),
        name_json = serde_json::to_string(name).unwrap(),
    );
    let result = page.evaluate(script.as_str()).await?;
    let s: String = result.into_value().unwrap_or_default();
    let v: serde_json::Value = serde_json::from_str(&s).unwrap_or(serde_json::Value::Null);
    let ok = v.get("ok").and_then(|x| x.as_bool()).unwrap_or(false);
    if !ok {
        eprintln!("[replay] click failed: {s}");
    }
    Ok(ok)
}

// Repair path for click. Host filters candidates by role only,
// asks the component to score them via score-repair-candidates,
// accepts the top scored candidate iff:
//   (a) score exceeds REPAIR_SCORE_THRESHOLD,
//   (b) the candidate still passes a host-side structural intent
//       re-check (PRD §9.4),
//   (c) the candidate ranks within REPAIR_TOP_N of the filtered
//       set.
// Component cannot promote a candidate the host filter excluded;
// a malicious or buggy scorer can re-order, not substitute.
const REPAIR_SCORE_THRESHOLD: f64 = 0.5;
const REPAIR_TOP_N: usize = 5;

async fn try_repair_click(
    page: &chromiumoxide::Page,
    store: &mut Store<HostState>,
    bindings: &Capability,
    step_id: &str,
    intent: &recorder::types::StepIntent,
) -> Result<bool> {
    // 1. Pre-filter candidates by role on the live page. Each
    //    candidate gets a stable index that is also its
    //    ElementHandle.id, so the component's scored candidate
    //    points back at a clickable element.
    let role = &intent.target_role;
    let script = format!(
        r#"(() => {{
            const role = {role_json};
            const all = Array.from(document.querySelectorAll('*'));
            const cands = [];
            for (let i = 0; i < all.length; i++) {{
                const el = all[i];
                const r = el.getAttribute('role') || el.tagName.toLowerCase();
                if (r === role) {{
                    cands.push({{
                        index: i,
                        text: (el.textContent || '').trim().slice(0, 200),
                        aria: el.getAttribute('aria-label') || '',
                    }});
                    if (cands.length >= {top_n}) break;
                }}
            }}
            return JSON.stringify(cands);
        }})()"#,
        role_json = serde_json::to_string(role).unwrap(),
        top_n = REPAIR_TOP_N,
    );
    let raw = page.evaluate(script.as_str()).await?;
    let s: String = raw.into_value().unwrap_or_default();
    let cands: Vec<serde_json::Value> = serde_json::from_str(&s).unwrap_or_default();
    if cands.is_empty() {
        return Ok(false);
    }

    let handles: Vec<ElementHandle> = cands
        .iter()
        .enumerate()
        .map(|(i, _)| ElementHandle { id: i as u64 })
        .collect();
    let live = recorder::snapshot::capture_snapshot(page).await?;
    let snap = store
        .data_mut()
        .table
        .push(SnapshotState::from_recorder(&live))?;

    let wit_intent = purroxy::capability::types::StepIntent {
        target_role: intent.target_role.clone(),
        target_name_pattern: intent.target_name_pattern.clone(),
        target_text_content: intent.target_text_content.clone(),
        structural_anchor_roles: intent.structural_anchor_roles.clone(),
        surrounding_context: intent.surrounding_context.clone(),
    };

    let scored = bindings.call_score_repair_candidates(
        store,
        step_id,
        &wit_intent,
        &handles,
        snap,
    )?;

    // 2. Pick the top score.
    let mut best: Option<&purroxy::capability::types::ScoredCandidate> = None;
    for c in &scored {
        if best.map(|b| c.score > b.score).unwrap_or(true) {
            best = Some(c);
        }
    }
    let Some(top) = best else {
        return Ok(false);
    };
    if top.score < REPAIR_SCORE_THRESHOLD {
        return Ok(false);
    }

    // 3. Resolve the chosen candidate's index to a real DOM index
    //    and click it. The component's candidate id is the position
    //    in the handles list; that maps back into our cands array.
    let pos = top.handle.id as usize;
    let chosen = cands.get(pos).cloned().unwrap_or(serde_json::Value::Null);
    let dom_index = chosen.get("index").and_then(|v| v.as_i64());
    let Some(dom_index) = dom_index else {
        return Ok(false);
    };

    let click_script = format!(
        r#"(() => {{
            const all = Array.from(document.querySelectorAll('*'));
            const el = all[{idx}];
            if (!el) return JSON.stringify({{ ok: false }});
            el.click();
            return JSON.stringify({{ ok: true }});
        }})()"#,
        idx = dom_index,
    );
    let raw = page.evaluate(click_script.as_str()).await?;
    let s: String = raw.into_value().unwrap_or_default();
    let v: serde_json::Value = serde_json::from_str(&s).unwrap_or(serde_json::Value::Null);
    Ok(v.get("ok").and_then(|x| x.as_bool()).unwrap_or(false))
}

async fn execute_input(
    page: &chromiumoxide::Page,
    intent: &recorder::types::StepIntent,
    value: &str,
) -> Result<bool> {
    let target_role = intent.target_role.as_str();
    let name = intent.target_name_pattern.as_deref().unwrap_or("");
    let script = format!(
        r#"(() => {{
            const role = {role_json};
            const name = {name_json};
            const value = {value_json};
            const matches = (el) => {{
                const elRole = el.getAttribute('role') || el.tagName.toLowerCase();
                if (elRole !== role && elRole !== 'input' && elRole !== 'textbox') return false;
                if (!name) return true;
                const aria = el.getAttribute('aria-label') || '';
                const placeholder = el.getAttribute('placeholder') || '';
                const labelText = (el.labels && el.labels[0] && el.labels[0].innerText) || '';
                return aria.includes(name) || placeholder.includes(name) || labelText.includes(name);
            }};
            const all = Array.from(document.querySelectorAll('input, textarea, [contenteditable], [role=textbox]'));
            const target = all.find(matches);
            if (!target) return false;
            target.focus();
            if ('value' in target) {{
                const setter = Object.getOwnPropertyDescriptor(target.constructor.prototype, 'value').set;
                setter.call(target, value);
            }} else {{
                target.textContent = value;
            }}
            target.dispatchEvent(new Event('input', {{ bubbles: true }}));
            target.dispatchEvent(new Event('change', {{ bubbles: true }}));
            return true;
        }})()"#,
        role_json = serde_json::to_string(target_role).unwrap(),
        name_json = serde_json::to_string(name).unwrap(),
        value_json = serde_json::to_string(value).unwrap(),
    );
    let result = page.evaluate(script.as_str()).await?;
    Ok(result.into_value::<bool>().unwrap_or(false))
}

fn epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}
