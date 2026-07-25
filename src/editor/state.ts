/** Editor state and the reducer that drives all document edits. */

import {
  DEFAULT_LINK_STYLE,
  defaultLane,
  emptyDocument,
  findLink,
  findNode,
  nextId,
  normalizeDocument,
  RawDocument,
} from "../model/document";
import {
  Document,
  Junction,
  JunctionGlyph,
  LinkId,
  LinkStyle,
  NodeId,
  NodeKind,
  Vec2,
} from "../model/types";
import { IDENTITY_VIEW, ViewTransform } from "./geometry";

/** The active drawing tool. */
export type Tool = "select" | "node" | "link";

/** What is currently selected on the canvas. */
export type Selection =
  | { kind: "node"; id: NodeId }
  | { kind: "link"; id: LinkId };

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
  | { type: "setLinkStyle"; id: LinkId; style: LinkStyle }
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

/** Whether a selection still refers to something present in `doc`. */
function selectionValid(doc: Document, sel: Selection | null): boolean {
  if (!sel) return false;
  return sel.kind === "node"
    ? findNode(doc, sel.id) !== undefined
    : findLink(doc, sel.id) !== undefined;
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

    case "setLinkStyle":
      return setLinkStyle(state, action.id, action.style);

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
          ? { ...l, lanes: Array.from({ length: n }, (_, i) => defaultLane(i)) }
          : l,
      ),
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

function deleteSelection(state: EditorState): EditorState {
  const { doc, selection } = state;
  if (!selection) return state;

  if (selection.kind === "link") {
    const links = { ...doc.layout.links };
    delete links[selection.id];
    return {
      ...state,
      doc: {
        ...doc,
        links: doc.links.filter((l) => l.id !== selection.id),
        layout: { ...doc.layout, links },
      },
      selection: null,
    };
  }

  // Deleting a node also removes its incident links and any junction record.
  const id = selection.id;
  const nodeViews = { ...doc.layout.nodes };
  delete nodeViews[id];
  const junctionViews = { ...doc.layout.junctions };
  delete junctionViews[id];
  const linkViews = { ...doc.layout.links };
  const links = doc.links.filter((l) => {
    const incident = l.from_node === id || l.to_node === id;
    if (incident) delete linkViews[l.id];
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
    },
    selection: null,
  };
}
