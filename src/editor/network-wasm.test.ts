/**
 * The wasm importer against the committed golden — the second of its two
 * readers, the first being `import.rs:cross_4_matches_the_committed_golden_document`.
 *
 * What the pair catches is **marshalling** drift, not converter drift: both
 * readers call the same `network_to_document`, so a converter change moves them
 * together. Marshalling is where the two paths can genuinely disagree, and the
 * failure is silent — `serde_wasm_bindgen`'s default serializer emits an ES
 * `Map` for a `BTreeMap`, `Layout` is four of them, and `normalizeDocument`
 * indexes plain objects, so a `Map` would arrive as an empty-looking canvas
 * that throws nothing.
 *
 * The generated package is imported directly rather than through
 * `network-wasm.ts`, because the loader is exactly the part that cannot run
 * here: under vitest's `node` environment the default `init()` fetches a
 * `.wasm` relative to `import.meta.url` and fails on a `file:` URL. Reading the
 * bytes and passing them in is what avoids a second `--target nodejs` build.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { RawDocument } from "../model/document";
import init, { importNetworkYaml } from "../../src-tauri/pkg/zukai_lib.js";

const ROOT = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
/** The generated `.d.ts` types the result `any`; name the shape once, here. */
const importFixture = (path: string) => importNetworkYaml(read(path)) as RawDocument;

await init({
  module_or_path: readFileSync(new URL("src-tauri/pkg/zukai_lib_bg.wasm", ROOT)),
});

describe("the wasm network importer", () => {
  it("converts cross-4.yaml to the same document the Rust path does", () => {
    const doc = importFixture("src-tauri/tests/fixtures/network/cross-4.yaml");

    expect(doc).toEqual(
      JSON.parse(read("src-tauri/tests/fixtures/golden/cross-4.document.json")),
    );
  });

  /**
   * The marshalling assertion said directly, so a regression names itself
   * rather than arriving as a 368-line diff of the test above. Import places
   * every node, so the layout's keys are the document's node ids — and
   * `Object.keys` of an ES `Map` is `[]`, which is the whole failure mode.
   */
  it("hands the layout across as plain objects, not ES Maps", () => {
    const doc = importFixture("src-tauri/tests/fixtures/network/t_junction.yaml");

    expect(doc.layout?.nodes).not.toBeInstanceOf(Map);
    expect(Object.keys(doc.layout?.nodes ?? {}).sort()).toEqual(
      (doc.nodes ?? []).map((n) => n.id).sort(),
    );
  });

  it("reports a file it cannot read rather than returning a half-formed document", () => {
    expect(() => importNetworkYaml("this is not a network")).toThrow();
  });
});
