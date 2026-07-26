/** Editor state and the reducer that drives all document edits. */

import {
  DEFAULT_LINK_STYLE,
  defaultLane,
  emptyDocument,
  findLink,
  findMarking,
  findNode,
  nextId,
  normalizeDocument,
  RawDocument,
} from "../model/document";
import {
  Document,
  Junction,
  JunctionGlyph,
  LaneIdx,
  LaneKind,
  LinkAlign,
  LinkId,
  LinkStyle,
  Marking,
  MarkingId,
  MarkingKind,
  NodeId,
  NodeKind,
  Vec2,
} from "../model/types";
import { IDENTITY_VIEW, ViewTransform } from "./geometry";

/** The active drawing tool. */
export type Tool = "select" | "node" | "link" | "marking";

/** What is currently selected on the canvas. */
export type Selection =
  | { kind: "node"; id: NodeId }
  | { kind: "link"; id: LinkId }
  | { kind: "marking"; id: MarkingId };

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
  | { type: "startLink"; from: NodeId }
  | { type: "completeLink"; to: NodeId }
  | { type: "cancelLink" }
  | { type: "setLinkLanes"; id: LinkId; count: number }
  | { type: "setLaneKind"; id: LinkId; lane: LaneIdx; kind: LaneKind }
  | { type: "setLinkStyle"; id: LinkId; style: LinkStyle }
  | { type: "setLinkAlign"; id: LinkId; align: LinkAlign }
  | { type: "addMarking"; link: LinkId; position: number; lane?: LaneIdx }
  | { type: "setMarkingKind"; id: MarkingId; kind: MarkingKind }
  | { type: "setMarkingLane"; id: MarkingId; lane?: LaneIdx }
  | { type: "select"; selection: Selection | null }
  | { type: "deleteSelection" };

/** Whole-document lifecycle actions; they manage `dirty`/`currentPath` explicitly. */
export type PersistAction =
  | { type: "loadDocument"; doc: RawDocument; path: string }
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
    // Installing a whole document resets history: there is nothing to undo
    // across a file boundary.
    case "loadDocument":
      return {
        ...state,
        doc: normalizeDocument(action.doc),
        currentPath: action.path,
        dirty: false,
        selection: null,
        linkFrom: null,
        view: IDENTITY_VIEW,
        past: [],
        future: [],
        coalesceKey: null,
      };

    case "newDocument":
      return {
        ...state,
        doc: emptyDocument("Untitled"),
        currentPath: null,
        dirty: false,
        selection: null,
        linkFrom: null,
        view: IDENTITY_VIEW,
        past: [],
        future: [],
        coalesceKey: null,
      };

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

/** Element-wise equality of two path lists. */
function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((p, i) => p === b[i]);
}

/**
 * The gesture an editing action belongs to, or `null` for a discrete edit that
 * must never merge with its neighbours. A node drag dispatches one `moveNode`
 * per pointer-move, so those collapse per node; deliberate clicks (a ±1 lane
 * stepper, say) are separate edits and each get their own undo step.
 */
function coalesceKeyFor(action: EditAction): string | null {
  return action.type === "moveNode" ? `moveNode:${action.id}` : null;
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
 */
function restore(
  state: EditorState,
  doc: Document,
  past: Document[],
  future: Document[],
): EditorState {
  return {
    ...state,
    doc,
    past,
    future,
    coalesceKey: null,
    linkFrom: null,
    dirty: true,
    selection: selectionValid(doc, state.selection) ? state.selection : null,
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
    default:
      return unreachable(sel);
  }
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

    case "addMarking":
      return addMarking(state, action.link, action.position, action.lane);

    case "setMarkingKind":
      return setMarkingKind(state, action.id, action.kind);

    case "setMarkingLane":
      return setMarkingLane(state, action.id, action.lane);

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
  if (kind === "junction" && !doc.junctions.some((j) => j.node_id === id)) {
    const j: Junction = { node_id: id, control: "unsignalized" };
    junctions = [...doc.junctions, j];
    junctionViews[id] = { glyph: "generic", rotation: 0, scale: 1 };
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
    rotation: 0,
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
          junctions: doc.junctions.filter((j) => j.node_id !== id),
          layout: {
            ...doc.layout,
            nodes: nodeViews,
            links: linkViews,
            junctions: junctionViews,
          },
          markings: keepMarkings(doc.markings, (m) => !dropped.has(m.link)),
        },
        selection: null,
      };
    }

    default:
      return unreachable(selection);
  }
}
