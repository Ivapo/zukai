/** Editor state and the reducer that drives all document edits. */

import {
  defaultLane,
  emptyDocument,
  nextId,
} from "../model/document";
import {
  Document,
  Junction,
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
}

/** Lane count a freshly drawn link starts with. */
const NEW_LINK_LANES = 1;

/** The initial state: one empty, unnamed schematic. */
export function initialState(): EditorState {
  return {
    doc: emptyDocument("Untitled"),
    view: IDENTITY_VIEW,
    tool: "select",
    selection: null,
    linkFrom: null,
  };
}

/** Every edit the UI can request. */
export type Action =
  | { type: "setTool"; tool: Tool }
  | { type: "setView"; view: ViewTransform }
  | { type: "addNode"; pos: Vec2 }
  | { type: "moveNode"; id: NodeId; pos: Vec2 }
  | { type: "setNodeKind"; id: NodeId; kind: NodeKind }
  | { type: "startLink"; from: NodeId }
  | { type: "completeLink"; to: NodeId }
  | { type: "cancelLink" }
  | { type: "setLinkLanes"; id: LinkId; count: number }
  | { type: "setLinkStyle"; id: LinkId; style: LinkStyle }
  | { type: "select"; selection: Selection | null }
  | { type: "deleteSelection" };

/** Apply an action, returning the next state (never mutates `state`). */
export function reducer(state: EditorState, action: Action): EditorState {
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
        links: { ...doc.layout.links, [id]: { style: "arterial" } },
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
