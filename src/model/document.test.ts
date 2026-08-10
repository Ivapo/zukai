import { describe, expect, it } from "vitest";
import {
  emptyDocument,
  ensureExtension,
  ensureZkaiExtension,
  fileLabel,
  findJunction,
  normalizeDocument,
  RawDocument,
  withExtension,
} from "./document";
import { JunctionGlyph, SCHEMA_VERSION } from "./types";

describe("normalizeDocument", () => {
  it("fills every missing collection and layout sub-map (the load-crash case)", () => {
    // The minimal payload the loader can return: only the always-emitted fields.
    const raw = { schema_version: 1, metadata: { name: "x" } };

    const doc = normalizeDocument(raw);

    expect(doc.schema_version).toBe(1);
    expect(doc.metadata).toEqual({ name: "x" });
    expect(doc.nodes).toEqual([]);
    expect(doc.links).toEqual([]);
    expect(doc.junctions).toEqual([]);
    expect(doc.markings).toEqual([]);
    expect(doc.signs).toEqual([]);
    expect(doc.layout).toEqual({ nodes: {}, links: {}, junctions: {}, signs: {} });
  });

  it("keeps present sub-maps and fills only the missing ones", () => {
    const raw: RawDocument = {
      schema_version: SCHEMA_VERSION,
      metadata: { name: "partial" },
      nodes: [{ id: "N1", type: "endpoint" }],
      layout: { nodes: { N1: { pos: { x: 1, y: 2 } } } },
    };

    const doc = normalizeDocument(raw);

    expect(doc.nodes).toEqual([{ id: "N1", type: "endpoint" }]);
    expect(doc.layout.nodes).toEqual({ N1: { pos: { x: 1, y: 2 } } });
    expect(doc.layout.links).toEqual({});
    expect(doc.layout.junctions).toEqual({});
    expect(doc.layout.signs).toEqual({});
    expect(doc.links).toEqual([]);
  });
});

describe("findJunction", () => {
  /** Two junction-kind nodes, only one of which has a record. */
  function twoJunctions() {
    return {
      ...emptyDocument("j"),
      nodes: [
        { id: "N1", type: "junction" as const },
        { id: "N2", type: "junction" as const },
      ],
      junctions: [{ node_id: "N1", control: "signal" as const }],
    };
  }

  it("finds the record attached to a node, keyed by node_id", () => {
    expect(findJunction(twoJunctions(), "N1")).toEqual({
      node_id: "N1",
      control: "signal",
    });
  });

  /**
   * A junction-kind node with no record is not an error — it is what a
   * hand-edited file can carry, and what every writer guards on by identity.
   */
  it("returns undefined for a node with no record, junction-kind or not", () => {
    const doc = twoJunctions();
    expect(findJunction(doc, "N2")).toBeUndefined();
    expect(findJunction(doc, "N9")).toBeUndefined();
    expect(findJunction(emptyDocument("empty"), "N1")).toBeUndefined();
  });
});

describe("fileLabel", () => {
  it("returns 'Untitled' when there is no backing file", () => {
    expect(fileLabel(null)).toBe("Untitled");
  });

  it("returns the basename for POSIX and Windows paths", () => {
    expect(fileLabel("/home/ivan/roads/foo.zkai")).toBe("foo.zkai");
    expect(fileLabel("C:\\Users\\ivan\\foo.zkai")).toBe("foo.zkai");
  });
});

describe("ensureZkaiExtension", () => {
  it("appends .zkai to an extension-less name", () => {
    expect(ensureZkaiExtension("foo")).toBe("foo.zkai");
    expect(ensureZkaiExtension("/home/ivan/roads/foo")).toBe(
      "/home/ivan/roads/foo.zkai",
    );
  });

  it("leaves an existing extension alone", () => {
    expect(ensureZkaiExtension("foo.zkai")).toBe("foo.zkai");
    expect(ensureZkaiExtension("foo.yaml")).toBe("foo.yaml");
  });

  it("only considers the basename, not dots in parent directories", () => {
    expect(ensureZkaiExtension("/home/ivan/road.work/foo")).toBe(
      "/home/ivan/road.work/foo.zkai",
    );
  });
});

describe("ensureExtension", () => {
  it("adds the given extension, and honours any name the user typed", () => {
    expect(ensureExtension("drawing", "svg")).toBe("drawing.svg");
    // The deliberate one: an export named `.jpg` is written as `.jpg`, holding
    // SVG, rather than being renamed behind the user's back.
    expect(ensureExtension("drawing.jpg", "svg")).toBe("drawing.jpg");
    expect(ensureExtension("drawing.svg", "svg")).toBe("drawing.svg");
  });
});

describe("withExtension", () => {
  it("replaces an existing extension", () => {
    expect(withExtension("interchange.zkai", "svg")).toBe("interchange.svg");
    expect(withExtension("/home/ivan/roads/interchange.zkai", "svg")).toBe(
      "/home/ivan/roads/interchange.svg",
    );
  });

  it("adds one when there is none", () => {
    expect(withExtension("Untitled", "svg")).toBe("Untitled.svg");
    expect(withExtension("/home/ivan/road.work/foo", "svg")).toBe(
      "/home/ivan/road.work/foo.svg",
    );
  });

  it("treats a leading dot as part of the name, not an extension", () => {
    expect(withExtension(".hidden", "svg")).toBe(".hidden.svg");
  });

  it("replaces only the last extension of a multi-dotted name", () => {
    expect(withExtension("roads.v2.zkai", "svg")).toBe("roads.v2.svg");
  });
});

describe("JunctionGlyph", () => {
  /**
   * **The one durable check that the retired variant stays retired**, and the
   * reason it is written at all: a compile error is not an assertion. It
   * disappears the moment the code compiles, so a green `bun run build` proves
   * only that no *existing* reference to `t_junction` survived — it says nothing
   * about tomorrow. `@ts-expect-error` inverts that, because `tsc` fails when the
   * error it marks stops occurring. So putting the variant back in the union
   * breaks the build here rather than quietly restoring a control that cannot
   * change a pixel (junction glyphs §2.4).
   *
   * Rust still spells it, deliberately: `JunctionGlyph::TJunction` is load-only,
   * so an older `.zkai` parses and `load_document` hands this side a `generic`.
   */
  it("no longer admits t_junction", () => {
    // Retired because the pad follows its arms: a three-arm node draws as a T
    // because it *has* three arms, so the variant named a fact the arms carry.
    // @ts-expect-error — `t_junction` is no longer in the union.
    const retired: JunctionGlyph = "t_junction";

    expect(retired).toBe("t_junction");
  });
});
