/**
 * The examples menu's two moving parts: what the glob actually matched, and how
 * a filename becomes a label.
 *
 * The first is the one that can fail silently. `import.meta.glob` resolves at
 * build time and a pattern matching **nothing** yields `{}` with no error — a
 * menu with no entries, a green build, and a demo that lost the only thing a
 * visitor with no checkout can open. So the key set is held against a
 * `readdirSync` of the directory itself, and both are required to be non-empty:
 * on an empty `examples/` the equality holds while asserting nothing.
 */

import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EXAMPLES, exampleLabel } from "./examples";

const EXAMPLES_DIR = fileURLToPath(new URL("../../examples", import.meta.url));

/** What is actually on disk, by stem — the glob's independent second reader. */
function committedStems(): string[] {
  return readdirSync(EXAMPLES_DIR)
    .filter((f) => f.endsWith(".zkai"))
    .map((f) => f.replace(/\.zkai$/, ""))
    .sort();
}

describe("the examples glob", () => {
  it("matches every committed .zkai, and there is at least one", () => {
    const stems = committedStems();

    // Non-emptiness is not padding: `{}` equals `[]` and tests nothing.
    expect(stems.length).toBeGreaterThan(0);
    expect(Object.keys(EXAMPLES)).toEqual(stems);
  });

  it("keys by bare stem, never by the glob's own path", () => {
    for (const stem of Object.keys(EXAMPLES)) {
      expect(stem).not.toContain("/");
      expect(stem).not.toMatch(/\.zkai$/);
    }
  });

  it("loads each one as a Zukai document", async () => {
    for (const [stem, load] of Object.entries(EXAMPLES)) {
      const text = await load();

      // `?raw`, so this is the file's own first line rather than a parsed
      // object — the codec is `Host.openDocumentText`'s job, not this module's.
      expect(text, stem).toMatch(/^schema_version:/);
    }
  });
});

describe("exampleLabel", () => {
  it("capitalises a one-word stem", () => {
    expect(exampleLabel("roundabout")).toBe("Roundabout");
  });

  it("reads hyphens as spaces, and capitalises only the first word", () => {
    expect(exampleLabel("signalized-cross")).toBe("Signalized cross");
    expect(exampleLabel("motorway-ramp")).toBe("Motorway ramp");
  });

  it("preserves interior case, so an initialism survives", () => {
    // The discriminating case: a lowercase-then-capitalise reads identically on
    // every filename this repo has today and mangles the first one that does not.
    expect(exampleLabel("ROUNDABOUT")).toBe("ROUNDABOUT");
  });
});
