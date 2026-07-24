import { describe, expect, it } from "vitest";
import {
  ensureZkaiExtension,
  fileLabel,
  normalizeDocument,
  RawDocument,
} from "./document";
import { SCHEMA_VERSION } from "./types";

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
