/**
 * The browser's copy of the `network.yaml` reader, compiled from the Rust.
 *
 * Not a convenience: `serde` plus the model's attributes are the single source
 * of truth for what the file means, and a second reader written in JavaScript
 * would drift from it silently — the lane-numbering reconciliation in
 * `import.rs:kerb_lane` is the sharp case. So the wasm is what *protects* an
 * existing decision (`specs/web_demo_spec.md` §2.4), and it carries no drawing
 * code at all; the browser already draws the diagram.
 *
 * Loaded on first use rather than at startup. The module is a few KB of glue,
 * but `init()` is what fetches the ~300 KB `.wasm`, and a visitor who never
 * imports a network should never pay for it.
 */

import type { RawDocument } from "../model/document";

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
