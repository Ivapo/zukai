//! The browser's entry into this crate.
//!
//! Zukai's Rust is a *file-dialog* backend, and dialogs do not compile to wasm —
//! so almost nothing crosses. What does is the pure work the dialogs used to
//! wrap: [`import_network_yaml`], which is `parse_network` then
//! `network_to_document`, and the `.zkai` codec, which is
//! [`crate::persist::encode`] and [`crate::persist::decode`] with no path in
//! sight. There is no drawing code here and there never will be — the browser
//! already draws the diagram, and a second renderer is the thing
//! `specs/web_demo_spec.md` §2.4 exists to refuse.
//!
//! Why wasm at all rather than a JavaScript YAML reader: serde plus the model's
//! attributes are the single source of truth for the format, and a second
//! encoder would drift silently. So this is not an extra — it is what protects
//! an existing decision.
//!
//! **Marshalling is the one place these shells are not thin, and it runs two
//! different ways on purpose.** Out of Rust, the document is serialized with
//! `Serializer::json_compatible()`; into Rust, it arrives as a JSON *string*
//! and is read with `serde_json`. See each function for why.

use serde::Serialize;
use serde_wasm_bindgen::Serializer;
use wasm_bindgen::prelude::*;

use crate::model::Document;
use crate::network::import::import_network_str;
use crate::persist;

/// Rust → JS, the one way this crate hands a document across.
///
/// `json_compatible()`, never the default serializer. The default maps a Rust
/// map to an ES `Map`, and `model::layout::Layout` is four `BTreeMap`s while
/// `document.ts:normalizeDocument` indexes plain objects — `layout.nodes ?? {}`
/// would pass the `Map` straight through and every lookup yield `undefined`,
/// i.e. a blank canvas that throws nothing. It also serializes `None` as `null`
/// rather than `undefined`, which is what keeps this path's output equal to
/// `serde_json`'s in the golden tests.
fn to_js(doc: &Document) -> Result<JsValue, JsError> {
    doc.serialize(&Serializer::json_compatible())
        .map_err(|e| JsError::new(&e.to_string()))
}

/// Read an Assimilator `network.yaml` and hand back a Zukai document.
#[wasm_bindgen(js_name = importNetworkYaml)]
pub fn import_network_yaml(text: &str) -> Result<JsValue, JsError> {
    to_js(&import_network_str(text).map_err(|e| JsError::new(&e))?)
}

/// Read `.zkai` text — version probe, deserialize, migrate — and hand back the
/// document. The browser's `load_document`, minus the file.
#[wasm_bindgen(js_name = decodeZkai)]
pub fn decode_zkai(text: &str) -> Result<JsValue, JsError> {
    to_js(&persist::decode(text).map_err(|e| JsError::new(&e))?)
}

/// Write `.zkai` text for a document. The browser's `save_document`, minus the
/// file.
///
/// **It takes the document as a JSON string, and that is the decision this
/// module's header points at.** JS → Rust happens exactly once in this project,
/// and `serde_json` is already the reader that does it: Tauri marshals the very
/// same object into the very same [`Document`] for `save_document`. Feeding this
/// shell `JSON.stringify(doc)` therefore reuses that reader rather than adding a
/// second one — and `serde_wasm_bindgen::from_value` would genuinely be a second
/// one, over a model that carries internally-tagged enums (`decoration.rs`'s
/// `tag = "type"`) and `#[serde(default)]` fields, where a key present as
/// `undefined` and a key absent are the same thing to `JSON.stringify` and not
/// to it. That is §2.4's drift, one direction over.
#[wasm_bindgen(js_name = encodeZkai)]
pub fn encode_zkai(doc_json: &str) -> Result<String, JsError> {
    let doc: Document = serde_json::from_str(doc_json).map_err(|e| JsError::new(&e.to_string()))?;
    persist::encode(&doc).map_err(|e| JsError::new(&e))
}
