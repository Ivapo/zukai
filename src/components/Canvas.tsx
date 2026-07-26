/** The SVG drawing surface: grid, view transform, and all pointer interaction. */

import type React from "react";
import { useRef, useState } from "react";
import { findLink, linkStyle, nodePos } from "../model/document";
import { Link, Marking, Node, NodeId, Vec2 } from "../model/types";
import {
  LANE_PX,
  UNITS_PER_METRE,
  carriageways,
  drawnPolyline,
  laneBands,
  nearestOnPolyline,
  screenToWorld,
  zoomAbout,
} from "../editor/geometry";
import { Action, EditorState } from "../editor/state";
import { Diagram } from "./Diagram";

interface CanvasProps {
  state: EditorState;
  dispatch: (action: Action) => void;
}

/** Active pointer drag, tracked in a ref so it doesn't trigger re-renders. */
type Drag =
  | { kind: "node"; id: NodeId; offX: number; offY: number }
  | { kind: "pan"; startTx: number; startTy: number; startX: number; startY: number };

export function Canvas({ state, dispatch }: CanvasProps) {
  const { doc, view, tool, selection, linkFrom } = state;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const drag = useRef<Drag | null>(null);
  // Cursor position in world space, for the link-in-progress preview line.
  const [cursor, setCursor] = useState<Vec2 | null>(null);

  /** Pointer position relative to the SVG origin, in screen pixels. */
  function screenPoint(e: React.PointerEvent | React.WheelEvent): Vec2 {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function worldPoint(e: React.PointerEvent | React.WheelEvent): Vec2 {
    const s = screenPoint(e);
    return screenToWorld(view, s.x, s.y);
  }

  function onBackgroundPointerDown(e: React.PointerEvent) {
    if (e.button === 1) {
      // Middle mouse always pans, regardless of tool.
      beginPan(e);
      return;
    }
    if (tool === "node") {
      dispatch({ type: "addNode", pos: worldPoint(e) });
      return;
    }
    if (tool === "link") {
      // Clicking empty space abandons an in-progress link.
      if (linkFrom) dispatch({ type: "cancelLink" });
      return;
    }
    // select tool: clicking empty space clears selection and starts a pan.
    dispatch({ type: "select", selection: null });
    beginPan(e);
  }

  function beginPan(e: React.PointerEvent) {
    const s = screenPoint(e);
    drag.current = {
      kind: "pan",
      startTx: view.tx,
      startTy: view.ty,
      startX: s.x,
      startY: s.y,
    };
    svgRef.current?.setPointerCapture(e.pointerId);
  }

  function onNodePointerDown(e: React.PointerEvent, node: Node) {
    e.stopPropagation();
    if (e.button === 1) {
      beginPan(e);
      return;
    }
    if (tool === "link") {
      if (!linkFrom) dispatch({ type: "startLink", from: node.id });
      else dispatch({ type: "completeLink", to: node.id });
      return;
    }
    // select (and node) tools: select and begin dragging the node.
    dispatch({ type: "select", selection: { kind: "node", id: node.id } });
    const p = nodePos(doc, node.id);
    const w = worldPoint(e);
    if (p) {
      drag.current = { kind: "node", id: node.id, offX: w.x - p.x, offY: w.y - p.y };
      svgRef.current?.setPointerCapture(e.pointerId);
    }
  }

  function onLinkPointerDown(e: React.PointerEvent, link: Link) {
    // The marking tool acts on the *road*, so unlike the others it must claim
    // the event: letting it reach `onBackgroundPointerDown` would lose the click
    // and pan instead (markings spec §2.4).
    if (tool === "marking") {
      e.stopPropagation();
      placeMarking(e, link);
      return;
    }
    if (tool !== "select") return; // let other tools act on the background
    e.stopPropagation();
    dispatch({ type: "select", selection: { kind: "link", id: link.id } });
  }

  /**
   * Put a marking where the pointer landed on `link`. The click carries
   * everything one needs, which is what keeps this from growing a dialog:
   *
   * - **how far along** — an arc-length on the polyline the road is actually
   *   *drawn* along, carriageway offset and alignment included, divided by
   *   `UNITS_PER_METRE` because `Marking.position` is metres (§2.2);
   * - **which lane** — that same click's **signed** lateral offset, matched
   *   against the lane bands. Outside every band (the casing lip, or the fat
   *   invisible hit path) means the whole carriageway.
   */
  function placeMarking(e: React.PointerEvent, link: Link) {
    const points = drawnPolyline(doc, link, carriageways(doc));
    if (!points || points.length < 2) return;
    const { along, offset } = nearestOnPolyline(points, worldPoint(e));
    const bands = laneBands(link.lanes, linkStyle(doc, link.id));
    const lane = bands.findIndex(
      (b) => Math.abs(offset - b.offset) <= b.width / 2,
    );
    dispatch({
      type: "addMarking",
      link: link.id,
      position: along / UNITS_PER_METRE,
      lane: lane < 0 ? undefined : lane,
    });
  }

  /**
   * A marking's own clicks, and the behaviour is written here rather than
   * inherited from the tree: markings are a sibling layer, so this event cannot
   * reach `onLinkPointerDown`, and *not* stopping propagation would send it to
   * `onBackgroundPointerDown`, whose select tail clears the selection and starts
   * a pan (§2.4).
   *
   * The cost of that unconditional `stopPropagation`, stated so it is a trade
   * rather than a surprise: a marking is a small **dead zone for the node tool**,
   * which elsewhere drops a node straight through a road. Nudging the click is
   * the whole remedy.
   */
  function onMarkingPointerDown(e: React.PointerEvent, marking: Marking) {
    e.stopPropagation();
    if (tool === "marking") {
      // Clicking near an existing marking places another on the same road: a
      // tool that refuses to place a second marking beside the first is the more
      // surprising behaviour.
      const link = findLink(doc, marking.link);
      if (link) placeMarking(e, link);
      return;
    }
    if (tool === "select") {
      dispatch({ type: "select", selection: { kind: "marking", id: marking.id } });
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (tool === "link" && linkFrom) setCursor(worldPoint(e));

    const d = drag.current;
    if (!d) return;
    const s = screenPoint(e);
    if (d.kind === "pan") {
      dispatch({
        type: "setView",
        view: {
          ...view,
          tx: d.startTx + (s.x - d.startX),
          ty: d.startTy + (s.y - d.startY),
        },
      });
    } else {
      const w = screenToWorld(view, s.x, s.y);
      dispatch({
        type: "moveNode",
        id: d.id,
        pos: { x: w.x - d.offX, y: w.y - d.offY },
      });
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    drag.current = null;
    svgRef.current?.releasePointerCapture(e.pointerId);
  }

  function onWheel(e: React.WheelEvent) {
    const s = screenPoint(e);
    const factor = Math.exp(-e.deltaY * 0.0015);
    dispatch({ type: "setView", view: zoomAbout(view, factor, s.x, s.y) });
  }

  const transform = `translate(${view.tx} ${view.ty}) scale(${view.k})`;

  return (
    <svg
      ref={svgRef}
      className="canvas"
      onPointerDown={onBackgroundPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onWheel={onWheel}
    >
      <defs>
        <pattern
          id="grid"
          width={LANE_PX * 4 * view.k}
          height={LANE_PX * 4 * view.k}
          patternUnits="userSpaceOnUse"
          patternTransform={`translate(${view.tx} ${view.ty})`}
        >
          <circle cx={0.5} cy={0.5} r={0.9} className="grid-dot" />
        </pattern>
      </defs>

      <rect className="grid-bg" x={0} y={0} width="100%" height="100%" fill="url(#grid)" />

      <g transform={transform}>
        <Diagram
          doc={doc}
          interaction={{
            selection,
            linkFrom,
            cursor,
            onNodePointerDown,
            onLinkPointerDown,
            onMarkingPointerDown,
          }}
        />
      </g>
    </svg>
  );
}
