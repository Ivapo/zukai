import { describe, expect, it } from "vitest";
import { RawDocument } from "../model/document";
import { initialState, reducer } from "./state";

describe("persistence actions", () => {
  it("loadDocument normalizes a sparse payload, clears dirty, sets currentPath", () => {
    const raw: RawDocument = { schema_version: 1, metadata: { name: "loaded" } };

    const next = reducer(initialState(), {
      type: "loadDocument",
      doc: raw,
      path: "/p/foo.zkai",
    });

    expect(next.dirty).toBe(false);
    expect(next.currentPath).toBe("/p/foo.zkai");
    expect(next.doc.metadata.name).toBe("loaded");
    // Normalized: empty collections/layout are present, not undefined.
    expect(next.doc.nodes).toEqual([]);
    expect(next.doc.layout).toEqual({ nodes: {}, links: {}, junctions: {}, signs: {} });
    // Selection/link/view are reset on load.
    expect(next.selection).toBeNull();
    expect(next.linkFrom).toBeNull();
    expect(next.view).toEqual({ tx: 0, ty: 0, k: 1 });
  });

  it("newDocument replaces the doc and clears path + dirty", () => {
    const dirty = { ...initialState(), dirty: true, currentPath: "/p/foo.zkai" };

    const next = reducer(dirty, { type: "newDocument" });

    expect(next.dirty).toBe(false);
    expect(next.currentPath).toBeNull();
    expect(next.doc.metadata.name).toBe("Untitled");
  });

  it("markSaved clears dirty and sets currentPath without touching the doc", () => {
    const start = { ...initialState(), dirty: true };

    const next = reducer(start, { type: "markSaved", path: "/p/bar.zkai" });

    expect(next.dirty).toBe(false);
    expect(next.currentPath).toBe("/p/bar.zkai");
    expect(next.doc).toBe(start.doc); // same reference
  });
});

describe("dirty tracking (document identity)", () => {
  it("an editing action that changes the document sets dirty", () => {
    const next = reducer(initialState(), { type: "addNode", pos: { x: 0, y: 0 } });

    expect(next.dirty).toBe(true);
    expect(next.doc.nodes).toHaveLength(1);
  });

  it("a no-op action (setTool) does not set dirty", () => {
    const next = reducer(initialState(), { type: "setTool", tool: "node" });

    expect(next.dirty).toBe(false);
    expect(next.tool).toBe("node");
  });

  it("an editing action that returns the doc unchanged does not set dirty", () => {
    // moveNode on a node with no layout entry returns state unchanged.
    const next = reducer(initialState(), {
      type: "moveNode",
      id: "missing",
      pos: { x: 5, y: 5 },
    });

    expect(next.dirty).toBe(false);
  });
});
