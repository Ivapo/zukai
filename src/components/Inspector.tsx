/** Right panel: properties of the current selection, or a getting-started hint. */

import type { ReactNode } from "react";
import { findLink, findNode, linkAlign, linkStyle } from "../model/document";
import {
  JunctionGlyph,
  Lane,
  LaneKind,
  LinkAlign,
  LinkId,
  LinkStyle,
  Node,
  NodeKind,
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
          <b>Select</b> tool — drag nodes, pick a road, edit it here.
        </li>
      </ol>
      <p className="empty-tip">
        Scroll to zoom · drag empty space to pan · Delete removes the selection.
      </p>
    </div>
  );
}
