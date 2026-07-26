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
});
