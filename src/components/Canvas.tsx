/** The SVG drawing surface: grid, roads, nodes, and all pointer interaction. */

import type React from "react";
import { useRef, useState } from "react";
import { linkPolyline, nodePos } from "../model/document";
import { JunctionGlyph, Link, Node, NodeId, Vec2 } from "../model/types";
import {
  endDirection,
  LANE_PX,
  offsetPolyline,
  polylinePath,
  roadWidth,
  screenToWorld,
  zoomAbout,
} from "../editor/geometry";
import { Action, EditorState, Selection } from "../editor/state";

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
  const fromPos = linkFrom ? nodePos(doc, linkFrom) : undefined;

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
        {doc.links.map((link) => {
          const pts = linkPolyline(doc, link);
          if (!pts) return null;
          return (
            <RoadShape
              key={link.id}
              points={pts}
              lanes={link.lanes.length}
              selected={isSelected(selection, "link", link.id)}
              onPointerDown={(e) => onLinkPointerDown(e, link)}
            />
          );
        })}

        {fromPos && cursor && (
          <line
            className="link-preview"
            x1={fromPos.x}
            y1={fromPos.y}
            x2={cursor.x}
            y2={cursor.y}
            vectorEffect="non-scaling-stroke"
          />
        )}

        {doc.nodes.map((node) => {
          const p = nodePos(doc, node.id);
          if (!p) return null;
          if (node.type === "junction") {
            const view = doc.layout.junctions[node.id];
            return (
              <JunctionGlyphShape
                key={node.id}
                glyph={view?.glyph ?? "generic"}
                scale={view?.scale ?? 1}
                center={p}
                arms={junctionArms(doc, node.id)}
                selected={isSelected(selection, "node", node.id)}
                isLinkStart={linkFrom === node.id}
                onPointerDown={(e) => onNodePointerDown(e, node)}
              />
            );
          }
          return (
            <NodeShape
              key={node.id}
              node={node}
              pos={p}
              selected={isSelected(selection, "node", node.id)}
              isLinkStart={linkFrom === node.id}
              onPointerDown={(e) => onNodePointerDown(e, node)}
            />
          );
        })}
      </g>
    </svg>
  );
}

/** An arm meeting a junction: unit direction away from the node, and road width. */
interface Arm {
  dir: Vec2;
  width: number;
}

/** The arms incident to a junction node, derived from the links that touch it. */
function junctionArms(doc: EditorState["doc"], nodeId: NodeId): Arm[] {
  const arms: Arm[] = [];
  for (const link of doc.links) {
    const touchesStart = link.from_node === nodeId;
    const touchesEnd = link.to_node === nodeId;
    if (!touchesStart && !touchesEnd) continue;
    const poly = linkPolyline(doc, link);
    if (!poly || poly.length < 2) continue;
    // Orient the polyline so the junction node is first, then step to the next
    // point to get the direction of the approach leaving the node.
    const [n0, n1] = touchesStart ? [poly[0], poly[1]] : [poly[poly.length - 1], poly[poly.length - 2]];
    const dx = n1.x - n0.x;
    const dy = n1.y - n0.y;
    const len = Math.hypot(dx, dy) || 1;
    arms.push({ dir: { x: dx / len, y: dy / len }, width: roadWidth(link.lanes.length) });
  }
  return arms;
}

function isSelected(sel: Selection | null, kind: "node" | "link", id: string) {
  return sel?.kind === kind && sel.id === id;
}

/** A schematic road: asphalt casing, painted edge lines, lane dividers, arrow. */
function RoadShape({
  points,
  lanes,
  selected,
  onPointerDown,
}: {
  points: Vec2[];
  lanes: number;
  selected: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  const w = roadWidth(lanes);
  const casing = polylinePath(points);
  const edgeInset = w / 2 - 1.5;
  const leftEdge = polylinePath(offsetPolyline(points, edgeInset));
  const rightEdge = polylinePath(offsetPolyline(points, -edgeInset));

  // Lane dividers sit between adjacent lanes (skip the outermost = edge lines).
  const dividers: string[] = [];
  for (let i = 1; i < lanes; i++) {
    const off = w / 2 - 1.5 - i * ((w - 3) / lanes);
    dividers.push(polylinePath(offsetPolyline(points, off)));
  }

  const dir = endDirection(points);
  const end = points[points.length - 1];
  const arrow =
    dir && arrowTriangle(end, dir, Math.max(6, w * 0.45), w + 8);

  return (
    <g className={`road${selected ? " is-selected" : ""}`} onPointerDown={onPointerDown}>
      {/* Fat invisible hit target so thin roads are still easy to click. The
          handler lives on the group, so clicks on the visible casing/edges
          (which paint over this path) select the road too. */}
      <path className="road-hit" d={casing} strokeWidth={w + 8} />
      {selected && (
        <path className="road-halo" d={casing} strokeWidth={w + 6} />
      )}
      <path className="road-casing" d={casing} strokeWidth={w} />
      <path className="road-edge" d={leftEdge} vectorEffect="non-scaling-stroke" />
      <path className="road-edge" d={rightEdge} vectorEffect="non-scaling-stroke" />
      {dividers.map((d, i) => (
        <path
          key={i}
          className="road-divider"
          d={d}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {arrow && <polygon className="road-arrow" points={arrow} />}
    </g>
  );
}

/** Points string for a direction arrowhead, inset `back` world units from `tip`. */
function arrowTriangle(tip: Vec2, dir: Vec2, size: number, back: number): string {
  const bx = tip.x - dir.x * back;
  const by = tip.y - dir.y * back;
  const nx = -dir.y;
  const ny = dir.x;
  const tipX = bx + dir.x * size;
  const tipY = by + dir.y * size;
  const p1 = `${tipX},${tipY}`;
  const p2 = `${bx + nx * size * 0.6},${by + ny * size * 0.6}`;
  const p3 = `${bx - nx * size * 0.6},${by - ny * size * 0.6}`;
  return `${p1} ${p2} ${p3}`;
}

/** A graph node, drawn by kind. */
function NodeShape({
  node,
  pos,
  selected,
  isLinkStart,
  onPointerDown,
}: {
  node: Node;
  pos: Vec2;
  selected: boolean;
  isLinkStart: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  const r = node.type === "junction" ? 9 : node.type === "waypoint" ? 4 : 6;
  const highlight = selected || isLinkStart;
  return (
    <g
      className={`node node-${node.type}${selected ? " is-selected" : ""}`}
      transform={`translate(${pos.x} ${pos.y})`}
      onPointerDown={onPointerDown}
    >
      {highlight && (
        <circle
          className="node-halo"
          r={r + 4}
          vectorEffect="non-scaling-stroke"
        />
      )}
      <circle className="node-dot" r={r} vectorEffect="non-scaling-stroke" />
    </g>
  );
}

/**
 * A junction drawn as a recognizable symbol. The generic/signalized/priority
 * glyphs sit on an asphalt pad where the arms meet; the roundabout replaces the
 * pad with a ring and island. Approach-derived details (stop bars, arm widths)
 * come from `arms`, which is why the glyph reads correctly for any arm layout.
 */
function JunctionGlyphShape({
  glyph,
  scale,
  center,
  arms,
  selected,
  isLinkStart,
  onPointerDown,
}: {
  glyph: JunctionGlyph;
  scale: number;
  center: Vec2;
  arms: Arm[];
  selected: boolean;
  isLinkStart: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  const maxW = arms.length ? Math.max(...arms.map((a) => a.width)) : roadWidth(1);
  const rp = (maxW * 0.62 + 3) * scale;

  const ro = Math.max(20, maxW * 1.35) * scale;
  const ringT = ro * 0.42;
  const ri = ro - ringT;

  const outerR = glyph === "roundabout" ? ro : rp;
  const highlight = selected || isLinkStart;

  return (
    <g
      className="junction"
      transform={`translate(${center.x} ${center.y})`}
      onPointerDown={onPointerDown}
    >
      {/* Transparent hit disc so the whole glyph is clickable. */}
      <circle className="jn-hit" r={outerR + 2} />

      {highlight && (
        <circle className="jn-halo" r={outerR + 5} vectorEffect="non-scaling-stroke" />
      )}

      {glyph === "roundabout" ? (
        <>
          <circle className="jn-ring" r={(ri + ro) / 2} strokeWidth={ringT} />
          <circle className="jn-island" r={ri} />
          <circle className="jn-edge" r={ro} vectorEffect="non-scaling-stroke" />
          <circle className="jn-edge" r={ri} vectorEffect="non-scaling-stroke" />
        </>
      ) : (
        <circle className="jn-pad" r={rp} />
      )}

      {glyph === "signalized_cross" && (
        <>
          {arms.map((a, i) => {
            // Sit the stop line just beyond the pad, on the visible approach road.
            const dist = rp + 4;
            const cx = a.dir.x * dist;
            const cy = a.dir.y * dist;
            const hx = -a.dir.y * (a.width / 2 + 1);
            const hy = a.dir.x * (a.width / 2 + 1);
            return (
              <line
                key={i}
                className="jn-stopbar"
                x1={cx - hx}
                y1={cy - hy}
                x2={cx + hx}
                y2={cy + hy}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
          <SignalHead rp={rp} scale={scale} />
        </>
      )}

      {glyph === "priority_cross" && (
        <polygon
          className="jn-priority"
          points={diamondPoints(rp * 0.85)}
          vectorEffect="non-scaling-stroke"
        />
      )}
    </g>
  );
}

/** A small three-aspect signal head, offset up-right of the junction centre. */
function SignalHead({ rp, scale }: { rp: number; scale: number }) {
  const off = rp + 7 * scale;
  const bx = off * 0.707;
  const by = -off * 0.707;
  const w = 6.5 * scale;
  const h = 17 * scale;
  const dotR = w * 0.3;
  const top = by - h / 2;
  const aspects = [
    { cy: top + h * 0.22, cls: "jn-red" },
    { cy: top + h * 0.5, cls: "jn-amber" },
    { cy: top + h * 0.78, cls: "jn-green" },
  ];
  return (
    <g>
      <rect
        className="jn-signal-body"
        x={bx - w / 2}
        y={top}
        width={w}
        height={h}
        rx={2 * scale}
        vectorEffect="non-scaling-stroke"
      />
      {aspects.map((a, i) => (
        <circle key={i} className={a.cls} cx={bx} cy={a.cy} r={dotR} />
      ))}
    </g>
  );
}

/** Points for a diamond (rotated square) of half-diagonal `s`, centred at origin. */
function diamondPoints(s: number): string {
  return `0,${-s} ${s},0 0,${s} ${-s},0`;
}
