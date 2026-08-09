import { describe, expect, it } from "vitest";
import { findJunction, findLink, nodePos, RawDocument } from "../model/document";
import { SCHEMA_VERSION, SignKind } from "../model/types";
import {
  Action,
  EditorState,
  initialState,
  reducer,
  TurnArrowKind,
  turnArrowKind,
} from "./state";

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

  it("importDocument installs the network dirty and pathless", () => {
    const raw: RawDocument = {
      schema_version: 1,
      metadata: { name: "Editor Network" },
    };
    const open = { ...initialState(), currentPath: "/p/foo.zkai" };

    const next = reducer(open, { type: "importDocument", doc: raw });

    // The two that differ from `loadDocument`, and the reason the action exists:
    // a `network.yaml` is not a save target, so Save must ask for a `.zkai`.
    expect(next.dirty).toBe(true);
    expect(next.currentPath).toBeNull();
    // Everything else it inherits: normalized, and reset around the boundary.
    expect(next.doc.metadata.name).toBe("Editor Network");
    expect(next.doc.nodes).toEqual([]);
    expect(next.doc.layout).toEqual({ nodes: {}, links: {}, junctions: {}, signs: {} });
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

describe("lane kinds", () => {
  /** `L1` with `n` lanes, lane 0 marked a hard shoulder. */
  function shouldered(n: number): EditorState {
    return run(
      twoNodesLinked(),
      { type: "setLinkLanes", id: "L1", count: n },
      { type: "setLaneKind", id: "L1", lane: 0, kind: "shoulder" },
    );
  }

  it("classifies one lane and leaves every other alone", () => {
    const state = run(
      twoNodesLinked(),
      { type: "setLinkLanes", id: "L1", count: 3 },
      { type: "setLaneKind", id: "L1", lane: 1, kind: "bus" },
    );
    const lanes = findLink(state.doc, "L1")!.lanes;

    expect(lanes.map((l) => l.kind)).toEqual([undefined, "bus", undefined]);
    // Nothing else about the lane moved.
    expect(lanes[1].id).toBe(1);
    expect(lanes[1].width).toBe(3.5);
  });

  /**
   * `general` is stored as an *absent* `kind`, not as the string: that is the
   * one representation `defaultLane` produces and the one Rust writes back
   * (`skip_serializing_if = "Option::is_none"`). Two encodings of a plain lane
   * would differ by document identity and dirty a file for no visible change.
   */
  it("stores general as no kind at all, not as a string", () => {
    const back = reducer(shouldered(2), {
      type: "setLaneKind",
      id: "L1",
      lane: 0,
      kind: "general",
    });
    const lane = findLink(back.doc, "L1")!.lanes[0];

    expect(lane.kind).toBeUndefined();
    // Absent, not present-and-undefined: what serializes is the key, not the value.
    expect("kind" in lane).toBe(false);
  });

  it("is a no-op, by identity, for an unknown link or a lane out of range", () => {
    const start = twoNodesLinked();

    for (const action of [
      { type: "setLaneKind", id: "L9", lane: 0, kind: "bus" },
      { type: "setLaneKind", id: "L1", lane: 4, kind: "bus" },
      { type: "setLaneKind", id: "L1", lane: -1, kind: "bus" },
    ] as Action[]) {
      const next = reducer(start, action);
      expect(next.doc).toBe(start.doc);
      expect(next.dirty).toBe(start.dirty);
    }
  });

  it("is one undo step, restoring the kind the lane had before", () => {
    const bus = run(
      shouldered(2),
      { type: "setLaneKind", id: "L1", lane: 1, kind: "bus" },
    );
    expect(findLink(bus.doc, "L1")!.lanes.map((l) => l.kind)).toEqual([
      "shoulder",
      "bus",
    ]);

    const once = reducer(bus, { type: "undo" });
    expect(findLink(once.doc, "L1")!.lanes.map((l) => l.kind)).toEqual([
      "shoulder",
      undefined,
    ]);

    const twice = reducer(once, { type: "undo" });
    expect(findLink(twice.doc, "L1")!.lanes.map((l) => l.kind)).toEqual([
      undefined,
      undefined,
    ]);
  });

  /**
   * The reason this belongs to the same phase as the control. `setLinkLanes`
   * used to rebuild the array from `defaultLane` on every ±1 click, so the
   * moment a kind was settable, the Lanes stepper two controls above silently
   * discarded it (road spec §2.5).
   */
  it("survives the Lanes stepper growing the count", () => {
    const grown = reducer(shouldered(2), {
      type: "setLinkLanes",
      id: "L1",
      count: 4,
    });
    const lanes = findLink(grown.doc, "L1")!.lanes;

    expect(lanes).toHaveLength(4);
    expect(lanes[0].kind).toBe("shoulder");
    // The lanes appended are ordinary ones, indexed on from the survivors.
    expect(lanes.slice(1).map((l) => l.kind)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(lanes.map((l) => l.id)).toEqual([0, 1, 2, 3]);
  });

  it("survives the count shrinking past the lanes above it", () => {
    const shrunk = reducer(shouldered(4), {
      type: "setLinkLanes",
      id: "L1",
      count: 1,
    });
    const lanes = findLink(shrunk.doc, "L1")!.lanes;

    expect(lanes).toHaveLength(1);
    expect(lanes[0].kind).toBe("shoulder");
  });

  /** A hand-edited or imported width rides along with the kind. */
  it("preserves a non-default lane width across a count change", () => {
    const wide = twoNodesLinked();
    const doc = {
      ...wide.doc,
      links: wide.doc.links.map((l) => ({
        ...l,
        lanes: [{ ...l.lanes[0], width: 5.25 }],
      })),
    };

    const grown = reducer(
      { ...wide, doc },
      { type: "setLinkLanes", id: "L1", count: 3 },
    );
    const lanes = findLink(grown.doc, "L1")!.lanes;

    expect(lanes[0].width).toBe(5.25);
    expect(lanes.slice(1).map((l) => l.width)).toEqual([3.5, 3.5]);
  });

  /** Removing a lane removes its data; growing back does not resurrect it. */
  it("does not bring back a lane the user actually removed", () => {
    const gone = run(
      twoNodesLinked(),
      { type: "setLinkLanes", id: "L1", count: 2 },
      { type: "setLaneKind", id: "L1", lane: 1, kind: "bus" },
      { type: "setLinkLanes", id: "L1", count: 1 },
      { type: "setLinkLanes", id: "L1", count: 2 },
    );

    expect(findLink(gone.doc, "L1")!.lanes[1].kind).toBeUndefined();
  });
});

describe("link alignment", () => {
  /** `L1`'s layout entry, which alignment is stored on. */
  function view(state: EditorState) {
    return state.doc.layout.links.L1;
  }

  it("sets an alignment without disturbing the road class", () => {
    const set = reducer(twoNodesLinked(), {
      type: "setLinkAlign",
      id: "L1",
      align: "offside",
    });

    expect(view(set)).toEqual({ style: "arterial", align: "offside" });
    expect(set.dirty).toBe(true);
  });

  /**
   * `centre` is stored as an *absent* `align`, the same rule `setLaneKind`
   * follows for `general`: it is what a fresh link carries and what Rust writes
   * back (`skip_serializing_if = "LinkAlign::is_centre"`), so a second encoding
   * of a centred link would differ by document identity while saving to the
   * same bytes.
   */
  it("stores centre as no key at all, not as a string", () => {
    const back = run(
      twoNodesLinked(),
      { type: "setLinkAlign", id: "L1", align: "nearside" },
      { type: "setLinkAlign", id: "L1", align: "centre" },
    );

    expect(view(back).align).toBeUndefined();
    expect("align" in view(back)).toBe(false);
    // …and the rest of the entry survives the round trip untouched.
    expect(view(back)).toEqual({ style: "arterial" });
  });

  it("is one undo step, restoring the alignment the link had before", () => {
    const flipped = run(
      twoNodesLinked(),
      { type: "setLinkAlign", id: "L1", align: "nearside" },
      { type: "setLinkAlign", id: "L1", align: "offside" },
    );
    expect(view(flipped).align).toBe("offside");

    const once = reducer(flipped, { type: "undo" });
    expect(view(once).align).toBe("nearside");

    const twice = reducer(once, { type: "undo" });
    expect(view(twice).align).toBeUndefined();
  });

  /** A link with no layout entry — imported, or hand-edited — still aligns. */
  it("creates a layout entry for a link that has none", () => {
    const linked = twoNodesLinked();
    const bare = {
      ...linked,
      doc: { ...linked.doc, layout: { ...linked.doc.layout, links: {} } },
    };

    const set = reducer(bare, { type: "setLinkAlign", id: "L1", align: "offside" });

    expect(view(set)).toEqual({ style: "arterial", align: "offside" });
  });
});

/**
 * How long a road says it is (link-length spec Phase 1) — the one field in the
 * document whose whole design is that it is **decoupled** from the drawing, so
 * two of the tests below assert on references rather than on values.
 */
describe("the length a link states", () => {
  /** `L1` itself, which the length is stored on — the semantic graph, not the
   *  layout, because a length is a fact about the road rather than about paper. */
  function link(state: EditorState) {
    return state.doc.links[0];
  }

  it("states a length, in metres, on the link itself", () => {
    const start = twoNodesLinked();
    const set = reducer(start, { type: "setLinkLength", id: "L1", length: 1800 });

    expect(link(set).length).toBe(1800);
    expect(set.dirty).toBe(true);
    // Nothing else about the road came with it — the lanes are the same array.
    expect(link(set).lanes).toBe(link(start).lanes);
  });

  /**
   * Absent is the one representation, and here it is also the whole meaning: a
   * road that states no length is not a road of length zero. `setMarkingLane`'s
   * rule, and what keeps a document that says nothing byte-identical on save.
   */
  it("clears back to no key at all, not to a zero", () => {
    const back = run(
      twoNodesLinked(),
      { type: "setLinkLength", id: "L1", length: 1800 },
      { type: "setLinkLength", id: "L1" },
    );

    expect(link(back).length).toBeUndefined();
    expect("length" in link(back)).toBe(false);
  });

  /** Typing `1800` is four keystrokes and one undo step; clearing the field is a
   *  separate edit, the carve-out `markingText`'s key already takes. */
  it("collapses a typed length into one undo step, and clearing into another", () => {
    const typed = run(
      twoNodesLinked(),
      { type: "setLinkLength", id: "L1", length: 1 },
      { type: "setLinkLength", id: "L1", length: 18 },
      { type: "setLinkLength", id: "L1", length: 180 },
      { type: "setLinkLength", id: "L1", length: 1800 },
    );
    expect(link(typed).length).toBe(1800);

    const cleared = reducer(typed, { type: "setLinkLength", id: "L1" });
    expect(link(reducer(cleared, { type: "undo" })).length).toBe(1800);
    expect(link(run(cleared, { type: "undo" }, { type: "undo" })).length).toBeUndefined();
  });

  /**
   * **The first half of the invariant** (§2.2): dragging a node changes the
   * picture and leaves the label alone. Asserted by reference on the link, since
   * `moveNode` writes only `doc.layout.nodes` — a version that rebuilt `doc.links`
   * would pass any value assertion and still hand history a fresh array.
   */
  it("survives a node drag untouched, by reference", () => {
    const stated = reducer(twoNodesLinked(), {
      type: "setLinkLength",
      id: "L1",
      length: 1800,
    });

    const dragged = reducer(stated, {
      type: "moveNode",
      id: "N2",
      pos: { x: 40, y: 40 },
    });

    // The drawing moved...
    expect(dragged.doc.layout.nodes.N2.pos).toEqual({ x: 40, y: 40 });
    // ...and the road's own record of itself did not, down to the array holding it.
    expect(dragged.doc.links).toBe(stated.doc.links);
    expect(link(dragged).length).toBe(1800);
  });

  /**
   * **The second half, and the one this action could break** (§2.2): editing the
   * label leaves the drawing alone. `doc.layout` is where every drawn position
   * lives, so an untouched layout *is* an untouched drawing — and it is the
   * assertable form, `drawnPolyline` minting a fresh array on every call.
   */
  it("leaves the whole layout identical by reference", () => {
    const start = twoNodesLinked();

    const stated = reducer(start, { type: "setLinkLength", id: "L1", length: 1800 });
    expect(stated.doc.layout).toBe(start.doc.layout);

    // Both directions of the field, since only one of them rewrites the entry.
    const changed = reducer(stated, { type: "setLinkLength", id: "L1", length: 1500 });
    expect(changed.doc.layout).toBe(start.doc.layout);
    expect(reducer(changed, { type: "setLinkLength", id: "L1" }).doc.layout).toBe(
      start.doc.layout,
    );
  });

  /** A no-op arm has to return the document by identity, or `recordHistory`
   *  pushes a snapshot for a change that never happened. */
  it("dispatches nothing to the document for a value that is not a length", () => {
    const start = twoNodesLinked();

    for (const length of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(reducer(start, { type: "setLinkLength", id: "L1", length }).doc).toBe(
        start.doc,
      );
    }
    // And a link that is not there.
    expect(reducer(start, { type: "setLinkLength", id: "L9", length: 1800 }).doc).toBe(
      start.doc,
    );
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

  it("every whole-document install resets history", () => {
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

    // An import is a file boundary too — so the work it replaces is protected by
    // the unsaved-changes prompt in `files.ts`, not by an undo.
    const imported = reducer(edited, { type: "importDocument", doc: raw });
    expect(imported.past).toEqual([]);
    expect(imported.future).toEqual([]);
    expect(imported.coalesceKey).toBeNull();
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

describe("markings", () => {
  /**
   * `twoNodesLinked` with `n` lanes and a stop line placed on `lane` — `"all"`
   * for the whole carriageway. A sentinel rather than `undefined`, which a
   * default parameter would silently replace with lane 0.
   */
  function painted(n = 3, lane: number | "all" = 0): EditorState {
    return run(
      twoNodesLinked(),
      { type: "setLinkLanes", id: "L1", count: n },
      {
        type: "addMarking",
        link: "L1",
        position: 20,
        lane: lane === "all" ? undefined : lane,
      },
    );
  }

  it("mints a stop_line on the link, and selects it", () => {
    const state = painted();

    expect(state.doc.markings).toEqual([
      { id: "M1", link: "L1", position: 20, lane: 0, kind: { type: "stop_line" } },
    ]);
    expect(state.selection).toEqual({ kind: "marking", id: "M1" });
    expect(state.dirty).toBe(true);
  });

  /**
   * `lane` absent means the whole carriageway, and is **omitted** rather than
   * stored as `undefined` — the one-representation rule `setLaneKind` follows for
   * `general` and `setLinkAlign` for `centre`, matching Rust's
   * `skip_serializing_if = "Option::is_none"`.
   */
  it("stores a carriageway-wide marking as no lane key at all", () => {
    const marking = painted(3, "all").doc.markings[0];

    expect(marking.lane).toBeUndefined();
    expect("lane" in marking).toBe(false);
  });

  it("mints ids one past the highest already in use", () => {
    const two = run(painted(), {
      type: "addMarking",
      link: "L1",
      position: 30,
      lane: 2,
    });

    expect(two.doc.markings.map((m) => m.id)).toEqual(["M1", "M2"]);
  });

  it("is a no-op, by identity, on a link that does not exist", () => {
    const start = twoNodesLinked();
    const next = reducer(start, { type: "addMarking", link: "L9", position: 5 });

    expect(next.doc).toBe(start.doc);
    expect(next.dirty).toBe(start.dirty);
  });

  it("is undoable like any other edit", () => {
    const undone = reducer(painted(), { type: "undo" });

    expect(undone.doc.markings).toEqual([]);
    expect(reducer(undone, { type: "redo" }).doc.markings).toHaveLength(1);
  });

  /**
   * A document that never placed one still has an empty array — the byte-level
   * elision is Rust serde's `skip_serializing_if = "Vec::is_empty"`, already
   * covered by the persistence tests. This is the TypeScript-side half.
   */
  it("leaves markings empty in a document that never placed one", () => {
    expect(initialState().doc.markings).toEqual([]);
    expect(twoNodesLinked().doc.markings).toEqual([]);
  });

  describe("a marking does not outlive its road", () => {
    it("goes with the link it is painted on", () => {
      const gone = run(
        painted(),
        { type: "select", selection: { kind: "link", id: "L1" } },
        { type: "deleteSelection" },
      );

      expect(gone.doc.links).toEqual([]);
      expect(gone.doc.markings).toEqual([]);
    });

    it("goes with a node whose deletion takes the link with it", () => {
      const gone = run(
        painted(),
        { type: "select", selection: { kind: "node", id: "N2" } },
        { type: "deleteSelection" },
      );

      expect(gone.doc.links).toEqual([]);
      expect(gone.doc.markings).toEqual([]);
      // The other node is untouched: only the incident links and their paint go.
      expect(gone.doc.nodes.map((n) => n.id)).toEqual(["N1"]);
    });

    it("survives a node deletion that does not remove its link", () => {
      const other = run(
        painted(),
        { type: "addNode", pos: { x: 50, y: 50 } },
        { type: "select", selection: { kind: "node", id: "N3" } },
        { type: "deleteSelection" },
      );

      expect(other.doc.markings).toHaveLength(1);
    });

    /**
     * **Dropped, not clamped to a surviving lane.** A marking that silently moved
     * to a different lane is worse than one that goes away, because the drawing
     * still looks deliberate (markings spec §2.5) — the same class of bug the
     * Lanes stepper already had with `Lane.kind`.
     */
    it("goes when the lane count shrinks past its lane", () => {
      const shrunk = reducer(painted(4, 3), {
        type: "setLinkLanes",
        id: "L1",
        count: 2,
      });

      expect(shrunk.doc.markings).toEqual([]);
    });

    it("stays when the lane count shrinks but not past it", () => {
      const shrunk = reducer(painted(4, 1), {
        type: "setLinkLanes",
        id: "L1",
        count: 2,
      });

      expect(shrunk.doc.markings).toHaveLength(1);
      expect(shrunk.doc.markings[0].lane).toBe(1);
    });

    it("keeps a carriageway-wide marking through any lane count", () => {
      const shrunk = reducer(painted(4, "all"), {
        type: "setLinkLanes",
        id: "L1",
        count: 1,
      });

      expect(shrunk.doc.markings).toHaveLength(1);
    });

    it("leaves markings on other links alone", () => {
      const two = run(
        painted(),
        { type: "addNode", pos: { x: 20, y: 20 } },
        { type: "startLink", from: "N2" },
        { type: "completeLink", to: "N3" },
        { type: "addMarking", link: "L2", position: 5 },
        { type: "select", selection: { kind: "link", id: "L1" } },
        { type: "deleteSelection" },
      );

      expect(two.doc.markings.map((m) => m.link)).toEqual(["L2"]);
    });
  });

  /**
   * The three failures of markings spec §2.6, **none of which is a build error**.
   * Every id is a bare `type X = string`, so `MarkingId` and `LinkId` are the
   * same type, and the four sites that narrow on `Selection` all did so with a
   * binary `if`/ternary whose `else` was an implicit fall-through. The new arm
   * compiled clean and misrouted silently.
   */
  describe("the third Selection arm, which the compiler does not police", () => {
    it("survives undo and redo (selectionValid)", () => {
      const state = run(painted(), { type: "setLinkLanes", id: "L1", count: 4 });
      // Re-select the marking: the lane bump selected nothing, but the stepper
      // pushed a snapshot to undo back over.
      const selected = reducer(state, {
        type: "select",
        selection: { kind: "marking", id: "M1" },
      });

      const undone = reducer(selected, { type: "undo" });
      expect(undone.selection).toEqual({ kind: "marking", id: "M1" });

      const redone = reducer(undone, { type: "redo" });
      expect(redone.selection).toEqual({ kind: "marking", id: "M1" });
    });

    it("drops the selection when the undo removes the marking", () => {
      const undone = reducer(painted(), { type: "undo" });

      expect(undone.doc.markings).toEqual([]);
      expect(undone.selection).toBeNull();
    });

    it("deletes exactly the marking, leaving nodes and links untouched", () => {
      const start = painted();
      const gone = reducer(start, { type: "deleteSelection" });

      expect(gone.doc.markings).toEqual([]);
      expect(gone.doc.nodes).toBe(start.doc.nodes);
      expect(gone.doc.links).toBe(start.doc.links);
      expect(gone.doc.layout).toBe(start.doc.layout);
      expect(gone.selection).toBeNull();
    });

    /**
     * Without an explicit arm this took the **node** branch, which filters
     * nothing out and still returns a freshly built `doc` — dirtying the document
     * and pushing an undo snapshot while deleting nothing.
     */
    it("does not dirty the document when the marking is already gone", () => {
      const stale: EditorState = {
        ...twoNodesLinked(),
        selection: { kind: "marking", id: "M7" },
        dirty: false,
        past: [],
      };

      const next = reducer(stale, { type: "deleteSelection" });

      expect(next.doc).toBe(stale.doc);
      expect(next.dirty).toBe(false);
      expect(next.past).toEqual([]);
      // The stale selection is cleared even so — there is nothing to point at.
      expect(next.selection).toBeNull();
    });
  });

  /** The Inspector's Kind picker and Span control (markings spec Phase 2). */
  describe("what a marking paints, and what it spans", () => {
    it("repaints a marking without moving it or changing what it spans", () => {
      const next = reducer(painted(3, 1), {
        type: "setMarkingKind",
        id: "M1",
        kind: { type: "crosswalk" },
      });

      expect(next.doc.markings[0]).toEqual({
        id: "M1",
        link: "L1",
        position: 20,
        lane: 1,
        kind: { type: "crosswalk" },
      });
      expect(next.dirty).toBe(true);
    });

    /**
     * The absent-key case, which a spread preserves only because the action never
     * names `lane`: writing `{ ...m, lane: m.lane, kind }` would give a
     * carriageway-wide marking an explicit `undefined` and a second encoding of
     * itself, which saves to the same bytes but differs by document identity.
     */
    it("leaves a carriageway-wide marking carriageway-wide across a repaint", () => {
      const marking = reducer(painted(3, "all"), {
        type: "setMarkingKind",
        id: "M1",
        kind: { type: "give_way_line" },
      }).doc.markings[0];

      expect("lane" in marking).toBe(false);
      expect(marking.kind).toEqual({ type: "give_way_line" });
    });

    it("carries a kind's own payload, so no second action sets it", () => {
      const marking = reducer(painted(), {
        type: "setMarkingKind",
        id: "M1",
        kind: { type: "turn_arrow", directions: ["left", "through"] },
      }).doc.markings[0];

      expect(marking.kind).toEqual({
        type: "turn_arrow",
        directions: ["left", "through"],
      });

      // The same for text, which is the fourth payload to ride this one action
      // and the fourth phase to add no action of its own (signs spec Phase 1).
      const lettered = reducer(painted(), {
        type: "setMarkingKind",
        id: "M1",
        kind: { type: "text", content: "BUS" },
      }).doc.markings[0];

      expect(lettered.kind).toEqual({ type: "text", content: "BUS" });
      expect(lettered.position).toBe(20);
      expect(lettered.lane).toBe(0);
    });

    /**
     * The two-headed arrow's merge (markings spec Phase 5), and it is asserted
     * **here rather than through the reducer** for the reason that made it a
     * function at all: `setMarkingKind` faithfully stores whatever payload it is
     * handed, so a case dispatching a hand-built payload passes whether or not
     * the panel was ever amended. The defect lives in what the panel *builds* —
     * a fresh `{ type, directions }` literal, wiping `back` on every forward
     * toggle — and no layer closer to it is reachable from `environment: "node"`.
     */
    describe("turnArrowKind", () => {
      const two: TurnArrowKind = {
        type: "turn_arrow",
        directions: ["left"],
        back: ["left"],
      };

      it("preserves the array it is not given", () => {
        expect(turnArrowKind(two, { directions: ["left", "through"] })).toEqual({
          type: "turn_arrow",
          directions: ["left", "through"],
          back: ["left"],
        });

        expect(turnArrowKind(two, { back: ["through"] })).toEqual({
          type: "turn_arrow",
          directions: ["left"],
          back: ["through"],
        });
      });

      /**
       * Emptying the back control is the only route back to a single-headed
       * arrow, and it has to leave a document that saves byte-identically to one
       * that never had a rear head — so the key goes, rather than becoming an
       * empty array Rust would elide anyway. Absent is the one representation,
       * as it is for a marking's `lane`.
       */
      it("drops the key when the rear head is emptied", () => {
        const single = turnArrowKind(two, { back: [] });

        expect("back" in single).toBe(false);
        expect(single).toEqual({ type: "turn_arrow", directions: ["left"] });
      });

      it("leaves a single-headed arrow single-headed", () => {
        const one: TurnArrowKind = { type: "turn_arrow", directions: ["through"] };
        const next = turnArrowKind(one, { directions: ["through", "right"] });

        expect("back" in next).toBe(false);
        expect(next).toEqual({
          type: "turn_arrow",
          directions: ["through", "right"],
        });
      });
    });

    /**
     * **Typing is one undo step, not one per letter** (signs spec Phase 1). The
     * text field dispatches a whole `setMarkingKind` per keystroke so the paint
     * follows the typing, which without a coalesce key would burn a snapshot on
     * every character of every word.
     *
     * Both halves are asserted, because the interesting one is the boundary: the
     * empty payload the Kind picker mints stays *outside* the run, so undoing
     * after picking Text and typing clears the word rather than the repaint.
     */
    it("collapses a typed run into one undo step, but not the pick before it", () => {
      const type = (state: EditorState, content: string) =>
        reducer(state, {
          type: "setMarkingKind",
          id: "M1",
          kind: { type: "text", content },
        });

      const picked = type(painted(), "");
      const typed = ["B", "BU", "BUS"].reduce(type, picked);
      expect(typed.doc.markings[0].kind).toEqual({ type: "text", content: "BUS" });

      // One undo clears the word and leaves a text marking behind.
      const once = reducer(typed, { type: "undo" });
      expect(once.doc.markings[0].kind).toEqual({ type: "text", content: "" });
      // A second gets back the kind the picker replaced — so the pick and the
      // typing are two steps, not one and not four.
      expect(reducer(once, { type: "undo" }).doc.markings[0].kind).toEqual({
        type: "stop_line",
      });
    });

    /**
     * The deliberate route to `lane: undefined`, which placement can otherwise
     * reach only by clicking the 1.5-unit casing lip (§2.4). **Absent, never
     * `undefined`** — the one-representation rule every optional field follows.
     */
    it("spans the whole carriageway, and back to a lane, without moving", () => {
      const wide = reducer(painted(3, 2), {
        type: "setMarkingLane",
        id: "M1",
        lane: undefined,
      });
      expect("lane" in wide.doc.markings[0]).toBe(false);
      expect(wide.doc.markings[0].position).toBe(20);

      const narrow = reducer(wide, { type: "setMarkingLane", id: "M1", lane: 0 });
      expect(narrow.doc.markings[0].lane).toBe(0);
      expect(narrow.doc.markings[0].position).toBe(20);
      expect(narrow.doc.markings[0].kind).toEqual({ type: "stop_line" });
    });

    it("is undoable a step at a time, like every other deliberate click", () => {
      const wide = reducer(painted(3, 2), {
        type: "setMarkingLane",
        id: "M1",
        lane: undefined,
      });
      const back = reducer(wide, { type: "setMarkingLane", id: "M1", lane: 1 });

      expect(reducer(back, { type: "undo" }).doc.markings[0].lane).toBeUndefined();
      expect(
        reducer(reducer(back, { type: "undo" }), { type: "undo" }).doc.markings[0]
          .lane,
      ).toBe(2);
    });

    /**
     * Both no-ops matter **by identity**: a rebuilt `doc` that changed nothing
     * dirties the file and pushes an undo snapshot, which is the trap
     * `rules/history.md` names.
     */
    it("is a no-op, by identity, on a marking that is not there", () => {
      const start = painted();
      for (const action of [
        { type: "setMarkingKind", id: "M9", kind: { type: "crosswalk" } },
        { type: "setMarkingLane", id: "M9", lane: 1 },
      ] as const) {
        expect(reducer(start, action).doc).toBe(start.doc);
      }
    });

    it("is a no-op on a lane the link does not have", () => {
      const start = painted(2, 0);

      expect(reducer(start, { type: "setMarkingLane", id: "M1", lane: 2 }).doc).toBe(
        start.doc,
      );
      expect(reducer(start, { type: "setMarkingLane", id: "M1", lane: -1 }).doc).toBe(
        start.doc,
      );
    });
  });

  /**
   * Which end of the road the distance is measured from (lane arrows §2.3.1) —
   * the field that lets auto-placed paint survive a node being dragged.
   */
  describe("which end a marking measures from", () => {
    it("anchors to the end, and back to the start, without moving or repainting", () => {
      const end = reducer(painted(3, 1), {
        type: "setMarkingAnchor",
        id: "M1",
        anchor: "end",
      });

      expect(end.doc.markings[0]).toEqual({
        id: "M1",
        link: "L1",
        position: 20,
        anchor: "end",
        lane: 1,
        kind: { type: "stop_line" },
      });
      expect(end.dirty).toBe(true);

      const back = reducer(end, { type: "setMarkingAnchor", id: "M1", anchor: "start" });
      expect("anchor" in back.doc.markings[0]).toBe(false);
      expect(back.doc.markings[0].position).toBe(20);
    });

    /**
     * **Absent, never `"start"`** — the one-representation rule, and Rust's
     * `skip_serializing_if = "LinkEnd::is_start"` is the other half of it.
     */
    it("mints no anchor key on a fresh marking", () => {
      expect("anchor" in painted().doc.markings[0]).toBe(false);
    });

    it("is undoable a step at a time, like every other deliberate click", () => {
      const end = reducer(painted(), { type: "setMarkingAnchor", id: "M1", anchor: "end" });

      expect(reducer(end, { type: "undo" }).doc.markings[0].anchor).toBeUndefined();
      expect(reducer(reducer(end, { type: "undo" }), { type: "redo" }).doc.markings[0]
        .anchor).toBe("end");
    });

    /**
     * **The guard has to normalize before it compares.** A start-anchored marking
     * carries no key at all, so `marking.anchor === anchor` is `undefined ===
     * "start"` — false — and re-clicking Start would dirty the document and push
     * a snapshot for a click that changed nothing.
     */
    it("is a no-op, by identity, on the anchor already in force", () => {
      const start = painted();
      expect(
        reducer(start, { type: "setMarkingAnchor", id: "M1", anchor: "start" }).doc,
      ).toBe(start.doc);

      const end = reducer(start, { type: "setMarkingAnchor", id: "M1", anchor: "end" });
      expect(reducer(end, { type: "setMarkingAnchor", id: "M1", anchor: "end" }).doc).toBe(
        end.doc,
      );
    });

    it("is a no-op, by identity, on a marking that is not there", () => {
      const start = painted();

      expect(
        reducer(start, { type: "setMarkingAnchor", id: "M9", anchor: "end" }).doc,
      ).toBe(start.doc);
    });
  });

  /**
   * The missing verb (lane arrows §2.2): a marking could be created, repainted,
   * re-spanned and deleted, and not **moved**. The canvas projects the pointer
   * onto the road and dispatches the result, so what is asserted here is what the
   * reducer owes that gesture.
   */
  describe("dragging a marking", () => {
    it("writes both where it sits and what it spans", () => {
      const moved = reducer(painted(3, 0), {
        type: "moveMarking",
        id: "M1",
        position: 42,
        lane: 2,
      });

      expect(moved.doc.markings[0]).toEqual({
        id: "M1",
        link: "L1",
        position: 42,
        lane: 2,
        kind: { type: "stop_line" },
      });
      expect(moved.dirty).toBe(true);
    });

    /**
     * Dragging out onto the casing lip widens the marking to the whole
     * carriageway, and stores that as an **absent key** — `setMarkingLane`'s
     * shape, not an explicit `undefined` that saves to the same bytes and differs
     * by document identity.
     */
    it("drops the lane key when a drag lands on no lane", () => {
      const wide = reducer(painted(3, 1), {
        type: "moveMarking",
        id: "M1",
        position: 25,
        lane: undefined,
      });

      expect("lane" in wide.doc.markings[0]).toBe(false);
      expect(wide.doc.markings[0].position).toBe(25);
    });

    /**
     * **The identity return `moveNode` and `moveSign` do not have.** Both of those
     * rebuild unconditionally; a drag dispatches on every pointer-move, including
     * the ones that resolve to the place the marking already occupies, and without
     * this the document is dirtied and a snapshot pushed for a gesture that
     * changed nothing.
     */
    it("is a no-op, by identity, on a drag that lands where it already is", () => {
      const start: EditorState = { ...painted(3, 1), dirty: false, past: [] };
      const next = reducer(start, {
        type: "moveMarking",
        id: "M1",
        position: 20,
        lane: 1,
      });

      expect(next.doc).toBe(start.doc);
      expect(next.dirty).toBe(false);
      expect(next.past).toEqual([]);
    });

    it("is a no-op, by identity, on a marking that is not there", () => {
      const start = painted();
      const next = reducer(start, {
        type: "moveMarking",
        id: "M9",
        position: 5,
        lane: 0,
      });

      expect(next.doc).toBe(start.doc);
      expect(next.dirty).toBe(start.dirty);
    });

    /**
     * The third drag key, `markingDrag:<id>` (`rules/history.md`). A drag is one
     * gesture and must undo as one, and **the leading `select` is what opens it**:
     * `onMarkingPointerDown` dispatches it on pointer-down, which leaves `doc`
     * alone and so resets `coalesceKey`, making move #1 push and #2…N replace.
     */
    it("collapses a run of drags into one undo step", () => {
      const dragged = run(
        painted(3, 0),
        { type: "select", selection: { kind: "marking", id: "M1" } },
        { type: "moveMarking", id: "M1", position: 21, lane: 0 },
        { type: "moveMarking", id: "M1", position: 24, lane: 1 },
        { type: "moveMarking", id: "M1", position: 30, lane: 2 },
      );

      expect(dragged.doc.markings[0].position).toBe(30);
      expect(dragged.doc.markings[0].lane).toBe(2);

      // One undo gets back the whole drag, not its last pointer-move.
      const undone = reducer(dragged, { type: "undo" });
      expect(undone.doc.markings[0].position).toBe(20);
      expect(undone.doc.markings[0].lane).toBe(0);
    });

    it("keeps two drags separate when a select comes between them", () => {
      const dragged = run(
        painted(3, 0),
        { type: "moveMarking", id: "M1", position: 21, lane: 0 },
        { type: "moveMarking", id: "M1", position: 24, lane: 0 },
        { type: "select", selection: { kind: "marking", id: "M1" } },
        { type: "moveMarking", id: "M1", position: 30, lane: 0 },
        { type: "moveMarking", id: "M1", position: 33, lane: 0 },
      );

      const once = reducer(dragged, { type: "undo" });
      expect(once.doc.markings[0].position).toBe(24);

      const twice = reducer(once, { type: "undo" });
      expect(twice.doc.markings[0].position).toBe(20);
    });

    /**
     * A drag never re-homes a marking to another road — the action carries no
     * `link`, and the canvas projects onto the one the marking already names.
     */
    it("leaves the road it is painted on alone", () => {
      const start = painted(3, 0);
      const moved = reducer(start, { type: "moveMarking", id: "M1", position: 42 });

      expect(moved.doc.markings[0].link).toBe("L1");
      // The road and its layout are untouched, by reference: a drag moves paint,
      // never the road under it (markings spec OQ-6 stays open either way).
      expect(moved.doc.links).toBe(start.doc.links);
      expect(moved.doc.layout).toBe(start.doc.layout);
    });
  });
});

describe("signs", () => {
  /** `twoNodesLinked` with one sign standing beside the road, freshly selected. */
  function signed(): EditorState {
    return run(twoNodesLinked(), { type: "addSign", pos: { x: 40, y: 30 } });
  }

  /**
   * Placement is **{@link addNode}'s shape, not {@link addMarking}'s** (signs spec
   * §2.5): both halves are written from the click alone, with no lane and no
   * arc-length derived from it — and the layout entry is a **bare `Vec2`**, not
   * the `{ pos }` wrapper a node's is.
   */
  it("stands a sign where the pointer was, in both halves of the document", () => {
    const state = signed();

    expect(state.doc.signs).toEqual([
      { id: "S1", kind: { type: "custom", label: "" } },
    ]);
    expect(state.doc.layout.signs).toEqual({ S1: { x: 40, y: 30 } });
    // Absent, never `undefined` — the representation rule every optional field
    // here follows, matching Rust's `skip_serializing_if`.
    expect("associated_link" in state.doc.signs[0]).toBe(false);
    expect(state.selection).toEqual({ kind: "sign", id: "S1" });
    expect(state.dirty).toBe(true);
  });

  it("mints ids from the signs already there", () => {
    const two = run(signed(), { type: "addSign", pos: { x: 0, y: 0 } });

    expect(two.doc.signs.map((s) => s.id)).toEqual(["S1", "S2"]);
  });

  it("is undoable across both halves at once", () => {
    const undone = reducer(signed(), { type: "undo" });
    expect(undone.doc.signs).toEqual([]);
    expect(undone.doc.layout.signs).toEqual({});

    const redone = reducer(undone, { type: "redo" });
    expect(redone.doc.signs).toHaveLength(1);
    expect(redone.doc.layout.signs.S1).toEqual({ x: 40, y: 30 });
  });

  /**
   * **A drag is one undo step**, the rule `moveNode` already follows: the canvas
   * dispatches one `moveSign` per pointer-move, and without a key in
   * `coalesceKeyFor` a single drag would burn a snapshot per frame.
   */
  it("collapses a run of moveSign into a single undo step", () => {
    const start = signed();
    const dragged = run(
      start,
      { type: "select", selection: { kind: "sign", id: "S1" } },
      { type: "moveSign", id: "S1", pos: { x: 41, y: 30 } },
      { type: "moveSign", id: "S1", pos: { x: 42, y: 30 } },
      { type: "moveSign", id: "S1", pos: { x: 43, y: 30 } },
    );

    expect(dragged.doc.layout.signs.S1).toEqual({ x: 43, y: 30 });
    // Exactly one snapshot more than before the drag: the pre-drag document.
    expect(dragged.past).toHaveLength(start.past.length + 1);

    const undone = reducer(dragged, { type: "undo" });
    expect(undone.doc.layout.signs.S1).toEqual({ x: 40, y: 30 });
  });

  it("deletes exactly the sign, from both halves, and nothing else", () => {
    const start = signed();
    const gone = reducer(start, { type: "deleteSelection" });

    expect(gone.doc.signs).toEqual([]);
    expect(gone.doc.layout.signs).toEqual({});
    expect(gone.doc.nodes).toBe(start.doc.nodes);
    expect(gone.doc.links).toBe(start.doc.links);
    expect(gone.doc.layout.nodes).toBe(start.doc.layout.nodes);
    expect(gone.selection).toBeNull();
  });

  /**
   * The identity trap `rules/history.md` names, and the sign arm has **two**
   * places to rebuild rather than one — so it has to check before touching either.
   */
  it("does not dirty the document when the sign is already gone", () => {
    const stale: EditorState = {
      ...twoNodesLinked(),
      selection: { kind: "sign", id: "S7" },
      dirty: false,
      past: [],
    };

    const next = reducer(stale, { type: "deleteSelection" });

    expect(next.doc).toBe(stale.doc);
    expect(next.dirty).toBe(false);
    expect(next.past).toEqual([]);
    // The stale selection is cleared even so — there is nothing to point at.
    expect(next.selection).toBeNull();
  });

  /**
   * **The fourth `Selection` arm, and this time the compiler helped.** Both sites
   * that used to fail silently — `selectionValid` and `deleteSelection` — are
   * `switch`es with `default: return unreachable(sel)`, so this arm was a build
   * error until it was handled (markings spec §2.6's payoff). The behaviour is
   * asserted anyway: it is what the compile error was protecting.
   */
  it("survives undo and redo (selectionValid)", () => {
    const state = run(signed(), { type: "setLinkLanes", id: "L1", count: 2 });
    const selected = reducer(state, {
      type: "select",
      selection: { kind: "sign", id: "S1" },
    });

    const undone = reducer(selected, { type: "undo" });
    expect(undone.selection).toEqual({ kind: "sign", id: "S1" });

    const redone = reducer(undone, { type: "redo" });
    expect(redone.selection).toEqual({ kind: "sign", id: "S1" });
  });

  it("drops the selection when undo takes the sign away", () => {
    expect(reducer(signed(), { type: "undo" }).selection).toBeNull();
  });

  it("repaints a sign as another kind, keeping what it names", () => {
    const named = run(
      signed(),
      { type: "setSignLink", id: "S1", link: "L1" },
      { type: "setSignKind", id: "S1", kind: { type: "speed_limit", kph: 50 } },
    );

    expect(named.doc.signs[0].kind).toEqual({ type: "speed_limit", kph: 50 });
    expect(named.doc.signs[0].associated_link).toBe("L1");
  });

  it("clears associated_link by dropping the key, never by storing undefined", () => {
    const cleared = run(
      signed(),
      { type: "setSignLink", id: "S1", link: "L1" },
      { type: "setSignLink", id: "S1" },
    );

    expect("associated_link" in cleared.doc.signs[0]).toBe(false);
  });

  it("is a no-op, by identity, on a sign or a link that is not there", () => {
    const start = run(signed(), { type: "setSignLink", id: "S1", link: "L1" });
    for (const action of [
      { type: "moveSign", id: "S9", pos: { x: 1, y: 1 } },
      { type: "setSignKind", id: "S9", kind: { type: "stop" } },
      { type: "setSignLink", id: "S9", link: "L1" },
      { type: "setSignLink", id: "S1", link: "L9" },
    ] as const) {
      expect(reducer(start, action).doc).toBe(start.doc);
    }
  });

  /**
   * Typing is one undo step, the rule signs Phase 1 established for the Words
   * field. The boundary is the interesting half again — but it falls out
   * differently here: the empty label arrives from `addSign`, a different action,
   * so the placement is outside the run without the carve-out doing anything. The
   * one below is where the carve-out earns its keep.
   */
  it("collapses a typed label into one undo step, but not the placement", () => {
    const type = (state: EditorState, label: string) =>
      reducer(state, {
        type: "setSignKind",
        id: "S1",
        kind: { type: "custom", label },
      });

    const typed = ["T", "TO", "TOLL"].reduce(type, signed());
    expect(typed.doc.signs[0].kind).toEqual({ type: "custom", label: "TOLL" });

    // One undo clears the word and leaves the sign standing.
    const once = reducer(typed, { type: "undo" });
    expect(once.doc.signs[0].kind).toEqual({ type: "custom", label: "" });
    // A second removes the sign itself — so the placement and the typing are two
    // steps, not one and not four.
    expect(reducer(once, { type: "undo" }).doc.signs).toEqual([]);
  });

  /**
   * **What the empty carve-out was written for** (signs Phase 3). The Kind picker
   * mints `warning { symbol: "" }` through the *same* action the Symbol field
   * types with, so without the carve-out the first keystroke would replace the
   * pick and one undo would jump back past a kind change the user can see.
   *
   * A key per field, not per sign: the two text fields belong to different kinds
   * and switching between them is itself a pick, so the runs stay distinguishable.
   */
  it("keeps a picked kind out of the run of typing that follows it", () => {
    const picked = reducer(signed(), {
      type: "setSignKind",
      id: "S1",
      kind: { type: "warning", symbol: "" },
    });
    const typed = ["b", "be", "bend"].reduce(
      (state, symbol) =>
        reducer(state, {
          type: "setSignKind",
          id: "S1",
          kind: { type: "warning", symbol },
        }),
      picked,
    );

    expect(typed.doc.signs[0].kind).toEqual({ type: "warning", symbol: "bend" });
    const once = reducer(typed, { type: "undo" });
    expect(once.doc.signs[0].kind).toEqual({ type: "warning", symbol: "" });
    // The pick is its own step, so the second undo lands on the plate the sign
    // was placed as rather than on nothing at all.
    expect(reducer(once, { type: "undo" }).doc.signs[0].kind).toEqual({
      type: "custom",
      label: "",
    });
  });

  /**
   * The **fourth** key, and the last the sign vocabulary needs (signs Phase 4).
   * Asserted separately from the Symbol run above rather than folded into it,
   * because "a key per field, not per sign" is the claim: the two runs have to stay
   * *distinguishable*, which one test typing into both fields could not show.
   */
  it("gives a typed destination a run of its own, apart from the label's", () => {
    const kinded = (state: EditorState, kind: SignKind) =>
      reducer(state, { type: "setSignKind", id: "S1", kind });

    const picked = kinded(signed(), { type: "direction", text: "" });
    const typed = ["M", "M4", "M4 W"].reduce(
      (state, text) => kinded(state, { type: "direction", text }),
      picked,
    );
    expect(typed.doc.signs[0].kind).toEqual({ type: "direction", text: "M4 W" });

    // One undo clears the destination; a second lands on the pick's own step.
    const once = reducer(typed, { type: "undo" });
    expect(once.doc.signs[0].kind).toEqual({ type: "direction", text: "" });
    expect(reducer(once, { type: "undo" }).doc.signs[0].kind).toEqual({
      type: "custom",
      label: "",
    });

    // **The two fields never share a run.** Typing a label and then a destination
    // is a pick apart, so the label's word survives its own undo rather than being
    // swallowed by the destination's.
    const labelled = ["T", "TO", "TOLL"].reduce(
      (state, label) => kinded(state, { type: "custom", label }),
      signed(),
    );
    const redirected = ["M", "M4"].reduce(
      (state, text) => kinded(state, { type: "direction", text }),
      kinded(labelled, { type: "direction", text: "" }),
    );
    expect(redirected.doc.signs[0].kind).toEqual({ type: "direction", text: "M4" });
    // The destination run, then the pick — two steps, and the label is whole under
    // them. Sharing one key would have collapsed all three into one.
    const back = [1, 2].reduce((state) => reducer(state, { type: "undo" }), redirected);
    expect(back.doc.signs[0].kind).toEqual({ type: "custom", label: "TOLL" });
  });

  /**
   * **The cascade, in the other direction** (§2.5). A marking cannot outlive its
   * road because nothing draws one whose link is gone; a sign is free-standing, so
   * a deleted road must clear the reference and leave the sign exactly where it
   * stood. Both delete arms, because the node arm strands the same reference.
   */
  describe("a sign outlives the road it names", () => {
    /** `signed()` with `S1` pointing at `L1`. */
    function named(): EditorState {
      return run(signed(), { type: "setSignLink", id: "S1", link: "L1" });
    }

    it("keeps the sign and clears the field when the link goes", () => {
      const gone = run(
        named(),
        { type: "select", selection: { kind: "link", id: "L1" } },
        { type: "deleteSelection" },
      );

      expect(gone.doc.links).toEqual([]);
      expect(gone.doc.signs).toHaveLength(1);
      expect("associated_link" in gone.doc.signs[0]).toBe(false);
      // Its position is untouched: nothing about a sign depended on the road.
      expect(gone.doc.layout.signs.S1).toEqual({ x: 40, y: 30 });
    });

    it("clears it through a node whose deletion takes the link with it", () => {
      const gone = run(
        named(),
        { type: "select", selection: { kind: "node", id: "N2" } },
        { type: "deleteSelection" },
      );

      expect(gone.doc.signs).toHaveLength(1);
      expect("associated_link" in gone.doc.signs[0]).toBe(false);
      expect(gone.doc.layout.signs.S1).toEqual({ x: 40, y: 30 });
    });

    /**
     * **The identity half, which no behavioural assertion sees.** Clearing a field
     * is a `map` where dropping a marking is a `filter`, so `keepMarkings`'s
     * same-length trick does not transfer — `clearSignLinks` has to check first.
     * Without it, every link deletion in a document with signs hands history a
     * fresh array to stop sharing.
     */
    it("hands back the same array when no sign named the deleted link", () => {
      const before = run(
        named(),
        { type: "addNode", pos: { x: 80, y: 80 } },
        { type: "startLink", from: "N2" },
        { type: "completeLink", to: "N3" },
        { type: "select", selection: { kind: "link", id: "L2" } },
      );

      const after = reducer(before, { type: "deleteSelection" });

      expect(after.doc.signs[0].associated_link).toBe("L1");
      expect(after.doc.signs).toBe(before.doc.signs);
    });
  });
});

/**
 * The two fields that make a junction *mean* something. Until this phase nothing
 * had ever written `control` after `setNodeKind` minted it, so a drawing with
 * signal heads sat over a document that said the junction was uncontrolled
 * (junction semantics §1).
 */
describe("junction control and rule", () => {
  /** `N1`, made a junction — so `{control: "unsignalized"}` and a `generic` glyph. */
  function junction(): EditorState {
    return run(
      initialState(),
      { type: "addNode", pos: { x: 0, y: 0 } },
      { type: "setNodeKind", id: "N1", kind: "junction" },
    );
  }

  it("writes control, and is one undo step", () => {
    const signal = reducer(junction(), {
      type: "setJunctionControl",
      id: "N1",
      control: "signal",
    });
    expect(findJunction(signal.doc, "N1")!.control).toBe("signal");
    expect(signal.dirty).toBe(true);

    const back = reducer(signal, { type: "undo" });
    expect(findJunction(back.doc, "N1")!.control).toBe("unsignalized");
  });

  /**
   * §2.2's nudge: the *default* glyph follows the control, in both directions, so
   * the common case is correct with nothing to read.
   */
  it("moves a default glyph to the signalised cross, and back", () => {
    const signal = reducer(junction(), {
      type: "setJunctionControl",
      id: "N1",
      control: "signal",
    });
    expect(signal.doc.layout.junctions.N1.glyph).toBe("signalized_cross");

    const back = reducer(signal, {
      type: "setJunctionControl",
      id: "N1",
      control: "unsignalized",
    });
    expect(back.doc.layout.junctions.N1.glyph).toBe("generic");
    // The nudge writes the glyph and nothing else about the view.
    expect(back.doc.layout.junctions.N1).toEqual({
      glyph: "generic",
      rotation: 0,
      scale: 1,
    });
  });

  /**
   * **The assertion that can actually fail.** A glyph the human picked is a
   * deliberate schematic choice — a signalised roundabout is a real thing — and
   * the nudge must never overwrite one, in either direction.
   */
  it("leaves a chosen glyph alone, through control off and on", () => {
    const chosen = run(junction(), {
      type: "setJunctionGlyph",
      id: "N1",
      glyph: "roundabout",
    });

    const toggled = run(
      chosen,
      { type: "setJunctionControl", id: "N1", control: "signal" },
      { type: "setJunctionControl", id: "N1", control: "unsignalized" },
    );

    expect(toggled.doc.layout.junctions.N1.glyph).toBe("roundabout");
    // And the view object itself was never rebuilt on the way through.
    expect(toggled.doc.layout.junctions).toBe(chosen.doc.layout.junctions);
  });

  /** `graph.rs`: `rule` is `None` when signalized, so signalising drops it. */
  it("drops a rule that was set when the junction is signalised", () => {
    const signal = run(
      junction(),
      { type: "setJunctionRule", id: "N1", rule: "priority" },
      { type: "setJunctionControl", id: "N1", control: "signal" },
    );
    const j = findJunction(signal.doc, "N1")!;

    expect(j.control).toBe("signal");
    // Absent, not present-and-undefined: what serializes is the key.
    expect("rule" in j).toBe(false);
  });

  it("keeps a rule when handing the junction back to give-way control", () => {
    const back = run(
      junction(),
      { type: "setJunctionRule", id: "N1", rule: "all_way_stop" },
      { type: "setJunctionControl", id: "N1", control: "signal" },
      { type: "setJunctionRule", id: "N1", rule: "priority_right" },
      { type: "setJunctionControl", id: "N1", control: "unsignalized" },
    );

    // The rule set while signalized is unreachable from the panel, but nothing
    // about coming back invents or destroys one — `control` is all that changed.
    expect(findJunction(back.doc, "N1")!.rule).toBe("priority_right");
  });

  it("stores a cleared rule as no key at all, not as undefined", () => {
    const cleared = run(
      junction(),
      { type: "setJunctionRule", id: "N1", rule: "priority" },
      { type: "setJunctionRule", id: "N1", rule: undefined },
    );
    const j = findJunction(cleared.doc, "N1")!;

    expect(j.rule).toBeUndefined();
    expect("rule" in j).toBe(false);
  });

  it("sets each rule in turn, one undo step apiece", () => {
    const state = run(
      junction(),
      { type: "setJunctionRule", id: "N1", rule: "priority" },
      { type: "setJunctionRule", id: "N1", rule: "priority_right" },
    );
    expect(findJunction(state.doc, "N1")!.rule).toBe("priority_right");

    const once = reducer(state, { type: "undo" });
    expect(findJunction(once.doc, "N1")!.rule).toBe("priority");

    const twice = reducer(once, { type: "undo" });
    expect("rule" in findJunction(twice.doc, "N1")!).toBe(false);
  });

  /**
   * Re-picking the active segment must return `doc` **by identity**, or
   * `recordHistory` takes a snapshot for a document nothing changed in
   * (`rules/history.md`). `undefined === undefined` is what makes the second of
   * these hold for "None" on a junction that has no rule.
   */
  it("is a no-op, by identity, on a junction already in the target state", () => {
    const start = junction();

    for (const action of [
      { type: "setJunctionControl", id: "N1", control: "unsignalized" },
      { type: "setJunctionRule", id: "N1", rule: undefined },
    ] as Action[]) {
      const next = reducer(start, action);
      expect(next.doc).toBe(start.doc);
      expect(next.dirty).toBe(start.dirty);
    }

    const priority = run(start, {
      type: "setJunctionRule",
      id: "N1",
      rule: "priority",
    });
    const again = reducer(priority, {
      type: "setJunctionRule",
      id: "N1",
      rule: "priority",
    });
    expect(again.doc).toBe(priority.doc);
  });

  /**
   * The hand-edited file: a junction-kind node carrying no `Junction` record.
   * Both actions return `state` itself rather than minting one, and the panel
   * renders no Control row for it.
   */
  it("is a no-op, by identity, on a junction-kind node with no record", () => {
    const raw: RawDocument = {
      schema_version: SCHEMA_VERSION,
      metadata: { name: "hand-edited" },
      nodes: [{ id: "N1", type: "junction" }],
      layout: { nodes: { N1: { pos: { x: 0, y: 0 } } } },
    };
    const start = reducer(initialState(), {
      type: "loadDocument",
      doc: raw,
      path: "/p/hand.zkai",
    });
    expect(start.doc.junctions).toEqual([]);

    for (const action of [
      { type: "setJunctionControl", id: "N1", control: "signal" },
      { type: "setJunctionRule", id: "N1", rule: "priority" },
      { type: "setJunctionControl", id: "N9", control: "signal" },
    ] as Action[]) {
      const next = reducer(start, action);
      expect(next.doc).toBe(start.doc);
      expect(next.dirty).toBe(false);
    }
  });

  /**
   * A junction with no `layout.junctions` entry — the other hand-edited case.
   * The nudge reads it as `generic`, which is what the renderer and the panel
   * already do, and `setJunctionView` creates the view it lacked.
   */
  it("treats a junction with no view as generic, and creates one", () => {
    const raw: RawDocument = {
      schema_version: SCHEMA_VERSION,
      metadata: { name: "hand-edited" },
      nodes: [{ id: "N1", type: "junction" }],
      junctions: [{ node_id: "N1", control: "unsignalized" }],
      layout: { nodes: { N1: { pos: { x: 0, y: 0 } } } },
    };
    const start = reducer(initialState(), {
      type: "loadDocument",
      doc: raw,
      path: "/p/hand.zkai",
    });
    expect(start.doc.layout.junctions).toEqual({});

    const signal = reducer(start, {
      type: "setJunctionControl",
      id: "N1",
      control: "signal",
    });

    expect(signal.doc.layout.junctions.N1).toEqual({
      glyph: "signalized_cross",
      rotation: 0,
      scale: 1,
    });
  });

  /** Neither action touches any other junction's record. */
  it("leaves every other junction alone", () => {
    const two = run(
      junction(),
      { type: "addNode", pos: { x: 50, y: 0 } },
      { type: "setNodeKind", id: "N2", kind: "junction" },
    );

    const next = run(
      two,
      { type: "setJunctionControl", id: "N1", control: "signal" },
      { type: "setJunctionRule", id: "N2", rule: "priority" },
    );

    expect(findJunction(next.doc, "N1")).toEqual({
      node_id: "N1",
      control: "signal",
    });
    expect(findJunction(next.doc, "N2")).toEqual({
      node_id: "N2",
      control: "unsignalized",
      rule: "priority",
    });
    expect(next.doc.layout.junctions.N2.glyph).toBe("generic");
  });
});
