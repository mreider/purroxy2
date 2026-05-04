// Phase 1: real host integration against the purroxy:capability/v1
// WIT contract.
//
// Loads the reference capability built by `cargo component build
// -p reference-capability --release`, instantiates it through
// wasmtime's Component model with bindgen-generated types, provides
// the host imports (dom-shape, regex, logging, clock) backed by a
// minimal in-memory accessibility tree, and calls every export of
// the world to validate the contract end-to-end.

use anyhow::{Context, Result};
use wasmtime::component::{Component, Linker, Resource, ResourceTable};
use wasmtime::{Config, Engine, Store};
use wasmtime_wasi::{WasiCtx, WasiCtxBuilder, WasiView};

wasmtime::component::bindgen!({
    world: "capability",
    path: "../reference-capability/wit/world.wit",
    with: {
        "purroxy:capability/types/page-snapshot": SnapshotState,
    },
});

use purroxy::capability::types::{Host as TypesHost, HostPageSnapshot};

const COMPONENT_PATH: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../target/wasm32-wasip2/release/reference_capability.wasm"
);

// In-host page snapshot model. Trivial accessibility tree: one node
// at root with a fake title, no children. The point is to exercise
// the contract, not to render a real DOM.
#[derive(Clone)]
pub struct SnapshotState {
    url: String,
    title: String,
    viewport: (u32, u32),
    nodes: Vec<NodeData>,
}

#[derive(Clone)]
struct NodeData {
    role: String,
    name: Option<String>,
    text: Option<String>,
    value: Option<String>,
    attrs: Vec<(String, String)>,
    parent: Option<u64>,
    children: Vec<u64>,
}

impl SnapshotState {
    fn fake() -> Self {
        SnapshotState {
            url: "https://example.com/".into(),
            title: "Example Domain".into(),
            viewport: (1280, 720),
            nodes: vec![NodeData {
                role: "main".into(),
                name: Some("root".into()),
                text: Some("Example Domain".into()),
                value: None,
                attrs: vec![],
                parent: None,
                children: vec![],
            }],
        }
    }

    fn root_id(&self) -> u64 {
        0
    }

    fn node(&self, id: u64) -> Option<&NodeData> {
        self.nodes.get(id as usize)
    }
}

// Host data carried by the wasmtime Store.
//
// FIXME (Phase 1 followup): the wasi field is here because
// cargo-component-built components import wasi:io/poll and friends
// even when targeted at wasm32-wasip2 with no I/O code. PRD §9.4
// requires capability components to have NO wasi imports. Strip
// those imports at component-build time (likely via `wasm-tools
// component embed --adapter` with a no-op adapter, or a custom
// proc-macro path) before Phase 1 closes.
struct HostState {
    table: ResourceTable,
    wasi: WasiCtx,
    log_buf: Vec<String>,
    monotonic_origin: std::time::Instant,
}

impl HostState {
    fn new() -> Self {
        HostState {
            table: ResourceTable::new(),
            wasi: WasiCtxBuilder::new().build(),
            log_buf: Vec::new(),
            monotonic_origin: std::time::Instant::now(),
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

// ---- Host impls for `types.page-snapshot` resource methods.

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

    fn root_handle(&mut self, this: Resource<SnapshotState>) -> ElementHandle {
        let root = self.table.get(&this).unwrap().root_id();
        ElementHandle { id: root }
    }

    fn drop(&mut self, rep: Resource<SnapshotState>) -> wasmtime::Result<()> {
        self.table.delete(rep)?;
        Ok(())
    }
}

impl TypesHost for HostState {}

// ---- Host impls for the four imported interfaces.

impl purroxy::capability::dom_shape::Host for HostState {
    fn find_by_role(
        &mut self,
        snap: Resource<SnapshotState>,
        role: String,
    ) -> Vec<ElementHandle> {
        let s = self.table.get(&snap).unwrap();
        s.nodes
            .iter()
            .enumerate()
            .filter(|(_, n)| n.role == role)
            .map(|(i, _)| ElementHandle { id: i as u64 })
            .collect()
    }

    fn find_by_name_pattern(
        &mut self,
        snap: Resource<SnapshotState>,
        pattern: String,
    ) -> Vec<ElementHandle> {
        let s = self.table.get(&snap).unwrap();
        s.nodes
            .iter()
            .enumerate()
            .filter(|(_, n)| n.name.as_deref().map(|x| x.contains(&pattern)).unwrap_or(false))
            .map(|(i, _)| ElementHandle { id: i as u64 })
            .collect()
    }

    fn find_by_text_contains(
        &mut self,
        snap: Resource<SnapshotState>,
        needle: String,
    ) -> Vec<ElementHandle> {
        let s = self.table.get(&snap).unwrap();
        s.nodes
            .iter()
            .enumerate()
            .filter(|(_, n)| n.text.as_deref().map(|x| x.contains(&needle)).unwrap_or(false))
            .map(|(i, _)| ElementHandle { id: i as u64 })
            .collect()
    }

    fn role_of(&mut self, snap: Resource<SnapshotState>, h: ElementHandle) -> Option<String> {
        let s = self.table.get(&snap).unwrap();
        s.node(h.id).map(|n| n.role.clone())
    }

    fn name_of(&mut self, snap: Resource<SnapshotState>, h: ElementHandle) -> Option<String> {
        let s = self.table.get(&snap).unwrap();
        s.node(h.id).and_then(|n| n.name.clone())
    }

    fn text_of(&mut self, snap: Resource<SnapshotState>, h: ElementHandle) -> Option<String> {
        let s = self.table.get(&snap).unwrap();
        s.node(h.id).and_then(|n| n.text.clone())
    }

    fn value_of(&mut self, snap: Resource<SnapshotState>, h: ElementHandle) -> Option<String> {
        let s = self.table.get(&snap).unwrap();
        s.node(h.id).and_then(|n| n.value.clone())
    }

    fn attribute_of(
        &mut self,
        snap: Resource<SnapshotState>,
        h: ElementHandle,
        key: String,
    ) -> Option<String> {
        let s = self.table.get(&snap).unwrap();
        s.node(h.id)
            .and_then(|n| n.attrs.iter().find(|(k, _)| k == &key).map(|(_, v)| v.clone()))
    }

    fn attributes_of(
        &mut self,
        snap: Resource<SnapshotState>,
        h: ElementHandle,
    ) -> Vec<(String, String)> {
        let s = self.table.get(&snap).unwrap();
        s.node(h.id).map(|n| n.attrs.clone()).unwrap_or_default()
    }

    fn parent_of(
        &mut self,
        snap: Resource<SnapshotState>,
        h: ElementHandle,
    ) -> Option<ElementHandle> {
        let s = self.table.get(&snap).unwrap();
        s.node(h.id)
            .and_then(|n| n.parent.map(|p| ElementHandle { id: p }))
    }

    fn children_of(
        &mut self,
        snap: Resource<SnapshotState>,
        h: ElementHandle,
    ) -> Vec<ElementHandle> {
        let s = self.table.get(&snap).unwrap();
        s.node(h.id)
            .map(|n| n.children.iter().map(|&id| ElementHandle { id }).collect())
            .unwrap_or_default()
    }

    fn ancestors_of(
        &mut self,
        snap: Resource<SnapshotState>,
        h: ElementHandle,
    ) -> Vec<ElementHandle> {
        let s = self.table.get(&snap).unwrap();
        let mut out = Vec::new();
        let mut cur = s.node(h.id).and_then(|n| n.parent);
        while let Some(p) = cur {
            out.push(ElementHandle { id: p });
            cur = s.node(p).and_then(|n| n.parent);
        }
        out
    }
}

impl purroxy::capability::regex::Host for HostState {
    fn is_match(
        &mut self,
        _pattern: String,
        _input: String,
    ) -> Result<bool, purroxy::capability::regex::RegexError> {
        // Stub: real host links the regex crate.
        Ok(false)
    }

    fn find_first(
        &mut self,
        _pattern: String,
        _input: String,
    ) -> Result<Option<purroxy::capability::regex::MatchInfo>, purroxy::capability::regex::RegexError>
    {
        Ok(None)
    }

    fn find_all(
        &mut self,
        _pattern: String,
        _input: String,
    ) -> Result<
        Vec<purroxy::capability::regex::MatchInfo>,
        purroxy::capability::regex::RegexError,
    > {
        Ok(vec![])
    }
}

impl purroxy::capability::logging::Host for HostState {
    fn log(
        &mut self,
        lvl: purroxy::capability::logging::Level,
        message: String,
        kv: Vec<(String, String)>,
    ) {
        self.log_buf
            .push(format!("[{:?}] {} {:?}", lvl, message, kv));
    }
}

impl purroxy::capability::clock::Host for HostState {
    fn monotonic_now_ms(&mut self) -> u64 {
        self.monotonic_origin.elapsed().as_millis() as u64
    }
}

fn run_contract_pipeline(verbose: bool) -> Result<()> {
    let mut config = Config::new();
    config.wasm_component_model(true);
    let engine = Engine::new(&config)?;

    let component = Component::from_file(&engine, COMPONENT_PATH)
        .with_context(|| format!("loading {COMPONENT_PATH}"))?;

    let mut linker = Linker::<HostState>::new(&engine);
    wasmtime_wasi::add_to_linker_sync(&mut linker)?;
    Capability::add_to_linker(&mut linker, |s: &mut HostState| s)?;

    let mut store = Store::new(&engine, HostState::new());
    let bindings = Capability::instantiate(&mut store, &component, &linker)?;

    macro_rules! say { ($($t:tt)*) => { if verbose { println!($($t)*); } } }

    // ---- 1. metadata
    let meta = bindings.call_metadata(&mut store)?;
    say!(
        "[1] metadata: name={:?} site={:?} budget.fuel={}",
        meta.name, meta.target_site_pattern, meta.budget.max_fuel
    );
    assert_eq!(meta.target_wit_version, "purroxy:capability@1.0.0");

    // ---- 2. validate-params
    use purroxy::capability::types::{ParamEntry, ParamSet, ParamValue};
    let params = ParamSet {
        entries: vec![ParamEntry {
            name: "query".into(),
            value: ParamValue::StringVal("hello".into()),
        }],
    };
    let validated = bindings.call_validate_params(&mut store, &params)?;
    let validated = validated.expect("validate-params should accept");
    say!("[2] validate-params: {} entries", validated.entries.len());

    // ---- 3. preflight
    let snap = store.data_mut().table.push(SnapshotState::fake())?;
    let pre = bindings.call_preflight(&mut store, "step-1", snap)?;
    pre.expect("preflight should pass");
    say!("[3] preflight: ok");

    // ---- 4. postflight
    let before = store.data_mut().table.push(SnapshotState::fake())?;
    let after = store.data_mut().table.push(SnapshotState::fake())?;
    let post = bindings.call_postflight(&mut store, "step-1", before, after)?;
    post.expect("postflight should pass");
    say!("[4] postflight: ok");

    // ---- 5. score-repair-candidates
    use purroxy::capability::types::StepIntent;
    let intent = StepIntent {
        target_role: "button".into(),
        target_name_pattern: Some("Submit".into()),
        target_text_content: None,
        structural_anchor_roles: vec!["form".into()],
        surrounding_context: None,
    };
    let cands = vec![
        ElementHandle { id: 1 },
        ElementHandle { id: 2 },
        ElementHandle { id: 3 },
    ];
    let snap2 = store.data_mut().table.push(SnapshotState::fake())?;
    let scored = bindings.call_score_repair_candidates(&mut store, "step-1", &intent, &cands, snap2)?;
    say!(
        "[5] score-repair-candidates: {} scored, top={:.2} ({})",
        scored.len(),
        scored[0].score,
        scored[0].reason
    );
    assert_eq!(scored.len(), 3);

    // ---- 6. extract
    let snap3 = store.data_mut().table.push(SnapshotState::fake())?;
    let extracted = bindings.call_extract(&mut store, snap3)?;
    let extracted = extracted.expect("extract should succeed");
    say!(
        "[6] extract: {} fields, first={:?}",
        extracted.fields.len(),
        extracted.fields[0].name
    );

    // ---- 7. redact
    use purroxy::capability::types::OutputField;
    let with_secret = purroxy::capability::types::Output {
        fields: vec![
            OutputField {
                name: "title".into(),
                value: ParamValue::StringVal("public".into()),
                sensitive: false,
            },
            OutputField {
                name: "ssn".into(),
                value: ParamValue::StringVal("123-45-6789".into()),
                sensitive: true,
            },
        ],
    };
    let redacted = bindings.call_redact(&mut store, &with_secret)?;
    let secret = &redacted.fields[1];
    say!(
        "[7] redact: ssn.value = {:?} (sensitive={})",
        secret.value, secret.sensitive
    );
    assert!(matches!(secret.value, ParamValue::None));

    say!("\nAll 7 exports of purroxy:capability/v1 round-tripped against the reference component.");
    Ok(())
}

fn main() -> Result<()> {
    run_contract_pipeline(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn contract_pipeline_round_trips_against_reference_component() {
        run_contract_pipeline(false).expect("every export should round-trip");
    }
}
