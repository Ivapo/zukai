import { describe, expect, it } from "vitest";
import { findLink, nodePos, RawDocument } from "../model/document";
import { Action, EditorState, initialState, reducer } from "./state";

/** Apply a sequence of actions, as the UI would dispatch them. */
function run(state: EditorState, ...actions: Action[]): EditorState {
  return actions.reduce(reducer, state);
}

/** Two nodes joined by a link (`N1`→`N2`, `L1`), with `L1` selected. */
function twoNodesLinked(): EditorState {
  return run(
    initialState(),
    { type: "addNode", pos: { x: 0, y: 0 } },
    { type: "addNode", pos: { x: 10, y: 0 } },
    { type: "startLink", from: "N1" },
    { type: "completeLink", to: "N2" },
  );
}

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

  it("setRecents replaces the list but keeps state identity when unchanged", () => {
    const start = { ...initialState(), dirty: true };

    const next = reducer(start, {
      type: "setRecents",
      recents: ["/p/b.zkai", "/p/a.zkai"],
    });

    expect(next.recents).toEqual(["/p/b.zkai", "/p/a.zkai"]);
    expect(next.dirty).toBe(true); // recents say nothing about unsaved changes
    expect(next.doc).toBe(start.doc);

    // An identical list must not produce a new state: the menu is rebuilt off
    // this identity, and every save re-reports the same paths.
    const again = reducer(next, {
      type: "setRecents",
      recents: ["/p/b.zkai", "/p/a.zkai"],
    });
    expect(again).toBe(next);
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

describe("undo / redo", () => {
  it("undo restores the previous document and redo reinstates it", () => {
    const start = initialState();
    const added = reducer(start, { type: "addNode", pos: { x: 1, y: 2 } });
    expect(added.past).toEqual([start.doc]);

    const undone = reducer(added, { type: "undo" });
    expect(undone.doc).toBe(start.doc); // same reference, not a rebuilt copy
    expect(undone.doc.nodes).toHaveLength(0);
    expect(undone.past).toEqual([]);
    expect(undone.future).toEqual([added.doc]);
    expect(undone.dirty).toBe(true);

    const redone = reducer(undone, { type: "redo" });
    expect(redone.doc).toBe(added.doc);
    expect(redone.past).toEqual([start.doc]);
    expect(redone.future).toEqual([]);
  });

  it("a run of moveNode for one node is a single undo step", () => {
    const withNode = reducer(initialState(), {
      type: "addNode",
      pos: { x: 0, y: 0 },
    });

    // A drag: the leading select (dispatched by Canvas on pointer-down), then
    // one moveNode per pointer-move.
    const dragged = run(
      withNode,
      { type: "select", selection: { kind: "node", id: "N1" } },
      { type: "moveNode", id: "N1", pos: { x: 1, y: 0 } },
      { type: "moveNode", id: "N1", pos: { x: 2, y: 0 } },
      { type: "moveNode", id: "N1", pos: { x: 3, y: 0 } },
    );

    expect(nodePos(dragged.doc, "N1")).toEqual({ x: 3, y: 0 });
    expect(dragged.past).toHaveLength(2); // the empty doc, then the pre-drag doc

    const undone = reducer(dragged, { type: "undo" });
    expect(nodePos(undone.doc, "N1")).toEqual({ x: 0, y: 0 });
  });

  it("a select between two drags keeps them separate undo steps", () => {
    const withNode = reducer(initialState(), {
      type: "addNode",
      pos: { x: 0, y: 0 },
    });

    const dragged = run(
      withNode,
      { type: "moveNode", id: "N1", pos: { x: 1, y: 0 } },
      { type: "moveNode", id: "N1", pos: { x: 2, y: 0 } },
      { type: "select", selection: { kind: "node", id: "N1" } },
      { type: "moveNode", id: "N1", pos: { x: 3, y: 0 } },
      { type: "moveNode", id: "N1", pos: { x: 4, y: 0 } },
    );
    expect(dragged.past).toHaveLength(3);

    const once = reducer(dragged, { type: "undo" });
    expect(nodePos(once.doc, "N1")).toEqual({ x: 2, y: 0 });

    const twice = reducer(once, { type: "undo" });
    expect(nodePos(twice.doc, "N1")).toEqual({ x: 0, y: 0 });
  });

  it("two setLinkLanes clicks are two undo steps", () => {
    // The Lanes control is a ±1 stepper, so 1 → 3 is two deliberate edits and
    // undoes one at a time (spec §2.3a).
    const linked = twoNodesLinked();
    const bumped = run(
      linked,
      { type: "setLinkLanes", id: "L1", count: 2 },
      { type: "setLinkLanes", id: "L1", count: 3 },
    );
    expect(findLink(bumped.doc, "L1")!.lanes).toHaveLength(3);

    const once = reducer(bumped, { type: "undo" });
    expect(findLink(once.doc, "L1")!.lanes).toHaveLength(2);

    const twice = reducer(once, { type: "undo" });
    expect(findLink(twice.doc, "L1")!.lanes).toHaveLength(1);
  });

  it("a new edit after an undo clears the redo future", () => {
    const undone = run(
      initialState(),
      { type: "addNode", pos: { x: 0, y: 0 } },
      { type: "addNode", pos: { x: 5, y: 0 } },
      { type: "undo" },
    );
    expect(undone.future).toHaveLength(1);

    const edited = reducer(undone, { type: "addNode", pos: { x: 9, y: 9 } });
    expect(edited.future).toEqual([]);
  });

  it("undo and redo are identity no-ops at the ends of the stack", () => {
    const start = initialState();
    expect(reducer(start, { type: "undo" })).toBe(start);
    expect(reducer(start, { type: "redo" })).toBe(start);

    const added = reducer(start, { type: "addNode", pos: { x: 0, y: 0 } });
    expect(reducer(added, { type: "redo" })).toBe(added);

    const undone = reducer(added, { type: "undo" });
    expect(reducer(undone, { type: "undo" })).toBe(undone);
  });

  it("loadDocument and newDocument reset history", () => {
    const edited = run(
      initialState(),
      { type: "addNode", pos: { x: 0, y: 0 } },
      { type: "moveNode", id: "N1", pos: { x: 1, y: 1 } },
    );
    expect(edited.past.length).toBeGreaterThan(0);
    expect(edited.coalesceKey).not.toBeNull();

    const raw: RawDocument = { schema_version: 1, metadata: { name: "loaded" } };
    const loaded = reducer(edited, {
      type: "loadDocument",
      doc: raw,
      path: "/p/foo.zkai",
    });
    expect(loaded.past).toEqual([]);
    expect(loaded.future).toEqual([]);
    expect(loaded.coalesceKey).toBeNull();

    const fresh = reducer(edited, { type: "newDocument" });
    expect(fresh.past).toEqual([]);
    expect(fresh.future).toEqual([]);
    expect(fresh.coalesceKey).toBeNull();
  });

  it("markSaved leaves the history stacks alone", () => {
    const dragging = run(
      initialState(),
      { type: "addNode", pos: { x: 0, y: 0 } },
      { type: "moveNode", id: "N1", pos: { x: 1, y: 1 } },
    );

    const saved = reducer(dragging, { type: "markSaved", path: "/p/a.zkai" });

    expect(saved.past).toBe(dragging.past);
    expect(saved.future).toBe(dragging.future);
    expect(saved.coalesceKey).toBe(dragging.coalesceKey);
  });

  it("undo drops a selection the undone document no longer contains", () => {
    const added = reducer(initialState(), {
      type: "addNode",
      pos: { x: 0, y: 0 },
    });
    expect(added.selection).toEqual({ kind: "node", id: "N1" });

    const undone = reducer(added, { type: "undo" });
    expect(undone.selection).toBeNull();
    expect(undone.linkFrom).toBeNull();
  });

  it("undo keeps a selection whose element still exists", () => {
    const bumped = reducer(twoNodesLinked(), {
      type: "setLinkLanes",
      id: "L1",
      count: 2,
    });
    expect(bumped.selection).toEqual({ kind: "link", id: "L1" });

    const undone = reducer(bumped, { type: "undo" });
    expect(undone.selection).toEqual({ kind: "link", id: "L1" });
    expect(findLink(undone.doc, "L1")!.lanes).toHaveLength(1);
  });

  it("caps history depth, dropping the oldest snapshot", () => {
    const start = initialState();
    let state = start;
    for (let i = 0; i < 105; i++) {
      state = reducer(state, { type: "addNode", pos: { x: i, y: 0 } });
    }

    expect(state.past).toHaveLength(100);
    // The empty starting document has fallen off the bottom; the oldest kept
    // snapshot is the one with five nodes already drawn.
    expect(state.past).not.toContain(start.doc);
    expect(state.past[0].nodes).toHaveLength(5);
  });
});
