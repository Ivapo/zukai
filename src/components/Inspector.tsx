/** Right panel: properties of the current selection, or a getting-started hint. */

import type { ReactNode } from "react";
import {
  findLink,
  findMarking,
  findNode,
  linkAlign,
  linkStyle,
} from "../model/document";
import {
  JunctionGlyph,
  Lane,
  LaneIdx,
  LaneKind,
  LineStyle,
  LinkAlign,
  LinkId,
  LinkStyle,
  Marking,
  MarkingId,
  MarkingKind,
  Node,
  NodeKind,
  TurnDirection,
} from "../model/types";
import { Action, EditorState } from "../editor/state";

interface InspectorProps {
  state: EditorState;
  dispatch: (action: Action) => void;
}

const NODE_KINDS: NodeKind[] = ["endpoint", "junction", "waypoint"];
const LINK_STYLES: LinkStyle[] = ["motorway", "arterial", "local", "ramp"];
/**
 * Which edge of the road stays on its polyline. `nearside` and `offside` name
 * the road's own sides, the same way the lane rows below do — the point of the
 * control is to hold one edge still across a lane change, so it is spelled in
 * the road's frame rather than as left/right on the screen.
 */
const LINK_ALIGNS: LinkAlign[] = ["centre", "nearside", "offside"];
/** Lane kinds, in the order the dropdown offers them; `general` is the default. */
const LANE_KINDS: { value: LaneKind; label: string }[] = [
  { value: "general", label: "General" },
  { value: "shoulder", label: "Hard shoulder" },
  { value: "bus", label: "Bus lane" },
  { value: "cycle", label: "Cycle lane" },
  { value: "turn", label: "Turn pocket" },
];
/**
 * How each kind of paint is named in the panel. Exhaustive over `MarkingKind`, so
 * a kind added to the model without a label here will not build — the Kind picker
 * reads the same table.
 */
const MARKING_KINDS: Record<MarkingKind["type"], string> = {
  stop_line: "Stop line",
  give_way_line: "Give-way line",
  crosswalk: "Crossing",
  turn_arrow: "Turn arrow",
  lane_line: "Lane line",
  hatching: "Hatching",
  text: "Text",
};
/**
 * The kinds the picker offers, in order, each carrying the payload a fresh pick
 * starts from — `setMarkingKind` takes a whole `MarkingKind`, so the default for
 * a turn arrow's directions and a lane line's style belongs here rather than in
 * the reducer.
 *
 * A **separate list** from the labels above rather than a reordering of them, so
 * that table stays exhaustive: `hatching` is an area rather than paint at a point
 * on one link and is out of scope (markings spec §2.10) — but a hand-edited
 * document can still carry it, and the panel has to be able to name what it is
 * showing.
 *
 * `text` joined the list once a font travelled inside an exported picture (signs
 * spec Phase 1). Its fresh payload is the **empty** string, which draws the
 * placeholder bar: a marking you can see, select, and then type into, rather than
 * an invisible object findable only by accident.
 */
const MARKING_PICKER: MarkingKind[] = [
  { type: "stop_line" },
  { type: "give_way_line" },
  { type: "crosswalk" },
  { type: "turn_arrow", directions: ["through"] },
  { type: "lane_line", style: "solid" },
  { type: "text", content: "" },
];
/**
 * A turn arrow's directions, **in road order left to right** rather than in the
 * model's declaration order — the row then reads like the arrow it describes.
 *
 * It is also the canonical order the stored array is rebuilt in, so two documents
 * that ended up with the same arrow hold the same list whatever order the user
 * clicked it in.
 */
const TURN_DIRECTIONS: { value: TurnDirection; label: string }[] = [
  { value: "u_turn", label: "U-turn" },
  { value: "left", label: "Left" },
  { value: "slight_left", label: "Slight left" },
  { value: "through", label: "Through" },
  { value: "slight_right", label: "Slight right" },
  { value: "right", label: "Right" },
];
/**
 * What a lane line looks like, in weight order. `solid` is what
 * `MARKING_PICKER` mints, so this control is the only route to the other two — a
 * `dashed` line and the `double` centreline an undivided two-way road wants.
 */
const LINE_STYLES: { value: LineStyle; label: string }[] = [
  { value: "solid", label: "Solid" },
  { value: "dashed", label: "Dashed" },
  { value: "double", label: "Double" },
];
const GLYPHS: { value: JunctionGlyph; label: string }[] = [
  { value: "generic", label: "Plain" },
  { value: "roundabout", label: "Roundabout" },
  { value: "signalized_cross", label: "Signals" },
  { value: "priority_cross", label: "Priority" },
  { value: "t_junction", label: "T-junction" },
  { value: "gore", label: "Gore" },
];

export function Inspector({ state, dispatch }: InspectorProps) {
  const { doc, selection } = state;

  if (!selection) {
    return (
      <aside className="inspector">
        <EmptyState />
      </aside>
    );
  }

  if (selection.kind === "node") {
    const node = findNode(doc, selection.id);
    if (!node) return <aside className="inspector" />;
    return (
      <aside className="inspector">
        <div className="inspector-head">
          <span className="inspector-kind">Node</span>
          <span className="inspector-id">{node.id}</span>
        </div>

        <Field label="Type">
          <div className="segmented">
            {NODE_KINDS.map((k) => (
              <button
                key={k}
                className={`seg${node.type === k ? " is-active" : ""}`}
                onClick={() =>
                  dispatch({ type: "setNodeKind", id: node.id, kind: k })
                }
              >
                {k}
              </button>
            ))}
          </div>
        </Field>

        {node.type === "junction" && (
          <JunctionFields
            node={node}
            state={state}
            dispatch={dispatch}
          />
        )}

        <button
          className="danger"
          onClick={() => dispatch({ type: "deleteSelection" })}
        >
          Delete node
        </button>
      </aside>
    );
  }

  // An arm of its own, and it has to be explicit: every id is a bare
  // `type X = string`, so without this a marking selection would fall through to
  // the link branch below, miss `findLink`, and render the blank `<aside>` —
  // not a wrong panel but *no* panel, with nothing to say why (markings §2.6).
  if (selection.kind === "marking") {
    const marking = findMarking(doc, selection.id);
    if (!marking) return <aside className="inspector" />;
    // A marking whose link is gone draws nothing and cannot be spanned across
    // lanes it has no count for; the panel falls back to reporting what it has.
    const lanes = findLink(doc, marking.link)?.lanes.length;
    return (
      <aside className="inspector">
        <div className="inspector-head">
          <span className="inspector-kind">Marking</span>
          <span className="inspector-id">{marking.id}</span>
        </div>

        <Field label="Paint">
          <MarkingKindPicker marking={marking} lanes={lanes} dispatch={dispatch} />
        </Field>

        {marking.kind.type === "turn_arrow" && (
          <Field label="Directions">
            <MarkingDirections
              id={marking.id}
              directions={marking.kind.directions}
              dispatch={dispatch}
            />
          </Field>
        )}

        {marking.kind.type === "lane_line" && (
          <Field label="Style">
            <MarkingLineStyle
              id={marking.id}
              style={marking.kind.style}
              dispatch={dispatch}
            />
          </Field>
        )}

        {marking.kind.type === "text" && (
          <Field label="Words">
            <MarkingText
              id={marking.id}
              content={marking.kind.content}
              dispatch={dispatch}
            />
          </Field>
        )}

        <Field label="Road">
          <div className="readout">{marking.link}</div>
        </Field>

        <Field label="Span">
          {lanes === undefined ? (
            <div className="readout">
              {marking.lane === undefined
                ? "Whole carriageway"
                : `Lane ${marking.lane}`}
            </div>
          ) : (
            <MarkingSpan marking={marking} lanes={lanes} dispatch={dispatch} />
          )}
        </Field>

        {/* A lane line paints its boundary for the whole link and `position` is
            ignored (§2.3), so reporting a distance for one would be a small lie
            at the only place the panel could tell the truth. */}
        <Field label="Position">
          <div className="readout">
            {marking.kind.type === "lane_line"
              ? "Whole link"
              : `${marking.position.toFixed(1)} m`}
          </div>
        </Field>

        <button
          className="danger"
          onClick={() => dispatch({ type: "deleteSelection" })}
        >
          Delete marking
        </button>
      </aside>
    );
  }

  const link = findLink(doc, selection.id);
  if (!link) return <aside className="inspector" />;
  const laneCount = link.lanes.length;
  const style = linkStyle(doc, link.id);
  const align = linkAlign(doc, link.id);
  return (
    <aside className="inspector">
      <div className="inspector-head">
        <span className="inspector-kind">Link</span>
        <span className="inspector-id">{link.id}</span>
      </div>

      <Field label="Direction">
        <div className="direction">
          {link.from_node} <span className="arrow">→</span> {link.to_node}
        </div>
      </Field>

      <Field label="Lanes">
        <div className="stepper">
          <button
            onClick={() =>
              dispatch({ type: "setLinkLanes", id: link.id, count: laneCount - 1 })
            }
            disabled={laneCount <= 1}
          >
            −
          </button>
          <span className="stepper-value">{laneCount}</span>
          <button
            onClick={() =>
              dispatch({ type: "setLinkLanes", id: link.id, count: laneCount + 1 })
            }
            disabled={laneCount >= 8}
          >
            +
          </button>
        </div>
      </Field>

      <Field label="Lane kinds">
        <LaneKinds link={link.id} lanes={link.lanes} dispatch={dispatch} />
      </Field>

      <Field label="Road class">
        <div className="segmented segmented-wrap">
          {LINK_STYLES.map((s) => (
            <button
              key={s}
              className={`seg${style === s ? " is-active" : ""}`}
              onClick={() => dispatch({ type: "setLinkStyle", id: link.id, style: s })}
            >
              {s}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Alignment">
        <div className="segmented segmented-wrap">
          {LINK_ALIGNS.map((a) => (
            <button
              key={a}
              className={`seg${align === a ? " is-active" : ""}`}
              onClick={() => dispatch({ type: "setLinkAlign", id: link.id, align: a })}
            >
              {a}
            </button>
          ))}
        </div>
      </Field>

      <button
        className="danger"
        onClick={() => dispatch({ type: "deleteSelection" })}
      >
        Delete link
      </button>
    </aside>
  );
}

/**
 * What this marking paints — the control that turns the `stop_line` every
 * placement mints into anything else (markings spec §2.4).
 *
 * **`lane_line` is withheld while `lane` names the offside-most lane.** A lane
 * line's `lane` names a *boundary*, and `n` lanes have only `n-1` of them, so
 * `lane = n-1` names none: the renderer would skip it and the drawing would
 * silently lose a line the user just asked for (§2.3). The remedy is to set a
 * valid span first, not to re-home the marking behind their back.
 */
function MarkingKindPicker({
  marking,
  lanes,
  dispatch,
}: {
  marking: Marking;
  lanes: number | undefined;
  dispatch: (action: Action) => void;
}) {
  const onLastLane =
    marking.lane !== undefined && lanes !== undefined && marking.lane >= lanes - 1;
  return (
    <div className="segmented segmented-wrap segmented-labels segmented-kinds">
      {MARKING_PICKER.filter(
        (k) => k.type !== "lane_line" || !onLastLane,
      ).map((k) => (
        <button
          key={k.type}
          className={`seg${marking.kind.type === k.type ? " is-active" : ""}`}
          onClick={() =>
            dispatch({ type: "setMarkingKind", id: marking.id, kind: k })
          }
        >
          {MARKING_KINDS[k.type]}
        </button>
      ))}
    </div>
  );
}

/**
 * Which ways a turn arrow points — the one control that is a **multi**-select,
 * because an arrow is one shaft with a branch per direction rather than one arrow
 * per direction: a shared through/right lane carries a single arrow (§2.7).
 *
 * It needs no action of its own. `setMarkingKind` carries the whole tagged
 * `MarkingKind`, which is exactly what that decision bought — and it never names
 * `lane`, so toggling a direction leaves the arrow where it is.
 *
 * **The last direction standing cannot be turned off**, the way the lane stepper
 * refuses to go below one: an arrow with no branches is a bare line up the lane's
 * centre, which reads as a lane line. The renderer falls back to the placeholder
 * bar for one anyway, but only a hand-edited document should ever see it.
 */
function MarkingDirections({
  id,
  directions,
  dispatch,
}: {
  id: MarkingId;
  directions: TurnDirection[];
  dispatch: (action: Action) => void;
}) {
  const set = (next: TurnDirection[]) =>
    dispatch({ type: "setMarkingKind", id, kind: { type: "turn_arrow", directions: next } });

  return (
    <div className="segmented segmented-wrap segmented-labels segmented-dirs">
      {TURN_DIRECTIONS.map((d) => {
        const on = directions.includes(d.value);
        return (
          <button
            key={d.value}
            className={`seg${on ? " is-active" : ""}`}
            disabled={on && directions.length === 1}
            onClick={() =>
              set(
                on
                  ? directions.filter((x) => x !== d.value)
                  : // Rebuilt in the table's order, so the stored list does not
                    // depend on the order the user clicked it in.
                    TURN_DIRECTIONS.filter(
                      (t) => t.value === d.value || directions.includes(t.value),
                    ).map((t) => t.value),
              )
            }
          >
            {d.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * What a lane line looks like — the third dispatcher of `setMarkingKind`, and
 * for the same reason the directions control is the second: the action carries
 * the **whole tagged `MarkingKind`**, so a payload field needs no action of its
 * own, and naming nothing else is what keeps a repaint from moving the marking.
 *
 * Single-select, unlike the directions beside it: a line has one style, where an
 * arrow has one shaft and any number of branches.
 */
function MarkingLineStyle({
  id,
  style,
  dispatch,
}: {
  id: MarkingId;
  style: LineStyle;
  dispatch: (action: Action) => void;
}) {
  return (
    <div className="segmented">
      {LINE_STYLES.map((s) => (
        <button
          key={s.value}
          className={`seg${style === s.value ? " is-active" : ""}`}
          onClick={() =>
            dispatch({
              type: "setMarkingKind",
              id,
              kind: { type: "lane_line", style: s.value },
            })
          }
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

/**
 * What a text marking says — the **fourth** dispatcher of `setMarkingKind`, and
 * still no action of its own, which is what markings Phase 2's "carry the whole
 * tagged `MarkingKind`" bought (signs spec Phase 1).
 *
 * **The panel's first `<input>`, and the first control that is not a click.** Two
 * consequences it inherits rather than solves:
 *
 * - the app's global key handler already ignores keystrokes aimed at an `INPUT`,
 *   so typing `m` here switches no tool and Backspace deletes no marking;
 * - a keystroke is an edit, so this dispatches on every one — the paint follows
 *   the typing — and `coalesceKeyFor` collapses the run into a single undo step,
 *   the way it does for a node drag. The empty payload the picker mints is
 *   deliberately outside that gesture, so one undo after picking Text and typing
 *   a word clears the word rather than the kind.
 *
 * Controlled by the document rather than by local state: the marking *is* the
 * value, and a second copy of it here could disagree with the drawing after an
 * undo.
 */
function MarkingText({
  id,
  content,
  dispatch,
}: {
  id: MarkingId;
  content: string;
  dispatch: (action: Action) => void;
}) {
  return (
    <input
      className="text-field"
      type="text"
      value={content}
      placeholder="BUS"
      spellCheck={false}
      autoComplete="off"
      onChange={(e) =>
        dispatch({
          type: "setMarkingKind",
          id,
          kind: { type: "text", content: e.target.value },
        })
      }
    />
  );
}

/**
 * What the marking spans, and **the deliberate route to a carriageway-wide
 * marking** — which placement can otherwise only reach by clicking the 1.5-unit
 * casing lip, a gesture nobody finds (§2.4).
 *
 * Kind-aware, in the two ways §2.3 and §2.7 require:
 *
 * - a **`lane_line` names a boundary, not a lane**, so it offers `Centreline`
 *   plus `0|1 … n-2|n-1` — one fewer entry than there are lanes;
 * - a **`turn_arrow` has no carriageway-wide meaning**, so it offers lanes only.
 *   Switching a carriageway-wide marking to one preserves its absent `lane`, so
 *   no entry reads as active until a lane is picked; it draws in the nearside
 *   lane meanwhile.
 */
function MarkingSpan({
  marking,
  lanes,
  dispatch,
}: {
  marking: Marking;
  lanes: number;
  dispatch: (action: Action) => void;
}) {
  const boundaries = marking.kind.type === "lane_line";
  const count = boundaries ? lanes - 1 : lanes;
  const wide = boundaries ? "Centreline" : "Whole carriageway";
  const set = (lane: LaneIdx | undefined) =>
    dispatch({ type: "setMarkingLane", id: marking.id, lane });

  return (
    <div className="segmented segmented-wrap segmented-labels">
      {marking.kind.type !== "turn_arrow" && (
        <button
          className={`seg seg-wide${marking.lane === undefined ? " is-active" : ""}`}
          onClick={() => set(undefined)}
        >
          {wide}
        </button>
      )}
      {Array.from({ length: Math.max(0, count) }, (_, i) => (
        <button
          key={i}
          className={`seg${marking.lane === i ? " is-active" : ""}`}
          onClick={() => set(i)}
        >
          {boundaries ? `${i}|${i + 1}` : i}
        </button>
      ))}
    </div>
  );
}

/**
 * One dropdown per lane, in array order — the whole cross-section of the road,
 * readable at a glance rather than a lane at a time.
 *
 * The row order *is* the road's order, and the first row is labelled: lane 0 is
 * the nearside (kerb) lane, which is why a hard shoulder set there draws on the
 * outside rather than in the median. Nothing else in the UI says so.
 */
function LaneKinds({
  link,
  lanes,
  dispatch,
}: {
  link: LinkId;
  lanes: Lane[];
  dispatch: (action: Action) => void;
}) {
  return (
    <div className="lane-kinds">
      {lanes.map((lane, i) => (
        <div className="lane-kind-row" key={i}>
          <span className="lane-kind-idx">{i}</span>
          <select
            className="lane-kind-select"
            value={lane.kind ?? "general"}
            onChange={(e) =>
              dispatch({
                type: "setLaneKind",
                id: link,
                lane: i,
                kind: e.target.value as LaneKind,
              })
            }
          >
            {LANE_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
          {i === 0 && <span className="lane-kind-note">nearside</span>}
        </div>
      ))}
    </div>
  );
}

function JunctionFields({
  node,
  state,
  dispatch,
}: {
  node: Node;
  state: EditorState;
  dispatch: (action: Action) => void;
}) {
  const view = state.doc.layout.junctions[node.id];
  const glyph = view?.glyph ?? "generic";
  const scale = view?.scale ?? 1;
  return (
    <>
      <Field label="Glyph">
        <div className="segmented segmented-wrap">
          {GLYPHS.map((g) => (
            <button
              key={g.value}
              className={`seg${glyph === g.value ? " is-active" : ""}`}
              onClick={() =>
                dispatch({ type: "setJunctionGlyph", id: node.id, glyph: g.value })
              }
            >
              {g.label}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Size">
        <div className="stepper">
          <button
            onClick={() =>
              dispatch({ type: "setJunctionScale", id: node.id, scale: scale - 0.25 })
            }
            disabled={scale <= 0.5}
          >
            −
          </button>
          <span className="stepper-value">{scale.toFixed(2)}×</span>
          <button
            onClick={() =>
              dispatch({ type: "setJunctionScale", id: node.id, scale: scale + 0.25 })
            }
            disabled={scale >= 2.5}
          >
            +
          </button>
        </div>
      </Field>
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <label className="field-label">{label}</label>
      {children}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="empty">
      <p className="empty-title">Nothing selected</p>
      <ol className="empty-steps">
        <li>
          <b>Node</b> tool — click to drop a road point.
        </li>
        <li>
          <b>Link</b> tool — click one node, then another, to lay a road.
        </li>
        <li>
          <b>Marking</b> tool — click a lane to paint a stop line on it.
        </li>
        <li>
          <b>Select</b> tool — drag nodes, pick a road, edit it here.
        </li>
      </ol>
      <p className="empty-tip">
        Scroll to zoom · drag empty space to pan · Delete removes the selection.
      </p>
    </div>
  );
}
