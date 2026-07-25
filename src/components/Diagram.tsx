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
import { linkPolyline, linkStyle, nodePos } from "../model/document";
import {
  Document,
  JunctionGlyph,
  LaneKind,
  Link,
  LinkId,
  LinkStyle,
  Node,
  NodeId,
  Vec2,
} from "../model/types";
import {
  MIN_ROAD_WIDTH,
  carriageways,
  distance,
  endDirection,
  laneBands,
  offsetPolyline,
  polylinePath,
  rayCircleExit,
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
  // The two links of a divided road step off their shared centreline before
  // anything is drawn from them — the roads and the junction arms alike.
  const offsets = carriageways(doc);

  return (
    <g className="diagram">
      {hasShoulder(doc) && <HatchPattern />}

      {doc.links.map((link) => {
        const pts = drawnPolyline(doc, link, offsets);
        if (!pts) return null;
        return (
          <RoadShape
            key={link.id}
            link={link}
            style={linkStyle(doc, link.id)}
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
              arms={junctionArms(doc, node.id, offsets)}
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

/** Id of the hard-shoulder hatch, referenced by {@link RoadShape}'s bands. */
const HATCH_ID = "road-hatch";

/** Whether any lane anywhere in the document is a hard shoulder. */
function hasShoulder(doc: Document): boolean {
  return doc.links.some((l) => l.lanes.some((lane) => lane.kind === "shoulder"));
}

/**
 * The diagonal hatch a hard shoulder is filled with.
 *
 * **The one thing in the drawing that cannot travel as a CSS rule** (road spec
 * §2.5). `export.test.ts` asserts the embedded stylesheet contains no `url(` —
 * an unresolvable external reference is the classic way to break a standalone
 * SVG — and that `diagram.css` contains no `<` or `&` anywhere, comments
 * included, since it is embedded raw inside XML. So neither the `fill: url(…)`
 * nor the `<pattern>` element itself is legal there: the pattern is markup here
 * and the reference is an inline attribute on the band.
 *
 * Emitted **only when a shoulder exists**, because an empty document must render
 * as exactly `<g class="diagram"></g>` — asserted in `Diagram.test.tsx`.
 *
 * The stroke comes from a class rather than an inline colour so the hatch tracks
 * the palette: `var()` does not resolve inside a *presentation attribute*, and
 * the rule travels inside an exported file like every other, so the pattern is
 * still self-contained.
 */
function HatchPattern() {
  return (
    <defs>
      <pattern
        id={HATCH_ID}
        width="7"
        height="7"
        patternUnits="userSpaceOnUse"
        patternTransform="rotate(45)"
      >
        <path className="road-hatch-line" d="M 3.5 0 L 3.5 7" />
      </pattern>
    </defs>
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

/**
 * The polyline a link is *drawn* along: its layout polyline, stepped sideways by
 * the carriageway offset of a divided road. Identical to the layout polyline —
 * the same array, not a copy — for every link that has no opposing twin.
 *
 * One helper so the roads and the junction arms cannot come to disagree about
 * where a road runs.
 */
function drawnPolyline(
  doc: Document,
  link: Link,
  offsets: Record<LinkId, number>,
): Vec2[] | undefined {
  const pts = linkPolyline(doc, link);
  const d = offsets[link.id] ?? 0;
  if (!pts || d === 0) return pts;
  return offsetPolyline(pts, d);
}

/** An arm meeting a junction, as drawn. */
interface Arm {
  /** Unit direction away from the node, along the drawn carriageway. */
  dir: Vec2;
  /**
   * Where that carriageway actually meets the node, in **world** units — the
   * node position for an undivided road, stepped off it for one carriageway of a
   * divided pair. The glyph's own group is translated to the node, so an interior
   * detail drawn from this has to enter as `origin - center`.
   */
  origin: Vec2;
  width: number;
}

/**
 * The arms incident to a junction node, derived from the links that touch it —
 * from each one *as drawn*, so a divided road's arms follow its carriageways,
 * position included. The lateral position is not re-derived from `DRIVE_SIDE` or
 * a second call to `carriageways`: it is already sitting in the drawn polyline's
 * own end point (ramps spec §2.2, road spec OQ-6).
 *
 * The node *dots* still draw at the node position, so an endpoint or waypoint on
 * a divided road sits in its median (ramps spec OQ-4, open).
 */
function junctionArms(
  doc: Document,
  nodeId: NodeId,
  offsets: Record<LinkId, number>,
): Arm[] {
  const arms: Arm[] = [];
  for (const link of doc.links) {
    const touchesStart = link.from_node === nodeId;
    const touchesEnd = link.to_node === nodeId;
    if (!touchesStart && !touchesEnd) continue;
    const poly = drawnPolyline(doc, link, offsets);
    if (!poly || poly.length < 2) continue;
    // Orient the polyline so the junction node is first, then step to the next
    // point to get the direction of the approach leaving the node.
    const [n0, n1] = touchesStart ? [poly[0], poly[1]] : [poly[poly.length - 1], poly[poly.length - 2]];
    const dx = n1.x - n0.x;
    const dy = n1.y - n0.y;
    const len = Math.hypot(dx, dy) || 1;
    arms.push({
      dir: { x: dx / len, y: dy / len },
      origin: n0,
      width: roadWidth(link.lanes, linkStyle(doc, link.id)),
    });
  }
  return arms;
}

function isSelected(sel: Selection | null, kind: "node" | "link", id: string) {
  return sel?.kind === kind && sel.id === id;
}

/**
 * A schematic road: asphalt casing, lane bands, painted edge lines, lane
 * dividers, arrow.
 *
 * **No centreline.** An undivided two-way road would carry one in a road atlas,
 * but nothing in the model distinguishes "one link the user thinks of as
 * two-way" from "one carriageway of a pair" — `Link` carries no direction flag
 * and `median_gap` is default-valued on every link ever created, so it holds no
 * signal. Drawing one would be a guess. Recorded as road spec OQ-4, and a
 * modelling gap for the ramps/junction spec rather than a rendering one.
 *
 * The road class reaches the paint as a class token rather than a computed
 * attribute, so `diagram.css` carries the colour and line treatment and an
 * exported file inherits both with no exporter change (§2.3). Its *width* factor
 * cannot travel that way — CSS can replace a computed `strokeWidth`, not scale
 * it — so it enters through `laneBands`/`roadWidth`, upstream of every quantity
 * below.
 */
function RoadShape({
  link,
  style,
  points,
  interaction,
}: {
  link: Link;
  style: LinkStyle;
  points: Vec2[];
  interaction?: Interaction;
}) {
  const bands = laneBands(link.lanes, style);
  const w = roadWidth(link.lanes, style);
  const casing = polylinePath(points);
  const edgeInset = w / 2 - 1.5;
  const leftEdge = polylinePath(offsetPolyline(points, edgeInset));
  const rightEdge = polylinePath(offsetPolyline(points, -edgeInset));

  // `laneBands` treats an empty array as one default lane, so it can return a
  // band with no `Lane` behind it. Such a lane has no kind, and draws plain.
  const kindOf = (i: number): LaneKind | undefined => link.lanes[i]?.kind;

  // A band is painted only where the kind says something. `general` and `turn`
  // are the plain road, so a document that has never set a kind emits no band at
  // all and its markup is what it was before lane kinds existed (§2.5).
  const painted = bands.flatMap((b, i) => {
    const kind = kindOf(i);
    if (kind === undefined || kind === "general" || kind === "turn") return [];
    return [{ kind, width: b.width, d: polylinePath(offsetPolyline(points, b.offset)) }];
  });

  // A divider sits on the boundary between two adjacent lanes, which is each
  // band's far edge from the nearside — so every band but the first contributes
  // one. The two outermost boundaries are the edge lines above, not dividers.
  //
  // *What* the line means is the boundary's own business: dashed says "lanes,
  // same direction, cross freely", and a hard shoulder is not one of those. So a
  // boundary touching a shoulder draws solid — the hard-shoulder line of §2.5,
  // and the whole of what distinguishes a motorway from an arterial.
  const dividers = bands.slice(1).map((b, i) => ({
    cls:
      kindOf(i) === "shoulder" || kindOf(i + 1) === "shoulder"
        ? "road-shoulder-line"
        : "road-divider",
    d: polylinePath(offsetPolyline(points, b.offset + b.width / 2)),
  }));

  const dir = endDirection(points);
  const end = points[points.length - 1];
  const arrow =
    dir && arrowTriangle(end, dir, Math.max(6, w * 0.45), w + 8);

  const selected = isSelected(interaction?.selection ?? null, "link", link.id);
  const nse = hairline(interaction);

  return (
    <g
      className={`road road-${style}${selected ? " is-selected" : ""}`}
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
      {/* Lane bands sit on the asphalt and under every painted line, so a
          shoulder's hatch and a bus lane's tint read as surface, not marking. */}
      {painted.map((b, i) => (
        <path
          key={i}
          className={`lane-band lane-band-${b.kind}`}
          d={b.d}
          strokeWidth={b.width}
          stroke={b.kind === "shoulder" ? `url(#${HATCH_ID})` : undefined}
        />
      ))}
      <path className="road-edge" d={leftEdge} vectorEffect={nse} />
      <path className="road-edge" d={rightEdge} vectorEffect={nse} />
      {dividers.map((d, i) => (
        <path key={i} className={d.cls} d={d.d} vectorEffect={nse} />
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
  const maxW = arms.length
    ? Math.max(...arms.map((a) => a.width))
    : MIN_ROAD_WIDTH;

  // How far the outermost corner of any arm sits from the node. On an undivided
  // junction this is just half the widest road; a divided approach adds its step
  // off the centreline, and the glyph has to reach out to meet it.
  //
  // A **floor** on the size the glyph already chose, never a replacement:
  // `0.62 w + 3 > w / 2` for every road, so substituting would shrink every
  // undivided pad ever drawn. And the floor is unscaled world units while
  // `scale` multiplies only the base term, so shrinking a junction can no longer
  // pull its pad off the carriageways it exists to join — below roughly half
  // scale the Size control simply stops shrinking the pad (ramps spec §2.2).
  const reach = arms.length
    ? Math.max(...arms.map((a) => distance(a.origin, center) + a.width / 2))
    : 0;
  const rp = Math.max((maxW * 0.62 + 3) * scale, reach);

  const ro = Math.max(Math.max(20, maxW * 1.35) * scale, reach);
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
            // Sit the stop line just beyond the pad, on the visible approach
            // road — measured from *that arm's* carriageway, not from the node,
            // so a divided approach gets a bar on each half. The group is
            // already translated to `center`, so the arm enters relative to it;
            // for an undivided arm that is (0, 0), `rayCircleExit` gives back
            // exactly `rp`, and this is the old `dir * (rp + 4)` unchanged.
            const ox = a.origin.x - center.x;
            const oy = a.origin.y - center.y;
            const dist = rayCircleExit({ x: ox, y: oy }, a.dir, rp) + 4;
            const cx = ox + a.dir.x * dist;
            const cy = oy + a.dir.y * dist;
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
