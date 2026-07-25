/**
 * The drawing itself — roads, nodes, and junction glyphs — as one render tree
 * with two consumers: the live canvas and the SVG exporter.
 *
 * Everything that exists only to serve interaction (hit targets, selection
 * halos, the in-progress link, `non-scaling-stroke` hairlines) hangs off the
 * optional `interaction` prop, so an export renders the picture and nothing
 * else without a second implementation to keep in sync.
 */

import type React from "react";
import { linkPolyline, nodePos } from "../model/document";
import {
  Document,
  JunctionGlyph,
  Link,
  Node,
  NodeId,
  Vec2,
} from "../model/types";
import {
  endDirection,
  offsetPolyline,
  polylinePath,
  roadWidth,
} from "../editor/geometry";
import { Selection } from "../editor/state";

/** Everything the live canvas adds on top of the drawing itself. */
export interface Interaction {
  selection: Selection | null;
  linkFrom: NodeId | null;
  cursor: Vec2 | null;
  onNodePointerDown: (e: React.PointerEvent, node: Node) => void;
  onLinkPointerDown: (e: React.PointerEvent, link: Link) => void;
}

/** The whole drawing under one group; `interaction` absent means export mode. */
export function Diagram({
  doc,
  interaction,
}: {
  doc: Document;
  interaction?: Interaction;
}) {
  const fromPos = interaction?.linkFrom
    ? nodePos(doc, interaction.linkFrom)
    : undefined;
  const cursor = interaction?.cursor;

  return (
    <g className="diagram">
      {doc.links.map((link) => {
        const pts = linkPolyline(doc, link);
        if (!pts) return null;
        return (
          <RoadShape
            key={link.id}
            link={link}
            points={pts}
            interaction={interaction}
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
          const jn = doc.layout.junctions[node.id];
          return (
            <JunctionGlyphShape
              key={node.id}
              node={node}
              glyph={jn?.glyph ?? "generic"}
              scale={jn?.scale ?? 1}
              center={p}
              arms={junctionArms(doc, node.id)}
              interaction={interaction}
            />
          );
        }
        return (
          <NodeShape
            key={node.id}
            node={node}
            pos={p}
            interaction={interaction}
          />
        );
      })}
    </g>
  );
}

/**
 * `non-scaling-stroke` keeps hairlines legible while the *canvas* is zoomed, but
 * in a standalone file the stroke would resolve against the viewport scale — the
 * same picture rendered twice as large would carry half the relative paint
 * weight. Export therefore drops it and lets every stroke scale with the drawing.
 */
function hairline(interaction?: Interaction): "non-scaling-stroke" | undefined {
  return interaction ? "non-scaling-stroke" : undefined;
}

/** An arm meeting a junction: unit direction away from the node, and road width. */
interface Arm {
  dir: Vec2;
  width: number;
}

/** The arms incident to a junction node, derived from the links that touch it. */
function junctionArms(doc: Document, nodeId: NodeId): Arm[] {
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
  link,
  points,
  interaction,
}: {
  link: Link;
  points: Vec2[];
  interaction?: Interaction;
}) {
  const lanes = link.lanes.length;
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

  const selected = isSelected(interaction?.selection ?? null, "link", link.id);
  const nse = hairline(interaction);

  return (
    <g
      className={`road${selected ? " is-selected" : ""}`}
      onPointerDown={
        interaction && ((e: React.PointerEvent) => interaction.onLinkPointerDown(e, link))
      }
    >
      {/* Fat invisible hit target so thin roads are still easy to click. The
          handler lives on the group, so clicks on the visible casing/edges
          (which paint over this path) select the road too. */}
      {interaction && <path className="road-hit" d={casing} strokeWidth={w + 8} />}
      {selected && (
        <path className="road-halo" d={casing} strokeWidth={w + 6} />
      )}
      <path className="road-casing" d={casing} strokeWidth={w} />
      <path className="road-edge" d={leftEdge} vectorEffect={nse} />
      <path className="road-edge" d={rightEdge} vectorEffect={nse} />
      {dividers.map((d, i) => (
        <path key={i} className="road-divider" d={d} vectorEffect={nse} />
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
  interaction,
}: {
  node: Node;
  pos: Vec2;
  interaction?: Interaction;
}) {
  const r = node.type === "junction" ? 9 : node.type === "waypoint" ? 4 : 6;
  const selected = isSelected(interaction?.selection ?? null, "node", node.id);
  const highlight = selected || interaction?.linkFrom === node.id;
  const nse = hairline(interaction);
  return (
    <g
      className={`node node-${node.type}${selected ? " is-selected" : ""}`}
      transform={`translate(${pos.x} ${pos.y})`}
      onPointerDown={
        interaction && ((e: React.PointerEvent) => interaction.onNodePointerDown(e, node))
      }
    >
      {highlight && (
        <circle className="node-halo" r={r + 4} vectorEffect={nse} />
      )}
      <circle className="node-dot" r={r} vectorEffect={nse} />
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
  node,
  glyph,
  scale,
  center,
  arms,
  interaction,
}: {
  node: Node;
  glyph: JunctionGlyph;
  scale: number;
  center: Vec2;
  arms: Arm[];
  interaction?: Interaction;
}) {
  const maxW = arms.length ? Math.max(...arms.map((a) => a.width)) : roadWidth(1);
  const rp = (maxW * 0.62 + 3) * scale;

  const ro = Math.max(20, maxW * 1.35) * scale;
  const ringT = ro * 0.42;
  const ri = ro - ringT;

  const outerR = glyph === "roundabout" ? ro : rp;
  const selected = isSelected(interaction?.selection ?? null, "node", node.id);
  const highlight = selected || interaction?.linkFrom === node.id;
  const nse = hairline(interaction);

  return (
    <g
      className="junction"
      transform={`translate(${center.x} ${center.y})`}
      onPointerDown={
        interaction && ((e: React.PointerEvent) => interaction.onNodePointerDown(e, node))
      }
    >
      {/* Transparent hit disc so the whole glyph is clickable. */}
      {interaction && <circle className="jn-hit" r={outerR + 2} />}

      {highlight && (
        <circle className="jn-halo" r={outerR + 5} vectorEffect={nse} />
      )}

      {glyph === "roundabout" ? (
        <>
          <circle className="jn-ring" r={(ri + ro) / 2} strokeWidth={ringT} />
          <circle className="jn-island" r={ri} />
          <circle className="jn-edge" r={ro} vectorEffect={nse} />
          <circle className="jn-edge" r={ri} vectorEffect={nse} />
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
                vectorEffect={nse}
              />
            );
          })}
          <SignalHead rp={rp} scale={scale} interaction={interaction} />
        </>
      )}

      {glyph === "priority_cross" && (
        <polygon
          className="jn-priority"
          points={diamondPoints(rp * 0.85)}
          vectorEffect={nse}
        />
      )}
    </g>
  );
}

/** A small three-aspect signal head, offset up-right of the junction centre. */
function SignalHead({
  rp,
  scale,
  interaction,
}: {
  rp: number;
  scale: number;
  interaction?: Interaction;
}) {
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
        vectorEffect={hairline(interaction)}
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
