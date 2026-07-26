/** Pure helpers for building and querying a {@link Document}. */

import {
  Document,
  Junction,
  Lane,
  Layout,
  Link,
  LinkAlign,
  LinkId,
  LinkStyle,
  Marking,
  MarkingId,
  Node,
  NodeId,
  SCHEMA_VERSION,
  Sign,
  SignId,
  Vec2,
} from "./types";

/** 50 km/h in m/s — the default speed limit, matching the Rust model. */
export const DEFAULT_SPEED_LIMIT = 13.88888888888889;
/** Default lane width in metres. */
export const DEFAULT_LANE_WIDTH = 3.5;
/** Default gap to the opposing carriageway, metres. */
export const DEFAULT_MEDIAN_GAP = 0.5;
/** The road class a link is created as, and drawn as when it has no layout entry. */
export const DEFAULT_LINK_STYLE: LinkStyle = "arterial";
/** How a link is drawn when nothing says otherwise: centred on its polyline. */
export const DEFAULT_LINK_ALIGN: LinkAlign = "centre";

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

/**
 * A document as it may arrive from the `load_document` command. Rust drops empty
 * collections and layout sub-maps from the wire (`skip_serializing_if`), so every
 * collection here is optional; `schema_version`/`metadata` are always emitted.
 */
export type RawDocument = Pick<Document, "schema_version" | "metadata"> &
  Partial<Omit<Document, "schema_version" | "metadata" | "layout">> & {
    layout?: Partial<Layout>;
  };

/**
 * Fill any collection or layout sub-map the loader omitted, yielding a `Document`
 * the frontend can consume without guarding every `.map`/lookup. Applied at exactly
 * one boundary (the `loadDocument` reducer case); also hardens hand-edited files.
 */
export function normalizeDocument(raw: RawDocument): Document {
  const layout = raw.layout ?? {};
  return {
    schema_version: raw.schema_version,
    metadata: raw.metadata,
    nodes: raw.nodes ?? [],
    links: raw.links ?? [],
    junctions: raw.junctions ?? [],
    layout: {
      nodes: layout.nodes ?? {},
      links: layout.links ?? {},
      junctions: layout.junctions ?? {},
      signs: layout.signs ?? {},
    },
    markings: raw.markings ?? [],
    signs: raw.signs ?? [],
  };
}

/** Display name for the document's backing file: its basename, or "Untitled". */
export function fileLabel(currentPath: string | null): string {
  return currentPath ? currentPath.split(/[\\/]/).pop()! : "Untitled";
}

/** The extension Zukai documents are saved under. */
export const ZKAI_EXTENSION = "zkai";

/**
 * Add an extension to a path that has none. Save dialogs vary by platform in
 * whether they append the filter's extension, so a name typed as `foo` still
 * lands as `foo.zkai`; a name with any other extension is left alone (the user
 * asked for it — an export named `drawing.jpg` is written as `drawing.jpg`).
 */
export function ensureExtension(path: string, ext: string): string {
  const base = path.split(/[\\/]/).pop() ?? "";
  return base.includes(".") ? path : `${path}.${ext}`;
}

/** {@link ensureExtension} for the `.zkai` document format. */
export function ensureZkaiExtension(path: string): string {
  return ensureExtension(path, ZKAI_EXTENSION);
}

/**
 * The path with its extension *replaced* (or added). For a dialog's default
 * name, where `ensureExtension` is the wrong tool: exporting `interchange.zkai`
 * should propose `interchange.svg`, not leave the `.zkai` in place.
 *
 * A leading dot is part of the name, not an extension, so `.hidden` gains the
 * extension rather than losing its name.
 */
export function withExtension(path: string, ext: string): string {
  const start = path.length - (path.split(/[\\/]/).pop() ?? "").length;
  const dot = path.lastIndexOf(".");
  // `dot > start` keeps a dotted *directory* and a leading-dot basename alone.
  return `${dot > start ? path.slice(0, dot) : path}.${ext}`;
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

/**
 * The road class a link is drawn as: its layout entry's, or the default for a
 * link that has none — an imported or hand-edited document need not carry one.
 */
export function linkStyle(doc: Document, id: LinkId): LinkStyle {
  return doc.layout.links[id]?.style ?? DEFAULT_LINK_STYLE;
}

/**
 * Which of a link's edges stays on its polyline. Absent means centred — the way
 * every road was drawn before alignment existed, and the way Rust writes a
 * centred link back (the `align` key is elided).
 */
export function linkAlign(doc: Document, id: LinkId): LinkAlign {
  return doc.layout.links[id]?.align ?? DEFAULT_LINK_ALIGN;
}

/** Look up a node by id. */
export function findNode(doc: Document, id: NodeId): Node | undefined {
  return doc.nodes.find((n) => n.id === id);
}

/** Look up a link by id. */
export function findLink(doc: Document, id: LinkId): Link | undefined {
  return doc.links.find((l) => l.id === id);
}

/**
 * Look up the junction record attached to a node.
 *
 * Keyed by **`node_id`**, not by an id of its own: a `Junction` is a record
 * *about* a node rather than an entity beside it, which is why this is the one
 * finder whose predicate does not read `.id`. Absent is not an error — a
 * junction-kind node with no record is what a hand-edited file can carry, and
 * every action that writes one returns `state` by identity for it.
 */
export function findJunction(doc: Document, id: NodeId): Junction | undefined {
  return doc.junctions.find((j) => j.node_id === id);
}

/** Look up a road-surface marking by id. */
export function findMarking(doc: Document, id: MarkingId): Marking | undefined {
  return doc.markings.find((m) => m.id === id);
}

/**
 * Look up a roadside sign by id.
 *
 * There is deliberately **no `signPos` twin of {@link nodePos}**: that helper
 * exists because a `NodeView` wraps its point, while `layout.signs[id]` *is* the
 * `Vec2` (mirroring Rust's `BTreeMap<SignId, Vec2>`), so a helper would add a name
 * and nothing else. Readers index it directly.
 */
export function findSign(doc: Document, id: SignId): Sign | undefined {
  return doc.signs.find((s) => s.id === id);
}
