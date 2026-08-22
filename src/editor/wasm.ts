/**
 * The browser's copy of this project's Rust, compiled to wasm.
 *
 * Not a convenience: `serde` plus the model's attributes are the single source
 * of truth for what these formats mean, and a second reader written in
 * JavaScript would drift from them silently — the lane-numbering reconciliation
 * in `import.rs:kerb_lane` is the sharp case, and a `.zkai` that round-trips on
 * the desktop and loses a field on the web is the quiet one. So the wasm is what
 * *protects* an existing decision (`specs/web_demo_spec.md` §2.4), and it
 * carries no drawing code at all; the browser already draws the diagram.
 *
 * Two codecs, one module, because there is one `init()`: loading the crate twice
 * would fetch the `.wasm` twice. Loaded on first use rather than at startup —
 * the module is a few KB of glue, but `init()` is what fetches the ~300 KB
 * binary, and a visitor who only looks should never pay for it.
 */

import type { RawDocument } from "../model/document";
import type { Document } from "../model/types";

/** The in-flight or finished load. One per process; `init()` runs exactly once. */
let loaded: Promise<typeof import("../../src-tauri/pkg/zukai_lib.js")> | null = null;

function core() {
  return (loaded ??= import("../../src-tauri/pkg/zukai_lib.js").then(async (m) => {
    await m.default();
    return m;
  }));
}

/**
 * Convert an Assimilator `network.yaml` to a Zukai document.
 *
 * Raw, like the Tauri host's `invoke`: the reducer is the one place that
 * normalizes. Throws with the Rust error's own text if the file will not read.
 */
export async function importNetworkYaml(text: string): Promise<RawDocument> {
  return (await core()).importNetworkYaml(text) as RawDocument;
}

/**
 * Read `.zkai` text — version probe, migration and all. Raw, for the same
 * reason: `normalizeDocument` runs in the reducer and nowhere else.
 */
export async function decodeZkai(text: string): Promise<RawDocument> {
  return (await core()).decodeZkai(text) as RawDocument;
}

/**
 * Write `.zkai` text for a document.
 *
 * **The `JSON.stringify` is the interesting line**, and it lives here so no
 * caller knows how the crate is fed. The Rust shell takes a JSON string because
 * `serde_json` is already the reader Tauri's IPC uses to turn this very object
 * into a `Document` for `save_document`; `serde_wasm_bindgen::from_value` would
 * be a *second* JS→Rust reader, and the two disagree about a key present as
 * `undefined`. See `wasm.rs:encode_zkai`.
 */
export async function encodeZkai(doc: Document): Promise<string> {
  return (await core()).encodeZkai(JSON.stringify(doc));
}
