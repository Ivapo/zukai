/** Pure helpers for building and querying a {@link Document}. */

import {
  Document,
  Lane,
  Link,
  LinkId,
  Node,
  NodeId,
  SCHEMA_VERSION,
  Vec2,
} from "./types";

/** 50 km/h in m/s — the default speed limit, matching the Rust model. */
export const DEFAULT_SPEED_LIMIT = 13.88888888888889;
/** Default lane width in metres. */
export const DEFAULT_LANE_WIDTH = 3.5;
/** Default gap to the opposing carriageway, metres. */
export const DEFAULT_MEDIAN_GAP = 0.5;

/** An empty document at the current schema version. */
export function emptyDocument(name: string): Document {
  return {
    schema_version: SCHEMA_VERSION,
    metadata: { name },
    nodes: [],
    links: [],
    junctions: [],
    layout: { nodes: {}, links: {}, junctions: {}, signs: {} },
    markings: [],
    signs: [],
  };
}

/** A lane with default width/speed and the given index. */
export function defaultLane(id: number): Lane {
  return { id, width: DEFAULT_LANE_WIDTH, speed_limit: DEFAULT_SPEED_LIMIT };
}

/**
 * Next free id with the given prefix (`N`, `L`, …), one past the highest
 * numeric suffix already in use. Scanning (rather than a counter) keeps ids
 * stable and collision-free even after deletions.
 */
export function nextId(existing: Iterable<string>, prefix: string): string {
  let max = 0;
  for (const id of existing) {
    if (id.startsWith(prefix)) {
      const n = Number.parseInt(id.slice(prefix.length), 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return `${prefix}${max + 1}`;
}

/** Canvas position of a node, or `undefined` if it has no layout entry. */
export function nodePos(doc: Document, id: NodeId): Vec2 | undefined {
  return doc.layout.nodes[id]?.pos;
}

/**
 * The polyline a link is drawn along: its from-node, any layout bends, then its
 * to-node. Returns `undefined` if either endpoint lacks a position.
 */
export function linkPolyline(doc: Document, link: Link): Vec2[] | undefined {
  const a = nodePos(doc, link.from_node);
  const b = nodePos(doc, link.to_node);
  if (!a || !b) return undefined;
  const bends = doc.layout.links[link.id]?.bends ?? [];
  return [a, ...bends, b];
}

/** Look up a node by id. */
export function findNode(doc: Document, id: NodeId): Node | undefined {
  return doc.nodes.find((n) => n.id === id);
}

/** Look up a link by id. */
export function findLink(doc: Document, id: LinkId): Link | undefined {
  return doc.links.find((l) => l.id === id);
}
