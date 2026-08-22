/**
 * The wasm codecs against the committed goldens — the second of each one's two
 * readers, the first being `import.rs:cross_4_matches_the_committed_golden_document`
 * and `persist.rs:cross_4_encodes_to_the_committed_golden_zkai`.
 *
 * What the pairs catch is **marshalling** drift, not converter drift: both sides
 * call the same Rust, so a change to a converter moves them together.
 * Marshalling is where the two paths can genuinely disagree, and the failure is
 * silent in both directions — `serde_wasm_bindgen`'s default serializer emits an
 * ES `Map` for a `BTreeMap`, `Layout` is four of them, and `normalizeDocument`
 * indexes plain objects, so a `Map` would arrive as an empty-looking canvas that
 * throws nothing; and on the way back, a second JS→Rust reader would drop a
 * field that the desktop's `serde_json` keeps.
 *
 * The generated package is imported directly rather than through `wasm.ts`,
 * because the loader is exactly the part that cannot run here: under vitest's
 * `node` environment the default `init()` fetches a `.wasm` relative to
 * `import.meta.url` and fails on a `file:` URL. Reading the bytes and passing
 * them in is what avoids a second `--target nodejs` build.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { RawDocument } from "../model/document";
import init, {
  decodeZkai,
  encodeZkai,
  importNetworkYaml,
} from "../../src-tauri/pkg/zukai_lib.js";

const ROOT = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
/** The generated `.d.ts` types the result `any`; name the shape once, here. */
const importFixture = (path: string) => importNetworkYaml(read(path)) as RawDocument;

const CROSS_4_YAML = "src-tauri/tests/fixtures/network/cross-4.yaml";
const CROSS_4_DOCUMENT = "src-tauri/tests/fixtures/golden/cross-4.document.json";
const CROSS_4_ZKAI = "src-tauri/tests/fixtures/golden/cross-4.zkai";

await init({
  module_or_path: readFileSync(new URL("src-tauri/pkg/zukai_lib_bg.wasm", ROOT)),
});

describe("the wasm network importer", () => {
  it("converts cross-4.yaml to the same document the Rust path does", () => {
    const doc = importFixture(CROSS_4_YAML);

    expect(doc).toEqual(JSON.parse(read(CROSS_4_DOCUMENT)));
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

describe("the wasm .zkai codec", () => {
  /**
   * **The phase's real assertion.** The document is the one this build's *own*
   * wasm importer produced, not a `JSON.parse` of the imported golden: chaining
   * the two functions is what the demo does when a visitor drops a network and
   * presses Save, and it is the strictly stronger test — it pins the JS→Rust
   * marshalling that a parsed golden would bypass.
   */
  it("encodes an imported network to the bytes the Rust path writes", () => {
    const zkai = encodeZkai(JSON.stringify(importFixture(CROSS_4_YAML)));

    expect(zkai).toBe(read(CROSS_4_ZKAI));
  });

  /** The other direction, closing the loop on the same two committed files. */
  it("decodes that .zkai back to the same document", () => {
    const doc = decodeZkai(read(CROSS_4_ZKAI)) as RawDocument;

    expect(doc).toEqual(JSON.parse(read(CROSS_4_DOCUMENT)));
  });

  /**
   * The version probe crosses too. A file from a newer build must arrive as the
   * friendly sentence, not as a serde error from deep inside `Document` — that
   * is the whole reason `decode` probes before it deserializes, and it would be
   * easy to lose by extracting the codec badly.
   */
  it("refuses a newer schema version with the readable message", () => {
    expect(() => decodeZkai("schema_version: 99\nmetadata:\n  name: Future\n")).toThrow(
      /newer version/,
    );
  });

  it("reports a file it cannot read at all", () => {
    expect(() => decodeZkai("this is not a document")).toThrow();
  });
});
