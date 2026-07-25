/** The SVG drawing surface: grid, view transform, and all pointer interaction. */

import type React from "react";
import { useRef, useState } from "react";
import { nodePos } from "../model/document";
import { Link, Node, NodeId, Vec2 } from "../model/types";
import { LANE_PX, screenToWorld, zoomAbout } from "../editor/geometry";
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
    if (tool !== "select") return; // let other tools act on the background
    e.stopPropagation();
    dispatch({ type: "select", selection: { kind: "link", id: link.id } });
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
          }}
        />
      </g>
    </svg>
  );
}
