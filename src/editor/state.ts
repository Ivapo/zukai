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
  LinkId,
  LinkStyle,
  Marking,
  MarkingId,
  MarkingKind,
  Movement,
  MovementId,
  MovementKind,
  NodeId,
  NodeKind,
  Sign,
  SignId,
  SignKind,
  UnsignalizedRule,
  Vec2,
} from "../model/types";
import {
  IDENTITY_VIEW,
  movementId,
  movementKind,
  ViewTransform,
} from "./geometry";

/** The active drawing tool. */
export type Tool = "select" | "node" | "link" | "marking" | "sign";

/** What is currently selected on the canvas. */
export type Selection =
  | { kind: "node"; id: NodeId }
  | { kind: "link"; id: LinkId }
  | { kind: "marking"; id: MarkingId }
  | { kind: "sign"; id: SignId };

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
  // `id` is the **junction node**, and the movement a second field —
  // `setLaneKind`'s shape, because a movement lives inside a `Junction` the way a
  // lane lives inside a `Link`. There is no `Selection` arm for either.
  | { type: "addMovement"; id: NodeId; from: LinkId; to: LinkId }
  | { type: "deleteMovement"; id: NodeId; movement: MovementId }
  | {
      type: "setMovementKind";
      id: NodeId;
      movement: MovementId;
      kind: MovementKind;
    }
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
 */
function coalesceKeyFor(action: EditAction): string | null {
  if (action.type === "moveNode") return `moveNode:${action.id}`;
  if (action.type === "moveSign") return `moveSign:${action.id}`;
  if (action.type === "setMarkingKind" && action.kind.type === "text")
    return action.kind.content === "" ? null : `markingText:${action.id}`;
  if (action.type === "setSignKind" && action.kind.type === "custom")
    return action.kind.label === "" ? null : `signLabel:${action.id}`;
  if (action.type === "setSignKind" && action.kind.type === "warning")
    return action.kind.symbol === "" ? null : `signSymbol:${action.id}`;
  if (action.type === "setSignKind" && action.kind.type === "direction")
    return action.kind.text === "" ? null : `signText:${action.id}`;
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
    case "sign":
      return findSign(doc, sel.id) !== undefined;
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

    case "setJunctionControl":
      return setJunctionControl(state, action.id, action.control);

    case "setJunctionRule":
      return setJunctionRule(state, action.id, action.rule);

    case "addMovement":
      return addMovement(state, action.id, action.from, action.to);

    case "deleteMovement":
      return deleteMovement(state, action.id, action.movement);

    case "setMovementKind":
      return setMovementKind(state, action.id, action.movement, action.kind);

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

/**
 * The glyph a control change **nudges** to, or `undefined` for one it must leave
 * alone (junction semantics §2.2).
 *
 * The glyph and the control are two different questions — one is presentation
 * (six drawings, dropped on export), the other is semantics (two values, exported
 * to Assimilator) — and a signalised junction drawn as a plain pad is a legitimate
 * schematic choice. But leaving them wholly independent leaves the contradiction
 * this phase exists to fix: a drawing with signal heads over a document that says
 * the junction is uncontrolled.
 *
 * So the answer is a nudge rather than a constraint, and the **"only from the
 * default"** clause is the whole of it: `generic` is what `setNodeKind` mints and
 * so is the glyph nobody chose, while `roundabout`, `gore`, `priority_cross` and
 * `t_junction` are each a human's deliberate pick and are never overwritten. The
 * traffic runs one way — presentation may follow semantics, never the reverse, so
 * nothing here has a twin in `setJunctionView`.
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

/**
 * One `Junction` inside `doc.junctions` with its movement list replaced — the one
 * place the three movement actions write, so the empty-list rule is stated once.
 *
 * **An empty list is stored as an absent key**, never as `[]`: Rust elides an empty
 * vec (`skip_serializing_if = "Vec::is_empty"`), so two encodings of "no movements"
 * would differ by document identity while saving to the same bytes — the
 * one-representation rule `rule`, `lane` and `associated_link` all follow.
 *
 * Every other junction is returned **by identity**, so a document with two
 * intersections shares the untouched one with its history snapshots.
 */
function withMovements(
  junctions: Junction[],
  id: NodeId,
  movements: Movement[],
): Junction[] {
  return junctions.map((j) => {
    if (j.node_id !== id) return j;
    const { movements: _dropped, ...rest } = j;
    return movements.length === 0 ? rest : { ...rest, movements };
  });
}

/**
 * Permit a turn through a junction — **the first thing that has ever written
 * `Junction.movements`**, a field in both mirrors since the first commit that
 * nothing had read.
 *
 * A movement is a *relation*, not an object on the canvas: it is minted by naming
 * two links rather than by pointing at a place, the way {@link setLinkLanes} mints
 * a `Lane`. So there is no tool, no gesture and no `Selection` arm — and nothing
 * here touches `state.selection` (junction semantics §2.3).
 *
 * **The legality rule is topological, and that is the whole of it**: a `Link` is
 * directed, so the approach is one that *ends* at the node and the exit one that
 * *starts* there. Drawability is deliberately not checked — `legalMovements` skips
 * an undrawable link so the picker never offers one, but a hand-edited document
 * that carries the turn anyway is not corrected here (§2.4).
 *
 * **The id is the duplicate check.** `M_<from>_<to>` *is* the ordered pair, so one
 * movement per pair falls out of an id lookup rather than a second predicate.
 *
 * `from_lanes`/`to_lanes` are left absent: a lane-pair matrix is a second editor
 * and the schematic reads the same without it (§2.8, OQ-4). Every rejection returns
 * `state` itself, so {@link recordHistory} records nothing.
 */
function addMovement(
  state: EditorState,
  nodeId: NodeId,
  from: LinkId,
  to: LinkId,
): EditorState {
  const { doc } = state;
  const junction = findJunction(doc, nodeId);
  if (!junction) return state;

  const fromLink = findLink(doc, from);
  const toLink = findLink(doc, to);
  if (!fromLink || !toLink || from === to) return state;
  if (fromLink.to_node !== nodeId || toLink.from_node !== nodeId) return state;

  const id = movementId(from, to);
  const movements = junction.movements ?? [];
  if (movements.some((m) => m.id === id)) return state;

  const movement: Movement = {
    id,
    from_link: from,
    to_link: to,
    type: movementKind(doc, nodeId, from, to),
  };
  return {
    ...state,
    doc: {
      ...doc,
      junctions: withMovements(doc.junctions, nodeId, [...movements, movement]),
    },
  };
}

/**
 * Withdraw one permitted turn — the per-row button in the panel, **not** the Delete
 * key: a movement is not selectable, so `deleteSelection` never sees one (§2.3).
 *
 * Deleting the last one leaves **no `movements` key at all**, per
 * {@link withMovements}. A movement that is already gone returns `state` itself.
 */
function deleteMovement(
  state: EditorState,
  nodeId: NodeId,
  id: MovementId,
): EditorState {
  const { doc } = state;
  const movements = findJunction(doc, nodeId)?.movements;
  if (!movements || !movements.some((m) => m.id === id)) return state;

  return {
    ...state,
    doc: {
      ...doc,
      junctions: withMovements(
        doc.junctions,
        nodeId,
        movements.filter((m) => m.id !== id),
      ),
    },
  };
}

/**
 * Re-categorise a turn by hand — the repair for the cases {@link movementKind}
 * cannot classify: a link with no drawable polyline, and the degenerate bearings
 * §2.4's bands assign by convention rather than by measurement.
 *
 * A movement already of that kind returns `state` by identity, which is what
 * re-picking the current option in the row's dropdown does.
 */
function setMovementKind(
  state: EditorState,
  nodeId: NodeId,
  id: MovementId,
  kind: MovementKind,
): EditorState {
  const { doc } = state;
  const movements = findJunction(doc, nodeId)?.movements;
  if (!movements) return state;
  const movement = movements.find((m) => m.id === id);
  if (!movement || movement.type === kind) return state;

  return {
    ...state,
    doc: {
      ...doc,
      junctions: withMovements(
        doc.junctions,
        nodeId,
        movements.map((m) => (m.id === id ? { ...m, type: kind } : m)),
      ),
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
 * `junctions` with every movement naming a link the caller says is `gone`
 * **dropped**, and the **same array** back when none was.
 *
 * The third answer to "what happens to a decoration when its road goes", and it is
 * {@link keepMarkings}'s rather than {@link clearSignLinks}'s: a `Marking` whose
 * link is deleted would be invisible-but-saved, a `Sign` is free-standing and keeps
 * standing, and a `Movement` naming a deleted link is not a degraded object but a
 * **meaningless** one — a turn from nowhere to nowhere is not a turn (junction
 * semantics §2.5).
 *
 * Structurally it is {@link clearSignLinks}, though, because it rewrites junctions
 * rather than removing them: a `map` always returns a fresh array, so the identity
 * has to be recovered by the **pre-check** rather than by a length comparison, or
 * every link deletion in a document with a junction hands history a fresh
 * `doc.junctions` for something nothing changed in. Untouched junctions keep their
 * own identity too, and a junction left with no movements loses the key
 * ({@link withMovements}'s rule, applied inline here since the id is not known).
 */
function dropMovements(
  junctions: Junction[],
  gone: (link: LinkId) => boolean,
): Junction[] {
  const stranded = (m: Movement) => gone(m.from_link) || gone(m.to_link);
  if (!junctions.some((j) => j.movements?.some(stranded))) return junctions;
  return junctions.map((j) => {
    const kept = j.movements?.filter((m) => !stranded(m));
    if (kept === undefined || kept.length === j.movements?.length) return j;
    const { movements: _dropped, ...rest } = j;
    return kept.length === 0 ? rest : { ...rest, movements: kept };
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
 * **A movement takes the marking's answer** ({@link dropMovements}): a turn from
 * nowhere to nowhere is not a turn. Both arms once more — and unlike the two
 * above, the node arm's job here is about *other* junctions, since the deleted
 * node's own record goes whole.
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
          junctions: dropMovements(doc.junctions, (l) => l === selection.id),
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
          // The node's own junction record goes; then the links it took with it
          // are cleaned out of *other* junctions' movements — a neighbouring
          // intersection can perfectly well permit a turn onto a road that ended
          // here, and `dropped` is the set this arm already built.
          junctions: dropMovements(
            doc.junctions.filter((j) => j.node_id !== id),
            (l) => dropped.has(l),
          ),
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
