/** Editor state and the reducer that drives all document edits. */

import {
  DEFAULT_LINK_STYLE,
  defaultLane,
  emptyDocument,
  findJunction,
  findLink,
  findMarking,
  findNode,
  findSign,
  nextId,
  normalizeDocument,
  RawDocument,
} from "../model/document";
import {
  Document,
  Junction,
  JunctionControl,
  JunctionGlyph,
  LaneIdx,
  LaneKind,
  LinkAlign,
  LinkEnd,
  LinkId,
  LinkStyle,
  Marking,
  MarkingId,
  MarkingKind,
  NodeId,
  NodeKind,
  Sign,
  SignId,
  SignKind,
  TurnDirection,
  UnsignalizedRule,
  Vec2,
} from "../model/types";
import { IDENTITY_VIEW, ViewTransform } from "./geometry";

/** The active drawing tool. */
export type Tool = "select" | "node" | "link" | "marking" | "sign";

/**
 * What is currently selected on the canvas.
 *
 * **The fifth arm is shaped differently from the four before it, and that is the
 * whole modelling question** (link bends §2.2). `LinkView.bends` is a `Vec2[]`: a
 * bend has no id and cannot cheaply be given one, since an id would be a new
 * model field in both mirrors, serialized into every document, to name something
 * whose only identity is *where it sits in the route*. So a bend is named by its
 * link and its index.
 *
 * **An index is not a stable handle**, and the rule that makes it safe is stated
 * rather than assumed: a `bend` selection is only ever minted by the gesture that
 * just placed or grabbed that bend, and **any action that changes a link's bend
 * count clears the selection**. {@link deleteSelection} already clears;
 * {@link addBend} replaces it with the bend it inserted. Dragging does not change
 * the count, so a drag holds.
 *
 * Undo is the case that rule does not reach, and {@link restore} is where it is
 * answered: a stale-but-in-range index is still *valid*, and names a different
 * bend — the one failure {@link selectionValid} cannot see.
 */
export type Selection =
  | { kind: "node"; id: NodeId }
  | { kind: "link"; id: LinkId }
  | { kind: "marking"; id: MarkingId }
  | { kind: "sign"; id: SignId }
  | { kind: "bend"; link: LinkId; index: number };

/** The complete editor state. */
export interface EditorState {
  doc: Document;
  view: ViewTransform;
  tool: Tool;
  selection: Selection | null;
  /** Node the in-progress link starts from, while the link tool is drawing. */
  linkFrom: NodeId | null;
  /** Unsaved changes exist since the last save/load/new. */
  dirty: boolean;
  /** File backing the document (`null` = never saved). */
  currentPath: string | null;
  /** Recently opened/saved paths, most recent first; owned by the Rust store. */
  recents: string[];
  /** Snapshots older than `doc`, oldest first; the last is one undo back. */
  past: Document[];
  /** Snapshots undone from, newest-undo first; the first is one redo forward. */
  future: Document[];
  /**
   * The gesture the current top-of-`past` belongs to, so a continuous drag
   * collapses to one entry; `null` = no open gesture. See {@link recordHistory}.
   */
  coalesceKey: string | null;
}

/** Lane count a freshly drawn link starts with. */
const NEW_LINK_LANES = 1;

/** How many snapshots `past` keeps; the oldest is dropped past this. */
const HISTORY_LIMIT = 100;

/** The initial state: one empty, unnamed schematic. */
export function initialState(): EditorState {
  return {
    doc: emptyDocument("Untitled"),
    view: IDENTITY_VIEW,
    tool: "select",
    selection: null,
    linkFrom: null,
    dirty: false,
    currentPath: null,
    recents: [],
    past: [],
    future: [],
    coalesceKey: null,
  };
}

/** Every edit to the document or view the UI can request. */
export type EditAction =
  | { type: "setTool"; tool: Tool }
  | { type: "setView"; view: ViewTransform }
  | { type: "addNode"; pos: Vec2 }
  | { type: "moveNode"; id: NodeId; pos: Vec2 }
  | { type: "setNodeKind"; id: NodeId; kind: NodeKind }
  | { type: "setJunctionGlyph"; id: NodeId; glyph: JunctionGlyph }
  | { type: "setJunctionScale"; id: NodeId; scale: number }
  | { type: "setJunctionControl"; id: NodeId; control: JunctionControl }
  // `rule?`, not `rule: UnsignalizedRule | null`: absent is the one
  // representation, the rule `setSignLink`'s `link?` already follows.
  | { type: "setJunctionRule"; id: NodeId; rule?: UnsignalizedRule }
  | { type: "startLink"; from: NodeId }
  | { type: "completeLink"; to: NodeId }
  | { type: "cancelLink" }
  | { type: "setLinkLanes"; id: LinkId; count: number }
  | { type: "setLaneKind"; id: LinkId; lane: LaneIdx; kind: LaneKind }
  | { type: "setLinkStyle"; id: LinkId; style: LinkStyle }
  | { type: "setLinkAlign"; id: LinkId; align: LinkAlign }
  // `length?`, not `length: number | null`: absent is the one representation,
  // and here it is also the whole meaning — a road that states no length. The
  // rule `setMarkingLane`'s `lane?` already follows.
  | { type: "setLinkLength"; id: LinkId; length?: number }
  // `index` is the **layout** polyline's segment index, which is also the new
  // vertex's index in `bends` — a polyline is `[from, ...bends, to]`. It comes
  // out of `geometry.ts:bendInsertion`, together with `pos`, and taking either
  // from anywhere else puts a spike in the road (link bends §2.6).
  | { type: "addBend"; link: LinkId; index: number; pos: Vec2 }
  | { type: "moveBend"; link: LinkId; index: number; pos: Vec2 }
  | { type: "addMarking"; link: LinkId; position: number; lane?: LaneIdx }
  | { type: "setMarkingKind"; id: MarkingId; kind: MarkingKind }
  | { type: "setMarkingLane"; id: MarkingId; lane?: LaneIdx }
  // Required, not `anchor?`: the Rust field is a defaulted enum rather than an
  // `Option`, so `start` is a value the caller names and the *reducer* is what
  // stores it as an absent key — `setLinkAlign`'s shape, not `setMarkingLane`'s.
  | { type: "setMarkingAnchor"; id: MarkingId; anchor: LinkEnd }
  // Both fields at once, because a drag writes both: the lane already falls out
  // of the click that *places* a marking, and a drag that crossed a divider
  // without changing lanes would be the surprising reading (lane arrows §2.2).
  // No `link` — a marking is dragged **along its own road**, never onto another.
  | { type: "moveMarking"; id: MarkingId; position: number; lane?: LaneIdx }
  | { type: "addSign"; pos: Vec2 }
  | { type: "moveSign"; id: SignId; pos: Vec2 }
  | { type: "setSignKind"; id: SignId; kind: SignKind }
  // `link?`, not `link: LinkId | null`: **absent is the one representation** for
  // an optional field, the rule `setMarkingLane`'s `lane?` already follows.
  | { type: "setSignLink"; id: SignId; link?: LinkId }
  | { type: "select"; selection: Selection | null }
  | { type: "deleteSelection" };

/** Whole-document lifecycle actions; they manage `dirty`/`currentPath` explicitly. */
export type PersistAction =
  | { type: "loadDocument"; doc: RawDocument; path: string }
  // No `path`, and that is the whole difference from `loadDocument`: a
  // `network.yaml` is not a `.zkai`, so the import arrives **dirty and pathless**
  // and Save asks for a new file rather than writing back over Assimilator's.
  | { type: "importDocument"; doc: RawDocument }
  | { type: "newDocument" }
  | { type: "markSaved"; path: string }
  | { type: "setRecents"; recents: string[] };

/** Undo/redo over the document; a third arm so {@link editReducer} still narrows. */
export type HistoryAction = { type: "undo" } | { type: "redo" };

/** Every action the UI can dispatch. */
export type Action = EditAction | PersistAction | HistoryAction;

/**
 * Apply an action, returning the next state (never mutates `state`).
 *
 * Persistence actions set `dirty`/`currentPath` explicitly, as do `undo`/`redo`
 * (§2.5 of the undo spec). Editing actions run through {@link editReducer} and
 * then {@link recordHistory}, which sets `dirty` by **document identity** — the
 * reducer's immutable updates change `doc`'s reference iff it actually changed,
 * so no-op actions (`setTool`, a `moveNode` on a missing node, …) never dirty —
 * and pushes the undo snapshot in the same decision.
 */
export function reducer(state: EditorState, action: Action): EditorState {
  switch (action.type) {
    case "loadDocument":
      return install(state, normalizeDocument(action.doc), action.path, false);

    // Dirty from the first frame, and with no path to save back to: the file it
    // came from belongs to another program and another format. Everything else —
    // the history reset included — it inherits from `loadDocument`, because an
    // import is a file boundary like any other.
    case "importDocument":
      return install(state, normalizeDocument(action.doc), null, true);

    case "newDocument":
      return install(state, emptyDocument("Untitled"), null, false);

    // `markSaved`/`setRecents` say nothing about document content, so they leave
    // all three history fields — `coalesceKey` included — untouched.
    case "markSaved":
      return { ...state, dirty: false, currentPath: action.path };

    case "setRecents":
      // Every save/open pushes the path and dispatches the store's reply, which
      // is usually the list we already hold. Returning `state` unchanged in that
      // case keeps the identity stable, so the menu is not rebuilt for nothing.
      return sameList(state.recents, action.recents)
        ? state
        : { ...state, recents: action.recents };

    case "undo":
      return state.past.length === 0
        ? state
        : restore(
            state,
            state.past[state.past.length - 1],
            state.past.slice(0, -1),
            [state.doc, ...state.future],
          );

    case "redo":
      return state.future.length === 0
        ? state
        : restore(
            state,
            state.future[0],
            pushPast(state.past, state.doc),
            state.future.slice(1),
          );

    default: {
      const next = editReducer(state, action);
      return recordHistory(state, next, coalesceKeyFor(action));
    }
  }
}

/**
 * Install a whole document, the one shape all three of New / Open / Import take:
 * everything about the *old* document goes, because none of it means anything
 * against the new one. History included — there is nothing to undo across a file
 * boundary (`rules/history.md`), and it is the unsaved-changes guard in
 * `files.ts`, not the undo stack, that protects the work being replaced.
 *
 * Only `currentPath` and `dirty` differ between the three, so they are the
 * arguments; each caller says which above.
 */
function install(
  state: EditorState,
  doc: Document,
  currentPath: string | null,
  dirty: boolean,
): EditorState {
  return {
    ...state,
    doc,
    currentPath,
    dirty,
    selection: null,
    linkFrom: null,
    view: IDENTITY_VIEW,
    past: [],
    future: [],
    coalesceKey: null,
  };
}

/** Element-wise equality of two path lists. */
function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((p, i) => p === b[i]);
}

/**
 * The gesture an editing action belongs to, or `null` for a discrete edit that
 * must never merge with its neighbours. A node drag dispatches one `moveNode`
 * per pointer-move, so those collapse per node; deliberate clicks (a ±1 lane
 * stepper, say) are separate edits and each get their own undo step.
 *
 * **Four drags**, since link bends Phase 2 gave a road a vertex to move:
 * `moveNode`, `moveSign`, `moveMarking` and the bend drag. The third is keyed
 * `markingDrag:<id>` rather than `moveMarking:<id>` only because it is the drag
 * and not the action a reader looks for — a marking has no other gesture.
 *
 * **The fourth is the one drag whose key covers two actions**, and the obvious
 * reading does not work: keyed on `moveBend` alone, {@link addBend} would carry
 * `null` and push its own snapshot, so the first `moveBend` would push a second
 * and one undo would land on a bend-inserted-but-unmoved document — a road with a
 * vertex nobody asked for. The insert opens the run instead, which is why both
 * actions answer `bendDrag:<link>:<index>`. They agree by construction: `addBend`
 * mints the selection for the index it inserted at, and the drag that follows
 * carries that same index.
 *
 * **Typing is the second gesture, and the only one that is not a drag.** The
 * Inspector's four text fields — a marking's Words, a sign's Label, a warning
 * sign's Symbol and a direction sign's Destination — dispatch a whole
 * `setMarkingKind`/`setSignKind` per keystroke so the paint follows the typing,
 * and without a key here a five-letter word would burn five of the hundred
 * snapshots the stack holds (signs spec Phase 1).
 *
 * **Empty content is deliberately outside the gesture.** The Kind picker mints a
 * fresh text marking as `content: ""`, and if that shared the run's key the first
 * keystroke would *replace* it — so one undo after picking Text and typing a word
 * would jump back past the repaint to whatever the marking was before, rather
 * than back to an empty one. The cost is that clearing a field back to empty also
 * closes the run, which is the honest reading of deleting a word.
 *
 * The sign fields keep that carve-out, and Phase 3's Kind picker is what makes it
 * load-bearing rather than defensive: picking Custom, Warning or Direction mints
 * `{ label: "" }`/`{ symbol: "" }`/`{ text: "" }` through *this* action, so without
 * the carve-out the first keystroke would swallow the pick and one undo would jump
 * back past it to whatever the sign was before.
 *
 * **A key per field, not per sign.** The three fields belong to three different
 * kinds and can never be typed into in the same breath — switching between them
 * *is* a pick — so sharing one key would only make the runs indistinguishable in
 * the stack for no gain.
 *
 * **A link's Length is the fifth field and takes the carve-out too**, in the one
 * shape it has here: `1800` is four keystrokes and one undo step, while clearing
 * the field back to "states nothing" closes the run — deleting a length is a
 * separate edit from typing one, exactly as deleting a word is.
 */
function coalesceKeyFor(action: EditAction): string | null {
  if (action.type === "moveNode") return `moveNode:${action.id}`;
  if (action.type === "moveSign") return `moveSign:${action.id}`;
  if (action.type === "moveMarking") return `markingDrag:${action.id}`;
  if (action.type === "addBend" || action.type === "moveBend")
    return `bendDrag:${action.link}:${action.index}`;
  if (action.type === "setMarkingKind" && action.kind.type === "text")
    return action.kind.content === "" ? null : `markingText:${action.id}`;
  if (action.type === "setSignKind" && action.kind.type === "custom")
    return action.kind.label === "" ? null : `signLabel:${action.id}`;
  if (action.type === "setSignKind" && action.kind.type === "warning")
    return action.kind.symbol === "" ? null : `signSymbol:${action.id}`;
  if (action.type === "setSignKind" && action.kind.type === "direction")
    return action.kind.text === "" ? null : `signText:${action.id}`;
  if (action.type === "setLinkLength")
    return action.length === undefined ? null : `linkLength:${action.id}`;
  return null;
}

/**
 * Fold the result of an editing action into the history stacks.
 *
 * A change to `doc` either **replaces** the current entry (the gesture named by
 * `key` is still open) or **pushes** a new one; either way it dirties the state
 * and drops any redo future. An action that leaves `doc` alone records nothing
 * but still closes an open gesture, so the next change starts a fresh entry.
 */
function recordHistory(
  prev: EditorState,
  next: EditorState,
  key: string | null,
): EditorState {
  if (next.doc === prev.doc) {
    // Nothing to record. Preserve the identity-stable no-op (`moveNode` on a
    // node with no layout entry, `deleteSelection` with nothing selected) when
    // there is also no gesture to close, so `useReducer` skips the re-render.
    if (next === prev && prev.coalesceKey === null) return prev;
    return { ...next, coalesceKey: null };
  }

  const continuing = key !== null && key === prev.coalesceKey;
  return {
    ...next,
    dirty: true,
    // While a gesture is open `past` already holds its pre-gesture snapshot.
    past: continuing ? prev.past : pushPast(prev.past, prev.doc),
    future: [],
    coalesceKey: key,
  };
}

/** Append a snapshot, dropping the oldest once the stack is full. */
function pushPast(past: Document[], doc: Document): Document[] {
  const grown = [...past, doc];
  return grown.length > HISTORY_LIMIT
    ? grown.slice(grown.length - HISTORY_LIMIT)
    : grown;
}

/**
 * Install a snapshot from either history stack. Clears `linkFrom` (a half-drawn
 * link may start at a node this just removed) and revalidates the selection,
 * which survives an undo that only changed the selected element's properties.
 * Dirty is set unconditionally: undoing back to the last-saved document still
 * reads as dirty, which over-reports safely (OQ-1).
 *
 * **A `bend` selection is dropped outright, and it is the only arm that needs
 * saying** (link bends §2.2, OQ-2). The four id-bearing arms survive a stale id
 * because {@link selectionValid} simply finds nothing and clears — silent and
 * correct. A stale bend *index* can still be **in range**, and then it names a
 * different bend: the panel would report one vertex while Delete removed
 * another, which is the one outcome no existing arm can produce.
 */
function restore(
  state: EditorState,
  doc: Document,
  past: Document[],
  future: Document[],
): EditorState {
  const held = state.selection?.kind === "bend" ? null : state.selection;
  return {
    ...state,
    doc,
    past,
    future,
    coalesceKey: null,
    linkFrom: null,
    dirty: true,
    selection: selectionValid(doc, held) ? held : null,
  };
}

/**
 * Whether a selection still refers to something present in `doc`.
 *
 * A `switch` rather than the ternary this was, because **the compiler is no help
 * here**: every id is a bare `type X = string`, so `MarkingId` and `LinkId` are
 * the same type and a new `Selection` arm falls silently through a binary test.
 * That miss cost a marking selection its survival across every undo and redo
 * (markings spec §2.6).
 *
 * **The `bend` arm answers a narrower question than the four above it**, and
 * {@link restore} is where the difference is paid for: this can tell an index
 * that no longer exists from one that does, and cannot tell one that now names a
 * *different* bend from one that still names the same.
 */
function selectionValid(doc: Document, sel: Selection | null): boolean {
  if (!sel) return false;
  switch (sel.kind) {
    case "node":
      return findNode(doc, sel.id) !== undefined;
    case "link":
      return findLink(doc, sel.id) !== undefined;
    case "marking":
      return findMarking(doc, sel.id) !== undefined;
    case "sign":
      return findSign(doc, sel.id) !== undefined;
    case "bend":
      return sel.index >= 0 && sel.index < bendsOf(doc, sel.link).length;
    default:
      return unreachable(sel);
  }
}

/**
 * A link's bends, or an empty array — the read every bend action shares.
 *
 * `bends` is optional and a link may have no `LinkView` at all: `completeLink`
 * and the importer both always write one, but a hand-edited or normalized
 * document need not carry one. A caller never has to tell "no bends" from
 * "no view".
 */
function bendsOf(doc: Document, id: LinkId): Vec2[] {
  return doc.layout.links[id]?.bends ?? [];
}

/**
 * The `never`-typed guard that makes a `Selection` `switch` exhaustive: adding a
 * fourth arm without handling it fails to type-check at the call site.
 *
 * A function rather than `const _: never = sel`, because `tsconfig.json` sets
 * `noUnusedLocals`. It cannot actually run — `Selection` values are built only by
 * this module and the components that dispatch `select`, and a loaded document
 * resets the selection to `null` — so the throw documents an impossibility rather
 * than handling degenerate input.
 */
function unreachable(x: never): never {
  throw new Error(`unhandled selection kind: ${JSON.stringify(x)}`);
}

/** Apply an editing action; leaves `dirty`/`currentPath` to {@link reducer}. */
function editReducer(state: EditorState, action: EditAction): EditorState {
  switch (action.type) {
    case "setTool":
      // Leaving the link tool abandons any half-drawn link.
      return { ...state, tool: action.tool, linkFrom: null };

    case "setView":
      return { ...state, view: action.view };

    case "addNode":
      return addNode(state, action.pos);

    case "moveNode":
      return moveNode(state, action.id, action.pos);

    case "setNodeKind":
      return setNodeKind(state, action.id, action.kind);

    case "setJunctionGlyph":
      return setJunctionView(state, action.id, { glyph: action.glyph });

    case "setJunctionScale":
      return setJunctionView(state, action.id, {
        scale: Math.max(0.5, Math.min(2.5, Math.round(action.scale * 4) / 4)),
      });

    case "setJunctionControl":
      return setJunctionControl(state, action.id, action.control);

    case "setJunctionRule":
      return setJunctionRule(state, action.id, action.rule);

    case "startLink":
      return { ...state, linkFrom: action.from };

    case "completeLink":
      return completeLink(state, action.to);

    case "cancelLink":
      return { ...state, linkFrom: null };

    case "setLinkLanes":
      return setLinkLanes(state, action.id, action.count);

    case "setLaneKind":
      return setLaneKind(state, action.id, action.lane, action.kind);

    case "setLinkStyle":
      return setLinkStyle(state, action.id, action.style);

    case "setLinkAlign":
      return setLinkAlign(state, action.id, action.align);

    case "setLinkLength":
      return setLinkLength(state, action.id, action.length);

    case "addBend":
      return addBend(state, action.link, action.index, action.pos);

    case "moveBend":
      return moveBend(state, action.link, action.index, action.pos);

    case "addMarking":
      return addMarking(state, action.link, action.position, action.lane);

    case "setMarkingKind":
      return setMarkingKind(state, action.id, action.kind);

    case "setMarkingLane":
      return setMarkingLane(state, action.id, action.lane);

    case "setMarkingAnchor":
      return setMarkingAnchor(state, action.id, action.anchor);

    case "moveMarking":
      return moveMarking(state, action.id, action.position, action.lane);

    case "addSign":
      return addSign(state, action.pos);

    case "moveSign":
      return moveSign(state, action.id, action.pos);

    case "setSignKind":
      return setSignKind(state, action.id, action.kind);

    case "setSignLink":
      return setSignLink(state, action.id, action.link);

    case "select":
      return { ...state, selection: action.selection };

    case "deleteSelection":
      return deleteSelection(state);
  }
}

function addNode(state: EditorState, pos: Vec2): EditorState {
  const { doc } = state;
  const id = nextId(
    doc.nodes.map((n) => n.id),
    "N",
  );
  return {
    ...state,
    doc: {
      ...doc,
      nodes: [...doc.nodes, { id, type: "endpoint" }],
      layout: {
        ...doc.layout,
        nodes: { ...doc.layout.nodes, [id]: { pos } },
      },
    },
    selection: { kind: "node", id },
  };
}

function moveNode(state: EditorState, id: NodeId, pos: Vec2): EditorState {
  const { doc } = state;
  if (!doc.layout.nodes[id]) return state;
  return {
    ...state,
    doc: {
      ...doc,
      layout: {
        ...doc.layout,
        nodes: { ...doc.layout.nodes, [id]: { pos } },
      },
    },
  };
}

function setNodeKind(
  state: EditorState,
  id: NodeId,
  kind: NodeKind,
): EditorState {
  const { doc } = state;
  const nodes = doc.nodes.map((n) => (n.id === id ? { ...n, type: kind } : n));

  // Keep junction records and glyphs consistent with node kind: a node that
  // becomes a junction gains a default (unsignalized) junction + generic glyph;
  // one that stops being a junction loses both.
  let junctions = doc.junctions;
  const junctionViews = { ...doc.layout.junctions };
  if (kind === "junction" && !findJunction(doc, id)) {
    const j: Junction = { node_id: id, control: "unsignalized" };
    junctions = [...doc.junctions, j];
    junctionViews[id] = { glyph: "generic", scale: 1 };
  } else if (kind !== "junction") {
    junctions = doc.junctions.filter((j) => j.node_id !== id);
    delete junctionViews[id];
  }

  return {
    ...state,
    doc: {
      ...doc,
      nodes,
      junctions,
      layout: { ...doc.layout, junctions: junctionViews },
    },
  };
}

/** Merge a partial change into a node's junction view, creating it if absent. */
function setJunctionView(
  state: EditorState,
  id: NodeId,
  patch: Partial<{ glyph: JunctionGlyph; scale: number }>,
): EditorState {
  const { doc } = state;
  const current = doc.layout.junctions[id] ?? {
    glyph: "generic" as JunctionGlyph,
    scale: 1,
  };
  return {
    ...state,
    doc: {
      ...doc,
      layout: {
        ...doc.layout,
        junctions: { ...doc.layout.junctions, [id]: { ...current, ...patch } },
      },
    },
  };
}

/**
 * The glyph a control change **nudges** to, or `undefined` for one it must leave
 * alone (junction semantics §2.2).
 *
 * The glyph and the control are two different questions — one is presentation
 * (five drawings, dropped on export), the other is semantics (two values, exported
 * to Assimilator) — and a signalised junction drawn as a plain pad is a legitimate
 * schematic choice. But leaving them wholly independent leaves the contradiction
 * this phase exists to fix: a drawing with signal heads over a document that says
 * the junction is uncontrolled.
 *
 * So the answer is a nudge rather than a constraint, and the **"only from the
 * default"** clause is the whole of it: `generic` is what `setNodeKind` mints and
 * so is the glyph nobody chose, while `roundabout`, `gore` and `priority_cross`
 * are each a human's deliberate pick and are never overwritten. The traffic runs
 * one way — presentation may follow semantics, never the reverse, so nothing here
 * has a twin in `setJunctionView`.
 */
function nudgedGlyph(
  current: JunctionGlyph,
  control: JunctionControl,
): JunctionGlyph | undefined {
  if (control === "signal" && current === "generic") return "signalized_cross";
  if (control === "unsignalized" && current === "signalized_cross") {
    return "generic";
  }
  return undefined;
}

/**
 * Signalise a junction, or hand it back to a give-way rule — **the first thing
 * that has ever written `Junction.control`**, which until now was minted
 * `unsignalized` by {@link setNodeKind} and never touched again.
 *
 * Three things happen in the one action, so they are one undo step:
 *
 * - `control` is written into the one `Junction` inside `doc.junctions`;
 * - `rule` is **cleared going to `signal`**, because Assimilator's model says it
 *   is `None` when signalized (`graph.rs`). Cleared by dropping the key, never by
 *   storing `undefined` — the one-representation rule {@link setSignLink} follows.
 *   Coming back the other way *keeps* a rule, which only a hand-edited file can
 *   have at that point, rather than inventing one;
 * - the glyph follows, if {@link nudgedGlyph} says it may, through
 *   {@link setJunctionView} — which already creates the view a junction with no
 *   layout entry lacks, so that case needs no rule of its own.
 *
 * Two identity returns, both reachable. A junction-kind node with **no `Junction`
 * record** is what a hand-edited file can carry, and a junction **already in the
 * target state** is what re-picking the active segment does; either returns
 * `state` itself, so {@link recordHistory} takes no snapshot and `dirty` stays put.
 */
function setJunctionControl(
  state: EditorState,
  id: NodeId,
  control: JunctionControl,
): EditorState {
  const { doc } = state;
  const junction = findJunction(doc, id);
  if (!junction || junction.control === control) return state;

  const junctions = doc.junctions.map((j) => {
    if (j.node_id !== id) return j;
    const { rule: _dropped, ...rest } = j;
    return control === "signal" ? { ...rest, control } : { ...j, control };
  });
  const next = { ...state, doc: { ...doc, junctions } };

  // `view?.glyph ?? "generic"` is `JunctionFields`' own fallback, not a second
  // rule: a junction with no layout entry is drawn as `generic`, so that is what
  // the nudge must read it as.
  const glyph = nudgedGlyph(doc.layout.junctions[id]?.glyph ?? "generic", control);
  return glyph === undefined ? next : setJunctionView(next, id, { glyph });
}

/**
 * Set an unsignalized junction's right-of-way rule, or clear it.
 *
 * **Absent is the one representation**: the key is destructured away rather than
 * overwritten with `undefined`, matching Rust's `skip_serializing_if =
 * "Option::is_none"` — the rule {@link setSignLink} follows for `associated_link`
 * and {@link setMarkingLane} for `lane`. "None" in the panel is how that state is
 * reached at all; a field nothing can clear is a field only a hand-edited file can
 * clear.
 *
 * **Deliberately says nothing about `control`.** A rule on a signalized junction
 * is meaningless, but the panel is what withholds the row, not this action — the
 * posture {@link setMarkingLane} takes towards a marking's `kind`, and for its
 * reason: encoding a sibling field's state here would make the same value legal or
 * illegal depending on something this action does not own. {@link
 * setJunctionControl} is the one place the two fields meet, because there the
 * change *is* to `control`.
 *
 * `junction.rule === rule` covers `undefined === undefined`, so re-picking "None"
 * on a junction that has no rule returns `state` by identity.
 */
function setJunctionRule(
  state: EditorState,
  id: NodeId,
  rule: UnsignalizedRule | undefined,
): EditorState {
  const { doc } = state;
  const junction = findJunction(doc, id);
  if (!junction || junction.rule === rule) return state;

  return {
    ...state,
    doc: {
      ...doc,
      junctions: doc.junctions.map((j) => {
        if (j.node_id !== id) return j;
        const { rule: _dropped, ...rest } = j;
        return rule === undefined ? rest : { ...rest, rule };
      }),
    },
  };
}

function completeLink(state: EditorState, to: NodeId): EditorState {
  const { doc, linkFrom } = state;
  if (linkFrom === null || linkFrom === to) {
    return { ...state, linkFrom: null };
  }
  const id = nextId(
    doc.links.map((l) => l.id),
    "L",
  );
  const lanes = Array.from({ length: NEW_LINK_LANES }, (_, i) => defaultLane(i));
  return {
    ...state,
    doc: {
      ...doc,
      links: [
        ...doc.links,
        {
          id,
          from_node: linkFrom,
          to_node: to,
          lanes,
          median_gap: 0.5,
        },
      ],
      layout: {
        ...doc.layout,
        links: { ...doc.layout.links, [id]: { style: DEFAULT_LINK_STYLE } },
      },
    },
    linkFrom: null,
    selection: { kind: "link", id },
  };
}

/**
 * Resize a link's lane array, **keeping the lanes that survive**.
 *
 * A lane carries more than its existence — `kind` (a hard shoulder, a bus lane),
 * `width`, its speed limit. Rebuilding the whole array from `defaultLane` on
 * every ±1 click, as this once did, meant one press of the Lanes stepper
 * silently discarded a shoulder the user had just set two controls above; a
 * control whose value an adjacent control destroys is not a working feature
 * (road spec §2.5).
 *
 * Surviving indices keep their existing `Lane` **by identity**, so a snapshot
 * shares them with its predecessor the way `rules/history.md` assumes. Only
 * genuinely new indices get a default lane — and a lane the user shrank past is
 * gone for good, which is the honest reading of having removed it.
 */
function setLinkLanes(
  state: EditorState,
  id: LinkId,
  count: number,
): EditorState {
  const { doc } = state;
  const n = Math.max(1, Math.min(8, Math.round(count)));
  return {
    ...state,
    doc: {
      ...doc,
      links: doc.links.map((l) =>
        l.id === id
          ? {
              ...l,
              lanes: Array.from(
                { length: n },
                (_, i) => l.lanes[i] ?? defaultLane(i),
              ),
            }
          : l,
      ),
      // A marking on a lane this shrink removed is **dropped, not clamped** to a
      // surviving lane: a turn arrow that silently moves lane is worse than one
      // that goes away, because the drawing still looks deliberate (markings
      // spec §2.5). Same scar as the lane `kind` this control used to destroy.
      markings: keepMarkings(
        doc.markings,
        (m) => m.link !== id || m.lane === undefined || m.lane < n,
      ),
    },
  };
}

/**
 * `markings` filtered by `keep`, returning **the same array** when nothing is
 * dropped.
 *
 * The identity matters twice over: a document with no marking must share the
 * array with its history snapshots the way `rules/history.md` assumes, and the
 * marking arm of {@link deleteSelection} must be able to leave `doc` itself
 * untouched — a fresh array there would dirty the document and push an undo
 * snapshot while deleting nothing.
 */
function keepMarkings(
  markings: Marking[],
  keep: (m: Marking) => boolean,
): Marking[] {
  const kept = markings.filter(keep);
  return kept.length === markings.length ? markings : kept;
}

/**
 * `signs` with every `associated_link` the caller says is `gone` **cleared**, and
 * the **same array** back when none was.
 *
 * A sign is free-standing by design, so a deleted road must not take one with it
 * (signs spec §2.5) — {@link keepMarkings}'s cascade lesson applied in the other
 * direction. What a deleted road *can* leave is a dangling reference, and the
 * answer is to clear the field rather than delete the sign.
 *
 * **That makes this a `map` where {@link keepMarkings} is a `filter`, so the
 * identity has to be recovered deliberately rather than falling out of a length
 * comparison** — a `map` always returns a fresh array. Not about dirtying: both
 * arms that call this rebuild `doc` regardless, since each is removing a link or a
 * node. It is about a document whose signs never named the deleted road still
 * *sharing the array* with its history snapshots, the way `rules/history.md`
 * assumes every untouched sub-tree does. Untouched signs keep their own identity
 * too, because `map` returns them unchanged.
 *
 * A cleared sign **drops the key** rather than holding `undefined`, the rule
 * {@link setSignLink} follows.
 */
function clearSignLinks(signs: Sign[], gone: (link: LinkId) => boolean): Sign[] {
  const stranded = (s: Sign) =>
    s.associated_link !== undefined && gone(s.associated_link);
  if (!signs.some(stranded)) return signs;
  return signs.map((s) => {
    if (!stranded(s)) return s;
    const { associated_link: _dropped, ...rest } = s;
    return rest;
  });
}

/**
 * Paint a marking on a link, at `position` **metres** along it.
 *
 * Always a `stop_line`: one kind is all the renderer draws, and the Inspector's
 * Kind picker is what turns it into another, so there is no kind argument and no
 * placement dialog (markings spec §2.4). `lane` absent means the whole
 * carriageway, and is **omitted** rather than stored as `undefined` — the one
 * representation rule {@link setLaneKind} and {@link setLinkAlign} already
 * follow, matching Rust's `skip_serializing_if = "Option::is_none"`.
 *
 * An unknown link returns `state` itself, so {@link recordHistory} records
 * nothing and `dirty` stays put.
 */
function addMarking(
  state: EditorState,
  link: LinkId,
  position: number,
  lane: LaneIdx | undefined,
): EditorState {
  const { doc } = state;
  if (!findLink(doc, link)) return state;
  const id = nextId(
    doc.markings.map((m) => m.id),
    "M",
  );
  const marking: Marking = {
    id,
    link,
    position,
    ...(lane === undefined ? {} : { lane }),
    kind: { type: "stop_line" },
  };
  return {
    ...state,
    doc: { ...doc, markings: [...doc.markings, marking] },
    selection: { kind: "marking", id },
  };
}

/** A turn arrow's kind — the one `MarkingKind` with two payload arrays. */
export type TurnArrowKind = Extract<MarkingKind, { type: "turn_arrow" }>;

/**
 * A turn arrow's kind with **one** of its two direction arrays replaced and the
 * other preserved — the payload both Inspector direction controls build.
 *
 * It is not an action and joins neither the `Action` union nor the reducer: it
 * feeds {@link setMarkingKind}, which faithfully stores whatever payload it is
 * handed. **That is exactly why this has to exist as a named function.** The
 * failure it prevents lives in what the *panel* builds, not in what the reducer
 * stores: `setMarkingKind` replaces the whole tagged kind with no merge, so a
 * control that rebuilds a fresh `{ type: "turn_arrow", directions }` literal
 * silently deletes the rear heads on every forward toggle. The asymmetry is what
 * hides it — `directions` is required, so the compiler forces the *back* control
 * to carry it, while `back` is optional, so nothing forces the *forward* control
 * to carry `back`. Same silent-data-loss class as `setLinkLanes` and `Lane.kind`,
 * by a different door, and this repo can reach no layer closer to the panel
 * (`environment: "node"`, no DOM harness, `renderToStaticMarkup` fires no
 * `onClick`) — so the rule lives here, where losing `back` is what it is:
 * document data loss.
 *
 * **An empty `back` drops the key**, rather than storing `back: []`. Absent is
 * the one representation, as {@link setMarkingLane} keeps for a lane and
 * {@link setLinkAlign} for `centre`: Rust elides an empty `Vec`, so a stored
 * empty array would be a second in-memory encoding of a document that saves
 * single-headed. Rebuilding the literal is safe here where it is not in the
 * panel, because this owns the variant's *whole* payload — both arrays.
 */
export function turnArrowKind(
  current: TurnArrowKind,
  patch: { directions?: TurnDirection[]; back?: TurnDirection[] },
): TurnArrowKind {
  const directions = patch.directions ?? current.directions;
  const back = patch.back ?? current.back;
  return back?.length
    ? { type: "turn_arrow", directions, back }
    : { type: "turn_arrow", directions };
}

/**
 * Repaint a marking as another kind, keeping where it sits and what it spans.
 *
 * **Carries the whole tagged value, not just its `type`**, so the kinds with a
 * payload — `turn_arrow`'s directions, `lane_line`'s style — need no second
 * action of their own, and the caller owns the default a fresh pick starts from.
 *
 * `lane` survives because it is never named here: spreading a marking with no
 * `lane` key produces one with no `lane` key, so a carriageway-wide marking stays
 * carriageway-wide rather than acquiring an explicit `undefined`. An unknown
 * marking returns `state` itself, so {@link recordHistory} records nothing.
 */
function setMarkingKind(
  state: EditorState,
  id: MarkingId,
  kind: MarkingKind,
): EditorState {
  const { doc } = state;
  if (!findMarking(doc, id)) return state;
  return {
    ...state,
    doc: {
      ...doc,
      markings: doc.markings.map((m) => (m.id === id ? { ...m, kind } : m)),
    },
  };
}

/**
 * Set what a marking spans — one lane, or the whole carriageway.
 *
 * The deliberate route to `lane: undefined`, which placement can otherwise reach
 * only by clicking the casing lip (markings spec §2.4). As everywhere else,
 * **absent is the one representation**: the old key is destructured away rather
 * than overwritten with `undefined`, the rule {@link setLaneKind} follows for
 * `general` and {@link setLinkAlign} for `centre`.
 *
 * **Kind-agnostic on purpose.** A `lane_line`'s `lane` names a *boundary*, of
 * which there are only `n-1`, so its valid range is narrower — but that is the
 * Span control's business (§2.3), and encoding it here would make the same lane
 * index legal or illegal depending on a field this action does not touch. The
 * guard is the link's own lane count, the same one {@link setLaneKind} applies,
 * and it is unreachable from the UI either way.
 */
function setMarkingLane(
  state: EditorState,
  id: MarkingId,
  lane: LaneIdx | undefined,
): EditorState {
  const { doc } = state;
  const marking = findMarking(doc, id);
  if (!marking) return state;
  const link = findLink(doc, marking.link);
  if (lane !== undefined && (!link || lane < 0 || lane >= link.lanes.length)) {
    return state;
  }

  return {
    ...state,
    doc: {
      ...doc,
      markings: doc.markings.map((m) => {
        if (m.id !== id) return m;
        const { lane: _dropped, ...rest } = m;
        return lane === undefined ? rest : { ...rest, lane };
      }),
    },
  };
}

/**
 * Measure a marking's distance from the other end of its road.
 *
 * **What auto-placed paint needs** (lane arrows §2.3): a `start`-anchored
 * marking sits a fixed distance from the *far* end of its road, so dragging a
 * node past it leaves an arrow that used to be at the junction piled up inside
 * the pad. An `end` anchor holds the distance the drawing actually cares about.
 *
 * **`start` is stored as an *absent* `anchor`**, {@link setLinkAlign}'s rule for
 * `centre` and {@link setMarkingLane}'s for a carriageway-wide span: absent is
 * what Rust writes back (`skip_serializing_if = "LinkEnd::is_start"`), so a
 * second encoding of it would differ by document identity while saving to the
 * same bytes.
 *
 * **The flip moves the paint and does not re-base `position`.** A marking 20 m
 * from the start becomes 20 m from the end. Re-basing it to `total - position`
 * would hold the paint still, but only by making the stored metres a function of
 * the drawing — which is the one thing keeping the position in metres rules out,
 * and it would need the drawn polyline in here.
 *
 * **The identity guard normalizes before comparing.** A start-anchored marking
 * carries no `anchor` key at all, so a bare `marking.anchor === anchor` compares
 * `undefined` with `"start"` and re-clicking Start would dirty the document and
 * push an undo snapshot for nothing.
 */
function setMarkingAnchor(
  state: EditorState,
  id: MarkingId,
  anchor: LinkEnd,
): EditorState {
  const { doc } = state;
  const marking = findMarking(doc, id);
  if (!marking) return state;
  if ((marking.anchor ?? "start") === anchor) return state;

  return {
    ...state,
    doc: {
      ...doc,
      markings: doc.markings.map((m) => {
        if (m.id !== id) return m;
        const { anchor: _dropped, ...rest } = m;
        return anchor === "start" ? rest : { ...rest, anchor };
      }),
    },
  };
}

/**
 * Slide a marking to a new place on the road it is already painted on.
 *
 * **The missing verb** (lane arrows §2.2): the marking editor could create,
 * repaint, re-span and delete, and not *move*. Auto-placed paint is what makes it
 * load-bearing — an imported network mints an arrow per approach lane, and
 * without a drag a single one placed wrong is delete-and-replace.
 *
 * **Writes both fields**, and takes them already projected: the canvas owns the
 * pointer-to-road arithmetic (`bandAt`, `boundaryAt` in `geometry.ts`) exactly as
 * it does for {@link addMarking}, and the kind-aware half of it — a `lane_line`'s
 * `lane` names a boundary, not a lane — lives there with the Inspector's other
 * kind-aware rules rather than here. So there is **no lane-range guard**, unlike
 * {@link setMarkingLane}: a dragged lane comes from the link's own bands and is in
 * range by construction, and a guard here would claim to police something this
 * action cannot see.
 *
 * `lane` absent is stored as an **absent key**, {@link setMarkingLane}'s exact
 * shape, so dragging paint out onto the casing lip widens it to the carriageway
 * rather than leaving an explicit `undefined` behind.
 *
 * **Two identity returns, and the second is a new pattern rather than an
 * inherited one.** An unknown marking returns `state` itself, as every marking
 * action does. So does a drag that lands on the `(position, lane)` the marking
 * already has — which {@link moveNode} and {@link moveSign} do *not* do, both
 * rebuilding unconditionally. A drag dispatches on every pointer-move, including
 * the ones that resolve to the same place, and without this {@link recordHistory}
 * dirties the document for a gesture that changed nothing.
 */
function moveMarking(
  state: EditorState,
  id: MarkingId,
  position: number,
  lane: LaneIdx | undefined,
): EditorState {
  const { doc } = state;
  const marking = findMarking(doc, id);
  if (!marking) return state;
  if (marking.position === position && marking.lane === lane) return state;

  return {
    ...state,
    doc: {
      ...doc,
      markings: doc.markings.map((m) => {
        if (m.id !== id) return m;
        const { lane: _dropped, ...rest } = m;
        return lane === undefined
          ? { ...rest, position }
          : { ...rest, position, lane };
      }),
    },
  };
}

/**
 * Stand a sign on the canvas at `pos`.
 *
 * **{@link addNode}'s shape, not {@link addMarking}'s** (signs spec §2.5): a sign
 * carries its own canvas position rather than deriving one from a road, so this
 * writes both halves — the `Sign` into `doc.signs` and the point into
 * `doc.layout.signs` — and nothing about the click is projected onto a polyline or
 * matched against a lane band.
 *
 * Two things about the layout entry are easy to get wrong. It is a **bare
 * `Vec2`**, not the `{ pos }` wrapper `layout.nodes` uses, mirroring Rust's
 * `BTreeMap<SignId, Vec2>`; and `associated_link` is **omitted** rather than
 * stored as `undefined`, the one-representation rule every optional field here
 * follows.
 *
 * Always a `custom { label: "" }`: one kind is all Phase 2 draws, and the
 * Inspector is what fills the label in — the posture {@link addMarking} takes with
 * `stop_line`, for the same reason (no kind argument, no placement dialog).
 */
function addSign(state: EditorState, pos: Vec2): EditorState {
  const { doc } = state;
  const id = nextId(
    doc.signs.map((s) => s.id),
    "S",
  );
  const sign: Sign = { id, kind: { type: "custom", label: "" } };
  return {
    ...state,
    doc: {
      ...doc,
      signs: [...doc.signs, sign],
      layout: { ...doc.layout, signs: { ...doc.layout.signs, [id]: pos } },
    },
    selection: { kind: "sign", id },
  };
}

/**
 * Move a sign to `pos` — {@link moveNode}'s shape, guard included (§2.5).
 *
 * A sign with no layout entry is not drawn and cannot be dragged, so this returns
 * `state` **itself** and {@link recordHistory} records nothing. Guarded on the
 * *layout* entry rather than on `findSign` for the reason `moveNode` is: the
 * position is what this action writes, and the layout is what holds it.
 */
function moveSign(state: EditorState, id: SignId, pos: Vec2): EditorState {
  const { doc } = state;
  if (!doc.layout.signs[id]) return state;
  return {
    ...state,
    doc: {
      ...doc,
      layout: { ...doc.layout, signs: { ...doc.layout.signs, [id]: pos } },
    },
  };
}

/**
 * Change what a sign says, keeping where it stands and what it names.
 *
 * **Carries the whole tagged `SignKind`**, not just its `type`, on
 * {@link setMarkingKind}'s precedent — and that is what let the whole vocabulary
 * land without a second action: `speed_limit`'s `kph`, `warning`'s `symbol` and
 * `direction`'s `text` are each a control dispatching *this*, and the *caller* owns
 * the payload a fresh pick starts from.
 *
 * `associated_link` survives because it is never named here: spreading a sign with
 * no `associated_link` key yields one with no `associated_link` key.
 */
function setSignKind(
  state: EditorState,
  id: SignId,
  kind: SignKind,
): EditorState {
  const { doc } = state;
  if (!findSign(doc, id)) return state;
  return {
    ...state,
    doc: {
      ...doc,
      signs: doc.signs.map((s) => (s.id === id ? { ...s, kind } : s)),
    },
  };
}

/**
 * Point a sign at a link, or at nothing.
 *
 * `associated_link` is "for context" and anchors nothing (§2.5) — a sign renders
 * identically either way — but without a writer the field would be a readout of
 * something nothing can set, and the clear-on-delete in {@link deleteSelection}
 * would be reachable only from a hand-edited file.
 *
 * **Absent is the one representation**: the old key is destructured away rather
 * than overwritten with `undefined`, the rule {@link setMarkingLane} follows for
 * `lane`.
 *
 * An unknown link returns `state` itself, the guard {@link setMarkingLane} applies
 * to a lane index. The picker only ever offers links the document has, so it is
 * unreachable from the UI — and storing a reference the document cannot resolve is
 * exactly what {@link clearSignLinks} exists to prevent.
 */
function setSignLink(
  state: EditorState,
  id: SignId,
  link: LinkId | undefined,
): EditorState {
  const { doc } = state;
  if (!findSign(doc, id)) return state;
  if (link !== undefined && !findLink(doc, link)) return state;
  return {
    ...state,
    doc: {
      ...doc,
      signs: doc.signs.map((s) => {
        if (s.id !== id) return s;
        const { associated_link: _dropped, ...rest } = s;
        return link === undefined ? rest : { ...rest, associated_link: link };
      }),
    },
  };
}

/**
 * Classify one lane of one link — the only way `Lane.kind` is reachable from the
 * UI, and so the only reason anything keyed on it renders.
 *
 * **`general` is stored as an absent `kind`, not as the string.** That keeps one
 * representation of a plain lane: the one `defaultLane` produces, and the one
 * Rust writes back (`skip_serializing_if = "Option::is_none"`). Two encodings of
 * the same lane would differ by document identity and so dirty the file for no
 * visible change.
 *
 * An unknown link or an out-of-range index returns `state` itself, so
 * {@link recordHistory} records nothing and `dirty` stays put.
 */
function setLaneKind(
  state: EditorState,
  id: LinkId,
  lane: LaneIdx,
  kind: LaneKind,
): EditorState {
  const { doc } = state;
  const link = findLink(doc, id);
  if (!link || lane < 0 || lane >= link.lanes.length) return state;

  const lanes = link.lanes.map((l, i) => {
    if (i !== lane) return l;
    const { kind: _dropped, ...rest } = l;
    return kind === "general" ? rest : { ...rest, kind };
  });

  return {
    ...state,
    doc: {
      ...doc,
      links: doc.links.map((l) => (l.id === id ? { ...l, lanes } : l)),
    },
  };
}

function setLinkStyle(
  state: EditorState,
  id: LinkId,
  style: LinkStyle,
): EditorState {
  const { doc } = state;
  const view = doc.layout.links[id] ?? { style };
  return {
    ...state,
    doc: {
      ...doc,
      layout: {
        ...doc.layout,
        links: { ...doc.layout.links, [id]: { ...view, style } },
      },
    },
  };
}

/**
 * Hold one of a link's edges on its polyline, or put it back on the centreline.
 *
 * **`centre` is stored as an *absent* `align`, not as the string** — the same
 * rule {@link setLaneKind} follows for `general`, and for the same reason: a
 * centred link is what every link starts as and what Rust writes back
 * (`skip_serializing_if = "LinkAlign::is_centre"`), so a second encoding of it
 * would differ by document identity while saving to the same bytes.
 */
function setLinkAlign(
  state: EditorState,
  id: LinkId,
  align: LinkAlign,
): EditorState {
  const { doc } = state;
  const { align: _dropped, ...view } = doc.layout.links[id] ?? {
    style: DEFAULT_LINK_STYLE,
  };
  return {
    ...state,
    doc: {
      ...doc,
      layout: {
        ...doc.layout,
        links: {
          ...doc.layout.links,
          [id]: align === "centre" ? view : { ...view, align },
        },
      },
    },
  };
}

/**
 * Say how long the road really is, or stop saying.
 *
 * **The one action in the reducer that must not touch the drawing** (link-length
 * §2.2). It writes `doc.links` and nothing else, so `doc.layout` — where every
 * drawn position lives — survives **by reference**, which is the assertable form
 * of "the picture did not move". Its mirror image is `moveNode`, which writes
 * only `doc.layout` and so cannot reach the number.
 *
 * `undefined` clears the key rather than storing a value, **absent being the one
 * representation** as ever ({@link setMarkingLane}) — and here absent is also the
 * whole meaning: a road that states no length is not a road of length zero.
 *
 * The guard rejects anything that is not a finite positive number, so `0`, `NaN`
 * and a negative never reach the document from any caller. `0` is excluded
 * deliberately and not by oversight: it would draw `0m` on a road, which is a
 * claim rather than the absence of one.
 */
function setLinkLength(
  state: EditorState,
  id: LinkId,
  length: number | undefined,
): EditorState {
  const { doc } = state;
  if (!findLink(doc, id)) return state;
  if (length !== undefined && !(Number.isFinite(length) && length > 0)) {
    return state;
  }

  return {
    ...state,
    doc: {
      ...doc,
      links: doc.links.map((l) => {
        if (l.id !== id) return l;
        const { length: _dropped, ...rest } = l;
        return length === undefined ? rest : { ...rest, length };
      }),
    },
  };
}

/**
 * Write a link's bends back, **dropping the key when there are none left**.
 *
 * Absent is the one representation, as ever ({@link setMarkingLane}) — Rust
 * elides an empty `Vec` (`layout.rs`), so a stored `[]` would be a second
 * in-memory encoding of a document that saves as a straight chord.
 *
 * It also **mints the `LinkView` a link may not have**. `bends` is optional and
 * so is the view itself: `completeLink` and the importer both always write one,
 * but a hand-edited or normalized document need not, and a bend placed on such a
 * link must not silently go nowhere. {@link setLinkStyle}'s fallback shape.
 */
function withBends(state: EditorState, id: LinkId, bends: Vec2[]): EditorState {
  const { doc } = state;
  const { bends: _dropped, ...view } = doc.layout.links[id] ?? {
    style: DEFAULT_LINK_STYLE,
  };
  return {
    ...state,
    doc: {
      ...doc,
      layout: {
        ...doc.layout,
        links: {
          ...doc.layout.links,
          [id]: bends.length ? { ...view, bends } : view,
        },
      },
    },
  };
}

/**
 * Put a vertex in a road's route, at `index` — the missing verb the whole spec
 * exists for (link bends §1). `LinkView.bends` has been in both mirrors since the
 * first commit, read by `linkPolyline` and drawn through by the renderer, and
 * until now **nothing wrote it**.
 *
 * `index` is the layout polyline's segment index, which is also the new vertex's
 * index in `bends`, since a polyline is `[from, ...bends, to]`. Both it and `pos`
 * come from one walk in `geometry.ts:bendInsertion`; this action stores what it
 * is handed, exactly as {@link moveMarking} does with a projected position, and
 * the arithmetic stays in the UI layer where the two polyline frames live.
 *
 * **It mints the selection for the bend it inserted**, which is §2.2's
 * count-changing rule in the one place an insert can honour it: an index held
 * across this action would name the vertex *after* the new one. Replacing it
 * outright is cheaper and more honest than renumbering.
 *
 * An unknown link or an out-of-range index returns `state` itself, so
 * {@link recordHistory} records nothing and `dirty` stays put.
 */
function addBend(
  state: EditorState,
  id: LinkId,
  index: number,
  pos: Vec2,
): EditorState {
  const { doc } = state;
  if (!findLink(doc, id)) return state;
  const bends = bendsOf(doc, id);
  // `<= length`, not `<`: an insert may land past the last bend, on the segment
  // running into the to-node. That is one more valid index than a move has.
  if (index < 0 || index > bends.length) return state;

  return {
    ...withBends(state, id, [
      ...bends.slice(0, index),
      pos,
      ...bends.slice(index),
    ]),
    selection: { kind: "bend", link: id, index },
  };
}

/**
 * Slide one vertex of a road's route — {@link moveNode}'s shape, guard included.
 *
 * Guarded on the *bend* rather than on `findLink` for the reason `moveNode` is
 * guarded on the layout entry: the position is what this action writes, and the
 * layout is what holds it.
 *
 * **No same-position identity return**, unlike {@link moveMarking}. That one
 * needs it because a drag re-projects onto a road and lands on the same
 * `(position, lane)` repeatedly; a bend takes a raw world point, which is what
 * {@link moveNode} and {@link moveSign} take, and the whole run is one undo step
 * either way.
 */
function moveBend(
  state: EditorState,
  id: LinkId,
  index: number,
  pos: Vec2,
): EditorState {
  const bends = bendsOf(state.doc, id);
  if (index < 0 || index >= bends.length) return state;
  return withBends(
    state,
    id,
    bends.map((b, i) => (i === index ? pos : b)),
  );
}

/**
 * Remove whatever is selected, and everything that only existed because of it.
 *
 * A `switch` with a `never`-checked default rather than the `kind === "link"`
 * test this was: a marking selection took the **node** arm, which filters nothing
 * out and yet returns a freshly built `doc` — dirtying the document and pushing
 * an undo snapshot while deleting nothing (markings spec §2.6). Nothing about
 * that is a build error, since every id is a bare `string`.
 *
 * **A marking must not outlive the road it is painted on.** Left alone it would
 * be invisible (nothing draws a marking whose link is gone), saved (`markings` is
 * serialized whatever it references) and permanent, so the file grows a ghost per
 * deleted road (§2.5). Both the link arm and the node arm drop them.
 *
 * **A sign is the other way round, and deliberately.** Nothing about a sign
 * depends on a link to be drawable — `associated_link` is context, not an anchor —
 * so deleting a road a sign happens to name clears the reference and **keeps the
 * sign** (signs spec §2.5); one that vanished because an unrelated road went would
 * be the surprising behaviour. Both arms again, because the node arm drops every
 * incident link and so strands exactly the same reference.
 *
 * **A `Junction` needs no answer at all.** It is keyed by a node and names no
 * link, so the link arm leaves `doc.junctions` untouched — and untouched *by
 * identity*, which a third cascade helper here would have had to recover with a
 * pre-check. That is what removing the turn relation from the model bought.
 */
function deleteSelection(state: EditorState): EditorState {
  const { doc, selection } = state;
  if (!selection) return state;

  switch (selection.kind) {
    case "link": {
      const links = { ...doc.layout.links };
      delete links[selection.id];
      return {
        ...state,
        doc: {
          ...doc,
          links: doc.links.filter((l) => l.id !== selection.id),
          layout: { ...doc.layout, links },
          markings: keepMarkings(doc.markings, (m) => m.link !== selection.id),
          signs: clearSignLinks(doc.signs, (l) => l === selection.id),
        },
        selection: null,
      };
    }

    case "marking": {
      // The one arm that can leave `doc` alone: deleting a marking that is
      // already gone must not dirty the document (see {@link keepMarkings}).
      const markings = keepMarkings(doc.markings, (m) => m.id !== selection.id);
      return {
        ...state,
        doc: markings === doc.markings ? doc : { ...doc, markings },
        selection: null,
      };
    }

    case "sign": {
      // The other arm that can leave `doc` alone, and it has two places to delete
      // from — `doc.signs` and `doc.layout.signs`. The length test is
      // {@link keepMarkings}'s identity trick written out: rebuilding either for a
      // sign that is already gone would dirty the document and push an undo
      // snapshot while deleting nothing (`rules/history.md`).
      const signs = doc.signs.filter((s) => s.id !== selection.id);
      if (signs.length === doc.signs.length) {
        return { ...state, selection: null };
      }
      const signViews = { ...doc.layout.signs };
      delete signViews[selection.id];
      return {
        ...state,
        doc: { ...doc, signs, layout: { ...doc.layout, signs: signViews } },
        selection: null,
      };
    }

    // The third arm that can leave `doc` alone, and the only one that touches
    // nothing but the layout: a bend is presentation, so **`doc.links` comes out
    // identical by reference** — the semantic graph has no idea the road turned.
    // That is the `clearSignLinks` identity assertion from the other side, and
    // the one thing no behavioural test can see.
    //
    // A stale index is the case §2.2's rule is meant to rule out and `restore`
    // is what actually rules out; it is guarded here anyway, on
    // {@link keepMarkings}'s terms — rebuilding for a bend that is already gone
    // would dirty the document and push an undo snapshot while deleting nothing.
    case "bend": {
      const bends = bendsOf(doc, selection.link);
      if (selection.index < 0 || selection.index >= bends.length) {
        return { ...state, selection: null };
      }
      return {
        ...withBends(
          state,
          selection.link,
          bends.filter((_, i) => i !== selection.index),
        ),
        selection: null,
      };
    }

    case "node": {
      // Deleting a node also removes its incident links, their markings, and any
      // junction record.
      const id = selection.id;
      const nodeViews = { ...doc.layout.nodes };
      delete nodeViews[id];
      const junctionViews = { ...doc.layout.junctions };
      delete junctionViews[id];
      const linkViews = { ...doc.layout.links };
      const dropped = new Set<LinkId>();
      const links = doc.links.filter((l) => {
        const incident = l.from_node === id || l.to_node === id;
        if (incident) {
          delete linkViews[l.id];
          dropped.add(l.id);
        }
        return !incident;
      });
      return {
        ...state,
        doc: {
          ...doc,
          nodes: doc.nodes.filter((n) => n.id !== id),
          links,
          // The node's own junction record goes, and no neighbour's needs
          // touching: a `Junction` names only the node it is attached to.
          junctions: doc.junctions.filter((j) => j.node_id !== id),
          layout: {
            ...doc.layout,
            nodes: nodeViews,
            links: linkViews,
            junctions: junctionViews,
          },
          markings: keepMarkings(doc.markings, (m) => !dropped.has(m.link)),
          signs: clearSignLinks(doc.signs, (l) => dropped.has(l)),
        },
        selection: null,
      };
    }

    default:
      return unreachable(selection);
  }
}
