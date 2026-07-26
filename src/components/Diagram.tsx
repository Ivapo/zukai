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
import { linkStyle, nodePos } from "../model/document";
import {
  Document,
  JunctionGlyph,
  LaneKind,
  Link,
  LinkId,
  LinkStyle,
  Marking,
  Node,
  NodeId,
  Vec2,
} from "../model/types";
import {
  GORE_LENGTH,
  GoreArm,
  JointEnd,
  MIN_ROAD_WIDTH,
  MarkingAnchor,
  ROAD_MARGIN,
  TAPER_LENGTH,
  carriageways,
  distance,
  drawnPolyline,
  endDirection,
  gore,
  gorePair,
  laneBands,
  lateralShift,
  markingAnchor,
  markingArrow,
  markingBar,
  markingTeeth,
  markingZebra,
  offsetPolyline,
  polygonsPath,
  polylinePath,
  polylinesPath,
  rayCircleExit,
  roadWidth,
  taperEdge,
  taperWedges,
} from "../editor/geometry";
import { Selection } from "../editor/state";

/** Everything the live canvas adds on top of the drawing itself. */
export interface Interaction {
  selection: Selection | null;
  linkFrom: NodeId | null;
  cursor: Vec2 | null;
  onNodePointerDown: (e: React.PointerEvent, node: Node) => void;
  onLinkPointerDown: (e: React.PointerEvent, link: Link) => void;
  /**
   * Markings are their own layer, drawn after every road, so a marking's hit
   * target is **not** a descendant of any road group and SVG events bubble only
   * to ancestors — `onLinkPointerDown` can never fire from one. Hence a callback
   * of its own (markings spec §2.4).
   */
  onMarkingPointerDown: (e: React.PointerEvent, marking: Marking) => void;
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
  // Where a road changes width. The roads have to know first: a joint that
  // draws a wedge butt-caps both its links, or the wide one's round cap bulges
  // outside the freshly painted taper line (§2.4).
  const { wedges, butt } = tapers(doc, offsets);

  return (
    <g className="diagram">
      {needsHatch(doc) && <HatchPattern />}

      {doc.links.map((link) => {
        const pts = drawnPolyline(doc, link, offsets);
        if (!pts) return null;
        return (
          <RoadShape
            key={link.id}
            link={link}
            style={linkStyle(doc, link.id)}
            points={pts}
            butt={butt.has(link.id)}
            interaction={interaction}
          />
        );
      })}

      {wedges.map((w, i) => (
        <TaperShape key={i} wedge={w} interaction={interaction} />
      ))}

      {/* Paint, so it goes above every road and wedge; below the junction
          glyphs, because a pad is the intersection's own surface and paint under
          one is genuinely covered (§2.7). A **sibling** layer, never a child of
          `RoadShape`'s group: that group carries `onLinkPointerDown`, and a road
          drawn after its neighbour would paint over the neighbour's markings. */}
      {doc.markings.map((marking) => {
        const anchor = markingAnchor(doc, marking, offsets);
        if (!anchor) return null;
        return (
          <MarkingShape
            key={marking.id}
            marking={marking}
            anchor={anchor}
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

/** Id of the hard-shoulder hatch, referenced by {@link RoadShape}'s bands and
 *  by {@link GoreShape}'s surface. */
const HATCH_ID = "road-hatch";

/**
 * Whether anything in the document references the hatch pattern — a hard
 * shoulder **or** a gore glyph.
 *
 * Both halves matter. The `<defs>` has to stay conditional, because an empty
 * document renders as exactly `<g class="diagram"></g>`; and it has to cover the
 * gore, because a document with a gore and no shoulder would otherwise reference
 * a `<pattern>` that was never emitted. That failure draws an *unpainted*
 * triangle and no markup assertion catches it unless one is written for it
 * (ramps spec §2.5).
 */
function needsHatch(doc: Document): boolean {
  return (
    doc.links.some((l) => l.lanes.some((lane) => lane.kind === "shoulder")) ||
    doc.nodes.some(
      (n) => n.type === "junction" && doc.layout.junctions[n.id]?.glyph === "gore",
    )
  );
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

/** An arm meeting a junction, as drawn. */
interface Arm {
  /** The link it comes from — the tie-break when a gore has two equally close
   *  pairs to choose between (`gorePair`). */
  id: LinkId;
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
      id: link.id,
      dir: { x: dx / len, y: dy / len },
      origin: n0,
      width: roadWidth(link.lanes, linkStyle(doc, link.id)),
    });
  }
  return arms;
}

/**
 * How a link meets a node, as drawn. `atEnd` says which end of the link the node
 * is — its last point for the link arriving there, its first for the one
 * leaving.
 *
 * Like `Arm.origin`, nothing here is re-derived: the position is the drawn
 * polyline's own end point, and the frame is the terminal segment's. The
 * nearside is the right of travel, which SVG's y-down axis makes `(-t.y, t.x)`
 * — the same normal `offsetPolyline` treats as a positive distance, so
 * `offset ± width / 2` and the world points agree by construction.
 */
function jointEnd(
  doc: Document,
  link: Link,
  offsets: Record<LinkId, number>,
  atEnd: boolean,
): JointEnd | undefined {
  const poly = drawnPolyline(doc, link, offsets);
  if (!poly || poly.length < 2) return undefined;
  const n = poly.length;
  const [at, next] = atEnd ? [poly[n - 1], poly[n - 2]] : [poly[0], poly[1]];
  const dx = next.x - at.x;
  const dy = next.y - at.y;
  const len = Math.hypot(dx, dy) || 1;
  const away = { x: dx / len, y: dy / len };
  // Travel runs *into* the joint at the arriving end and out of it at the
  // leaving one, so only one of the two is `away`.
  const t = atEnd ? { x: -away.x, y: -away.y } : away;
  return {
    at,
    away,
    nearside: { x: -t.y, y: t.x },
    offset: lateralShift(doc, link, offsets),
    width: roadWidth(link.lanes, linkStyle(doc, link.id)),
  };
}

/** A wedge as it is drawn: its corners, and the class of the link it closes. */
interface Taper {
  corners: [Vec2, Vec2, Vec2];
  style: LinkStyle;
}

/**
 * Every taper wedge in the document, and the links whose casing must be
 * butt-capped because of one.
 *
 * A **through joint** is a node with exactly two incident links, one ending
 * there and one starting there — three or more is a junction or a gore, not a
 * taper, and the road spec's habit is to leave the ambiguous case alone. Node
 * *kind* is not consulted: what makes a joint is how many roads meet at it.
 *
 * **Never between the two carriageways of a divided road.** A reversed twin
 * satisfies "one in, one out" at *either* of its nodes, so a pair carrying
 * different lane counts would otherwise get a wedge stretched between two
 * anti-parallel carriageways. The bend guard inside `taperWedges` does not
 * subsume this and the exclusion does not subsume the bend guard: a hairpin
 * (`N1→N2`, `N2→N3` with N3 placed back beside N1) is not a twin, yet its frames
 * oppose; and a twin whose bends leave the node the other way passes the bend
 * guard. Both are preconditions (§2.4).
 */
function tapers(
  doc: Document,
  offsets: Record<LinkId, number>,
): { wedges: Taper[]; butt: Set<LinkId> } {
  const wedges: Taper[] = [];
  const butt = new Set<LinkId>();

  for (const node of doc.nodes) {
    const incident = doc.links.filter(
      (l) => l.from_node === node.id || l.to_node === node.id,
    );
    if (incident.length !== 2) continue;
    // A self-loop is excluded by asking for the *other* end to be elsewhere.
    const into = incident.find(
      (l) => l.to_node === node.id && l.from_node !== node.id,
    );
    const from = incident.find(
      (l) => l.from_node === node.id && l.to_node !== node.id,
    );
    if (!into || !from) continue;
    if (into.from_node === from.to_node) continue;

    const a = jointEnd(doc, into, offsets, true);
    const b = jointEnd(doc, from, offsets, false);
    if (!a || !b) continue;

    const cut = taperWedges(a, b, TAPER_LENGTH);
    if (cut.length === 0) continue;
    for (const w of cut) {
      // `inset` is one of the two arguments by identity, which is how the wedge
      // finds the link it runs along — and so the road class it paints as.
      const link = w.inset === a ? into : from;
      wedges.push({ corners: w.corners, style: linkStyle(doc, link.id) });
    }
    butt.add(into.id);
    butt.add(from.id);
  }

  return { wedges, butt };
}

/**
 * The asphalt wedge at a width step, and the edge line on its hypotenuse.
 *
 * The road class reaches it as a token on the group, exactly as `RoadShape`
 * emits one — so `.road-local .road-taper` and the class-scoped `.road-edge`
 * width both apply with no rule of their own, and the wedge cannot come to paint
 * a different asphalt from the road it closes.
 */
function TaperShape({
  wedge,
  interaction,
}: {
  wedge: Taper;
  interaction?: Interaction;
}) {
  const [a, b, c] = wedge.corners;
  const [e0, e1] = taperEdge(wedge.corners, 1.5);
  return (
    <g className={`taper road-${wedge.style}`}>
      <polygon
        className="road-taper"
        points={`${a.x},${a.y} ${b.x},${b.y} ${c.x},${c.y}`}
      />
      {/* Paints as a road edge line, because that is what it is; the second
          token names it in the markup and for tests. */}
      <path
        className="road-edge road-taper-edge"
        d={polylinePath([e0, e1])}
        vectorEffect={hairline(interaction)}
      />
    </g>
  );
}

function isSelected(
  sel: Selection | null,
  kind: "node" | "link" | "marking",
  id: string,
) {
  return sel?.kind === kind && sel.id === id;
}

/**
 * Paint a human placed on the road: a stop line, a give-way line, or a crossing.
 *
 * **Not the same object as a signalised junction's `.jn-stopbar`**, which is
 * drawn per arm from the junction outward and is what makes that glyph read as
 * "signals". A document can carry both, and that is not a duplicate: it is a
 * signalised junction whose approach also has a painted bar (§2.7).
 *
 * **The hit target and halo are the anchor's transverse bar for every kind**, so
 * selecting a marking feels the same whatever it paints, and a stop line's markup
 * is exactly what Phase 1 emitted. Phase 4's `lane_line` runs *along* the road
 * rather than across it, and is the one kind that will need its own.
 *
 * **No `vector-effect`**, unlike the glyph's bar and the roads' hairlines. Those
 * are symbol and hairline respectively, and want to hold their weight as the
 * canvas zooms; this is paint on a road, and scales with it — which also leaves
 * the marking layer byte-identical between canvas and export.
 */
function MarkingShape({
  marking,
  anchor,
  interaction,
}: {
  marking: Marking;
  anchor: MarkingAnchor;
  interaction?: Interaction;
}) {
  const d = polylinePath(markingBar(anchor));
  const selected = isSelected(
    interaction?.selection ?? null,
    "marking",
    marking.id,
  );
  // `stop_line` → `stop-line`, so every kind gets its token from the model
  // rather than from a table that could fall out of step with it.
  const kind = marking.kind.type.replace(/_/g, "-");

  return (
    <g
      className={`marking marking-${kind}${selected ? " is-selected" : ""}`}
      onPointerDown={
        interaction &&
        ((e: React.PointerEvent) => interaction.onMarkingPointerDown(e, marking))
      }
    >
      {/* Fat invisible hit target, on the road-hit model: a 4-unit bar is a
          small thing to hit, and the halo/paint over it select through the
          group's own handler. The halo is narrower, and butt-capped in CSS, so
          it stays inside the lane the marking spans. */}
      {interaction && <path className="marking-hit" d={d} strokeWidth={12} />}
      {selected && <path className="marking-halo" d={d} strokeWidth={9} />}
      {markingPaint(marking, anchor, d)}
    </g>
  );
}

/**
 * What one marking actually paints.
 *
 * **The bar is the fall-through, and that is doing real work rather than tidying
 * up.** `lane_line` is pickable in the Inspector but has no geometry until Phase
 * 4, `hatching`/`text` are out of scope entirely (§2.8, §2.10), and a
 * `turn_arrow` can be left with no direction to draw by a hand-edited document.
 * All of them draw the transverse bar, which keeps a marking **visible and
 * selectable** while its own shape is still to come — painting nothing would
 * leave an object on the canvas that could only be found by accident. Its class
 * token already says which kind it is.
 *
 * A turn arrow is the one kind that takes **two** elements: its stems are stroked
 * and its heads are filled, and a single filled path would have to close the
 * `u_turn`'s hook across its own chord and fill the half-disc inside it.
 */
function markingPaint(marking: Marking, anchor: MarkingAnchor, bar: string) {
  switch (marking.kind.type) {
    case "give_way_line":
      return (
        <path className="marking-teeth" d={polygonsPath(markingTeeth(anchor))} />
      );
    case "crosswalk":
      return (
        <path className="marking-zebra" d={polygonsPath(markingZebra(anchor))} />
      );
    case "turn_arrow": {
      const arrow = markingArrow(anchor, marking.kind.directions);
      if (arrow)
        return (
          <>
            {/* The stroke width is the arrow's own, not a rule in `diagram.css`:
                it is derived from the band, exactly as a lane band's is. */}
            <path
              className="marking-arrow-stem"
              d={polylinesPath([
                arrow.shaft,
                ...arrow.branches.map((b) => b.stem),
              ])}
              strokeWidth={arrow.stroke}
            />
            <path
              className="marking-arrow-head"
              d={polygonsPath(arrow.branches.map((b) => b.head))}
            />
          </>
        );
      break;
    }
  }
  return <path className="marking-bar" d={bar} />;
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
  butt,
  interaction,
}: {
  link: Link;
  style: LinkStyle;
  points: Vec2[];
  butt?: boolean;
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
      {/* `stroke-linecap` is a property of the whole path, so a link
          butt-capped at a tapered end is butt-capped at its other end too.
          Where that meets a junction the pad covers it; where it is a free
          endpoint the road now ends flat rather than domed — the better
          schematic reading anyway (§2.4). */}
      <path
        className={`road-casing${butt ? " road-casing--butt" : ""}`}
        d={casing}
        strokeWidth={w}
      />
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
      ) : glyph === "gore" ? (
        // A diverge has no pad: the whole glyph is the paint *between* two arms.
        <GoreShape
          arms={arms}
          center={center}
          scale={scale}
          interaction={interaction}
        />
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

/**
 * The gore: the paint between two arms as they separate, drawn as a triangle
 * with its nose where their painted edges meet.
 *
 * Which two arms is `gorePair`'s business, and it needs no direction of travel —
 * see its own doc comment. Everything here is the *frame*: the glyph's group is
 * already translated to the node, so each arm enters as `origin - center`, and
 * the degenerate nose falls back to `(0, 0)`, which is the node in that frame.
 */
function GoreShape({
  arms,
  center,
  scale,
  interaction,
}: {
  arms: Arm[];
  center: Vec2;
  scale: number;
  interaction?: Interaction;
}) {
  const pair = gorePair(
    arms.map(
      (a): GoreArm => ({
        id: a.id,
        at: { x: a.origin.x - center.x, y: a.origin.y - center.y },
        away: a.dir,
        // The lane region's half-span, which is exactly `RoadShape`'s own
        // `edgeInset`: a gore is paint bounded by the roads' *painted* edges,
        // not asphalt bounded by their casing rims the way a wedge is.
        halfSpan: (a.width - ROAD_MARGIN) / 2,
      }),
    ),
  );
  if (!pair) return null;

  const [nose, fa, fb] = gore(
    pair[0],
    pair[1],
    { x: 0, y: 0 },
    GORE_LENGTH * scale,
  );
  const points = `${nose.x},${nose.y} ${fa.x},${fa.y} ${fb.x},${fb.y}`;
  return (
    <g className="gore">
      {/* Two layers, where a shoulder band needs one: a band sits on the casing,
          which supplies its asphalt, but a gore's base is out where the two
          roads have long since separated and there is nothing but paper under
          it. The hatch pattern is transparent by design, so the surface has to
          be painted first. */}
      <polygon className="jn-gore" points={points} />
      <polygon
        className="jn-gore-hatch"
        points={points}
        fill={`url(#${HATCH_ID})`}
      />
      {/* The two legs, as one polyline through the nose so the base stays open.
          No inset of its own, unlike `taperEdge`: the legs lie on the
          lane-region edge, which is exactly where `RoadShape` paints, so they
          continue the edge lines either side of the gore instead of jogging. */}
      <path
        className="road-edge jn-gore-edge"
        d={polylinePath([fa, nose, fb])}
        vectorEffect={hairline(interaction)}
      />
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
