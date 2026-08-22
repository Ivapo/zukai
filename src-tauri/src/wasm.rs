//! The browser's one entry into this crate.
//!
//! Zukai's Rust is a *file-dialog* backend, and dialogs do not compile to wasm —
//! so almost nothing crosses. What does is the pure conversion this module
//! wraps: [`import_network_str`], which is `parse_network` then
//! `network_to_document` and reads no path. There is no drawing code here and
//! there never will be — the browser already draws the diagram, and a second
//! renderer is the thing `specs/web_demo_spec.md` §2.4 exists to refuse.
//!
//! Why wasm at all rather than a JavaScript YAML reader: serde plus the model's
//! attributes are the single source of truth for the format, and a second
//! encoder would drift silently. So this is not an extra — it is what protects
//! an existing decision.

use serde::Serialize;
use serde_wasm_bindgen::Serializer;
use wasm_bindgen::prelude::*;

use crate::network::import::import_network_str;

/// Read an Assimilator `network.yaml` and hand back a Zukai document.
///
/// The result crosses as a plain JS object, ready for
/// `document.ts:normalizeDocument` — see the serializer note below, which is
/// load-bearing rather than incidental.
#[wasm_bindgen(js_name = importNetworkYaml)]
pub fn import_network_yaml(text: &str) -> Result<JsValue, JsError> {
    let doc = import_network_str(text).map_err(|e| JsError::new(&e))?;
    // `json_compatible()`, never the default serializer. The default maps a Rust
    // map to an ES `Map`, and `model::layout::Layout` is four `BTreeMap`s while
    // `document.ts:normalizeDocument` indexes plain objects — `layout.nodes ?? {}`
    // would pass the `Map` straight through and every lookup yield `undefined`,
    // i.e. a blank canvas that throws nothing. It also serializes `None` as
    // `null` rather than `undefined`, which is what keeps this path's output
    // equal to `serde_json`'s in the golden test.
    doc.serialize(&Serializer::json_compatible())
        .map_err(|e| JsError::new(&e.to_string()))
}
