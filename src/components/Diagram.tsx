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
  Sign,
  SignKind,
  Vec2,
} from "../model/types";
import {
  Arm,
  BASELINE_DROP,
  GORE_LENGTH,
  GoreArm,
  JointEnd,
  LANE_LINE_GAP,
  MarkingAnchor,
  MarkingForm,
  ROAD_MARGIN,
  TAPER_LENGTH,
  TEXT_SIZE,
  boundaryTaken,
  carriageways,
  drawnPolyline,
  endDirection,
  formatLength,
  gore,
  goreChevrons,
  goreFlow,
  gorePair,
  junctionArms,
  laneBands,
  laneLineOffsets,
  lateralShift,
  lengthLabel,
  markingArrow,
  markingBar,
  markingForm,
  markingTeeth,
  markingText,
  markingZebra,
  nodeDots,
  offsetPolyline,
  padRadius,
  padShape,
  polygonsPath,
  polylinePath,
  polylinesPath,
  rayCircleExit,
  rayPadExit,
  ringRadius,
  roadWidth,
  SignChrome,
  signBox,
  signNoEntry,
  signOctagon,
  signPlate,
  signPlateLabel,
  signPriority,
  signRoundel,
  signTriangle,
  taperEdge,
  taperWedges,
} from "../editor/geometry";
import { FONT_FAMILY } from "../editor/fonts";
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
  /**
   * Signs are the **topmost** layer, so a sign's hit target is a descendant of no
   * road, marking or junction group at all — and SVG events bubble only to
   * ancestors, so nothing already here can fire from one. A callback of its own,
   * on `onMarkingPointerDown`'s precedent (signs spec §2.7).
   */
  onSignPointerDown: (e: React.PointerEvent, sign: Sign) => void;
  /**
   * A bend's handle — the **chrome** layer, drawn above the whole picture and
   * present only here, so an export cannot carry one (link bends §2.3).
   *
   * A callback rather than a rendered dot alone, and that is not tidiness: a
   * bend released from its drag would otherwise be unselectable, and so
   * undeletable from inside the app (§2.6). It carries the link and the index
   * because a bend has no id to carry.
   */
  onBendPointerDown: (
    e: React.PointerEvent,
    link: Link,
    index: number,
  ) => void;
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
  // Which boundaries a human has painted a lane line on. The roads have to know
  // this too: a lane line *replaces* the divider it lands on rather than being
  // drawn over it, or the dashes show through the gaps (markings OQ-3).
  const replaced = laneLineOffsets(doc);

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
            butt={butt.has(link.id)}
            replaced={replaced[link.id]}
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
        const form = markingForm(doc, marking, offsets);
        if (!form) return null;
        return (
          <MarkingShape
            key={marking.id}
            marking={marking}
            form={form}
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
            dots={nodeDots(doc, node.id, offsets)}
            interaction={interaction}
          />
        );
      })}

      {/* The lengths the roads state, above every road, wedge, marking and
          junction pad — a pad is opaque asphalt, and a label swallowed by one
          would still pass every source-order assertion. Below the signs, which
          stay the topmost thing.

          **Derived, so there is no component and no key beyond the link's own**
          (link-length §2.3): a length label has no id, no hit target and no
          `Selection` arm, and a link that states nothing emits literally
          nothing — so a document written before the field renders exactly as it
          did, empty ones included. */}
      {doc.links.map((link) => {
        if (link.length === undefined) return null;
        const pts = drawnPolyline(doc, link, offsets);
        if (!pts) return null;
        const run = lengthLabel(pts, roadWidth(link.lanes, linkStyle(doc, link.id)));
        if (!run) return null;
        return (
          <text
            key={link.id}
            className="link-length"
            x={run.at.x}
            y={run.at.y}
            // Attributes rather than rules in `diagram.css`, for the reason
            // painted road text's are — that stylesheet travels inside every
            // exported picture and most of them embed no typeface (§2.3).
            fontFamily={FONT_FAMILY}
            fontSize={run.size}
            textAnchor="middle"
            transform={`rotate(${run.angle} ${run.at.x} ${run.at.y})`}
          >
            {formatLength(link.length)}
          </text>
        );
      })}

      {/* Signs last, so they are the topmost thing in the drawing. Markings sit
          *below* the junction glyphs because a pad is the intersection's own
          surface and paint under one is genuinely covered; a sign stands beside
          the road rather than on it and must never be occluded (signs §2.7).

          An unwrapped map, never a `<g class="signs">` around it: a document with
          no sign has to render as exactly `<g class="diagram"></g>`, the way one
          with no marking does. */}
      {doc.signs.map((sign) => {
        // A sign with no layout entry has no position to draw at, which only a
        // hand-edited document can produce — the node layer's own skip.
        const p = doc.layout.signs[sign.id];
        if (!p) return null;
        return (
          <SignShape
            key={sign.id}
            sign={sign}
            pos={p}
            interaction={interaction}
          />
        );
      })}

      {/* The bend handles, and they are **above the signs** where every other
          layer's order was argued from the drawing: these are not in the
          drawing. They are chrome, gated on `interaction` and so absent from an
          export by construction rather than by a filter someone must remember
          (§2.3) — `export.tsx:diagramInner` renders `<Diagram doc={doc} />` with
          no `interaction` prop at all. Being last is what keeps the one thing a
          human has to be able to grab from sitting under a sign.

          Drawn at the **drawn** polyline's vertex, so what you grab is what you
          see; the drag writes the **layout** one, and `Canvas.tsx` is where the
          two frames meet. */}
      {interaction &&
        doc.links.flatMap((link) => {
          const bends = doc.layout.links[link.id]?.bends;
          if (!bends?.length) return [];
          const pts = drawnPolyline(doc, link, offsets);
          // Phase 1's preserved vertex count, stated where it is relied on:
          // `offsetPolyline` emits one vertex per vertex, so bend `i` is drawn
          // vertex `i + 1`. A polyline of any other length means a node with no
          // position, which the road layer skipped too.
          if (!pts || pts.length !== bends.length + 2) return [];
          return bends.map((_, i) => (
            <BendHandle
              key={`${link.id}:${i}`}
              at={pts[i + 1]}
              selected={isBendSelected(interaction.selection, link.id, i)}
              onPointerDown={(e) => interaction.onBendPointerDown(e, link, i)}
            />
          ));
        })}
    </g>
  );
}

/**
 * The grab target for one vertex of a road's route.
 *
 * **`non-scaling-stroke` and a `transform`, on `NodeShape`'s model**: a handle is
 * a control rather than paint, so it holds its size as the canvas zooms — a dot
 * that shrank away at low zoom would leave the bend visible and ungrabbable.
 *
 * The hit circle is wider than the dot for the reason every hit target here is:
 * a 4-unit dot is a small thing to catch, and the road's own fat hit path is
 * underneath it waiting to mint a *second* bend on a near miss.
 */
function BendHandle({
  at,
  selected,
  onPointerDown,
}: {
  at: Vec2;
  selected: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  return (
    <g
      className={`bend${selected ? " is-selected" : ""}`}
      transform={`translate(${at.x} ${at.y})`}
      onPointerDown={onPointerDown}
    >
      <circle className="bend-hit" r={9} />
      <circle className="bend-handle" r={4} vectorEffect="non-scaling-stroke" />
    </g>
  );
}

/** Id of the hard-shoulder hatch, referenced by {@link RoadShape}'s bands and
 *  by {@link GoreShape}'s surface. */
const HATCH_ID = "road-hatch";

/**
 * Whether anything in the document references the hatch pattern — which is a
 * hard shoulder, and now nothing else.
 *
 * The `<defs>` has to stay conditional, because an empty document renders as
 * exactly `<g class="diagram"></g>`. It briefly covered the `gore` glyph too, and
 * was called `needsHatch` for it: a gore *borrowed* this pattern for want of one
 * of its own, so a document with a gore and no shoulder would have referenced a
 * `<pattern>` that was never emitted and drawn an *unpainted* triangle. Phase 5
 * gave the gore chevrons of its own, so the borrowing is gone and the predicate
 * is a shoulder test again — name included (ramps spec §2.9.2).
 *
 * **Anything new that references the pattern has to widen this again.** The gore
 * was that case and is no longer an example of it.
 */
function hasShoulder(doc: Document): boolean {
  return doc.links.some((l) =>
    l.lanes.some((lane) => lane.kind === "shoulder"),
  );
}

/**
 * Whether anything in the document draws a glyph — the gate on the ≈18 kB
 * `@font-face` an exported picture would otherwise carry for nothing.
 *
 * `hasShoulder`'s posture, but **exported**, because its consumer is `export.tsx`
 * rather than this module: the font is emitted by the exporter and the glyph by
 * the tree, and one predicate for both is what stops a file carrying a face with
 * no text, or worse, text with no face (signs spec §2.3).
 *
 * **The three arms are deliberately asymmetric.** The marking half counts exactly
 * what {@link markingPaint} emits a `<text>` for — **non-empty** content, an empty
 * one drawing the transverse bar instead — so the font and the glyph cannot
 * disagree. The sign half counts *every* sign, and is deliberately **not** refined
 * to "signs whose kind draws a glyph": a give-way triangle and a priority diamond
 * carry no letters and a freshly placed sign's label is empty, but teaching the
 * export path the kind vocabulary to save 18 kB on a rare sign-without-letters
 * document is a table that can fall out of step with what Phase 3 draws. One
 * conservative predicate, recorded here so a later pass does not read it as an
 * oversight (§2.3).
 *
 * **The length half is the marking half's posture**: it is character for
 * character the test the label layer above opens with, so the two cannot drift.
 * It over-counts in exactly one case — a link stating a length that has no
 * drawable polyline — and that is the safe direction, an unused face rather than
 * a picture naming one it does not carry (link-length §2.5).
 */
export function needsText(doc: Document): boolean {
  return (
    doc.markings.some((m) => m.kind.type === "text" && m.kind.content !== "") ||
    doc.signs.length > 0 ||
    doc.links.some((l) => l.length !== undefined)
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

/**
 * The `Selection` arms that name their target by id — every one but `bend`,
 * which is named by its link and its position in that link's route because a
 * `Vec2[]` entry has no identity to give it (link bends §2.2).
 */
type IdSelection = Extract<Selection, { id: string }>;

/**
 * Whether `sel` names this element.
 *
 * **The one `Selection` site the compiler only half polices** (signs spec §2.6).
 * `kind` is typed off `Selection` itself rather than hand-listed, so the union can
 * never lag the type — but nothing makes a new shape *call* this at all, and an
 * element that simply never lights up is no build error. `Diagram.test.tsx`
 * asserting that a selected sign carries its halo is the whole of the net here.
 *
 * The `"id" in sel` narrowing is the half the compiler *does* police, and it is
 * what the fifth arm bought: a selection shaped unlike the four before it is a
 * type error here rather than a bend that silently never highlights.
 */
function isSelected(
  sel: Selection | null,
  kind: IdSelection["kind"],
  id: string,
) {
  return sel !== null && "id" in sel && sel.kind === kind && sel.id === id;
}

/** {@link isSelected} for the arm with no id: a bend is its link and its index. */
function isBendSelected(sel: Selection | null, link: LinkId, index: number) {
  return sel?.kind === "bend" && sel.link === link && sel.index === index;
}

/**
 * Paint a human placed on the road: a stop line, a give-way line, or a crossing.
 *
 * **Not the same object as a signalised junction's `.jn-stopbar`**, which is
 * drawn per arm from the junction outward and is what makes that glyph read as
 * "signals". A document can carry both, and that is not a duplicate: it is a
 * signalised junction whose approach also has a painted bar (§2.7).
 *
 * **The hit target and halo are the anchor's transverse bar for every kind that
 * sits at a point**, so selecting one feels the same whatever it paints, and a
 * stop line's markup is exactly what Phase 1 emitted. A `lane_line` runs *along*
 * the road rather than across it and is the one kind with its own: its spine, and
 * narrower strokes, because a 12-unit hit strip running the length of a link is a
 * dead zone for every click on the road under it.
 *
 * **No `vector-effect`**, unlike the glyph's bar and the roads' hairlines. Those
 * are symbol and hairline respectively, and want to hold their weight as the
 * canvas zooms; this is paint on a road, and scales with it — which also leaves
 * the marking layer byte-identical between canvas and export.
 */
function MarkingShape({
  marking,
  form,
  interaction,
}: {
  marking: Marking;
  form: MarkingForm;
  interaction?: Interaction;
}) {
  const d = polylinePath(form.along ? form.along.spine : markingBar(form.across));
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
      {interaction && (
        <path className="marking-hit" d={d} strokeWidth={form.along ? 8 : 12} />
      )}
      {selected && (
        <path className="marking-halo" d={d} strokeWidth={haloWidth(form)} />
      )}
      {form.along ? (
        // The style rides on a class token from the model, as the road class
        // does, so `diagram.css` carries the dashes and the double line's colour
        // and an exported file inherits both with no exporter change.
        <path
          className={`marking-line marking-line-${form.along.style}`}
          d={polylinesPath(form.along.lines)}
        />
      ) : (
        markingPaint(marking, form.across, d)
      )}
    </g>
  );
}

/**
 * How wide to stroke a marking's halo — **the paint's own extent plus a
 * margin**, the rule `.road-halo`'s `w + 6` already follows.
 *
 * A transverse kind is drawn inside its 4-unit bar, so one number covers every
 * one of them. A `double` lane line is the one shape whose paint is wider than
 * the line it is centred on: its two strokes sit `LANE_LINE_GAP` apart, and a
 * halo that ignored that would be exactly as wide as the paint and read as no
 * halo at all — caught in the app, where a yellow halo behind a yellow double
 * line is invisible.
 */
function haloWidth(form: MarkingForm): number {
  if (!form.along) return 9;
  return 6 + (form.along.style === "double" ? LANE_LINE_GAP : 0);
}

/**
 * What one marking actually paints.
 *
 * Every kind but `lane_line`, which is the one that runs *along* the road and is
 * drawn by its caller.
 *
 * **The bar is the fall-through, and that is doing real work rather than tidying
 * up.** `hatching` is out of scope entirely (markings §2.10) but a hand-edited
 * document can carry it, and a `turn_arrow` with no direction and a `text` with
 * no content reach the same place from the app itself — the payload a fresh pick
 * starts from is empty for both. All three draw the transverse bar, which keeps a
 * marking **visible and selectable** rather than an object on the canvas that
 * could only be found by accident. Its class token already says which kind it is.
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
      // `back` is passed explicitly, and it is the one line of this phase a test
      // could miss: an optional parameter left unpassed builds green and draws
      // no second head.
      const arrow = markingArrow(
        anchor,
        marking.kind.directions,
        marking.kind.back,
      );
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
    case "text": {
      const { content } = marking.kind;
      if (content) {
        const run = markingText(anchor);
        return (
          <text
            className="marking-text"
            x={run.at.x}
            y={run.at.y}
            /* The face and the size are attributes, not rules in `diagram.css`,
               on the arrow's `stroke-width` precedent above — but for a harder
               reason. `diagram.css` is embedded verbatim in *every* exported
               picture, and most carry no font; a `font-family` there would name
               a face the file never embeds. Declaring it only in the gated
               `@font-face` block would instead leave the canvas drawing this in
               the chrome's proportional Overpass while the file drew the mono
               one, which is the canvas/file drift the whole export design exists
               to rule out (signs spec §2.3). */
            fontFamily={FONT_FAMILY}
            fontSize={run.size}
            textAnchor="middle"
            transform={`rotate(${run.angle} ${run.at.x} ${run.at.y})`}
          >
            {content}
          </text>
        );
      }
      break;
    }
  }
  return <path className="marking-bar" d={bar} />;
}

/**
 * A schematic road: asphalt casing, lane bands, painted edge lines, lane
 * dividers, arrow.
 *
 * **No centreline is *derived*.** Nothing in the model distinguishes "one link
 * the user thinks of as two-way" from "one carriageway of a pair" — `Link`
 * carries no direction flag and `median_gap` is default-valued on every link ever
 * created — so drawing one would be a guess (road spec OQ-4). One is *painted*
 * instead: a `lane_line` marking with no lane, which is the human saying the road
 * is two-way. `replaced` is where that reaches this function.
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
  replaced,
  interaction,
}: {
  link: Link;
  style: LinkStyle;
  points: Vec2[];
  butt?: boolean;
  /** Boundary offsets a lane line has taken over — see {@link laneLineOffsets}. */
  replaced?: number[];
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
  //
  // Unless a human has painted a lane line on it, in which case theirs
  // **replaces** this one, derived divider and shoulder line alike: overpainting
  // leaves a dashed line under a solid one, which shows at the dash gaps and in
  // an export especially (markings OQ-3).
  const dividers = bands.slice(1).flatMap((b, i) => {
    const offset = b.offset + b.width / 2;
    if (boundaryTaken(replaced, offset)) return [];
    return [
      {
        cls:
          kindOf(i) === "shoulder" || kindOf(i + 1) === "shoulder"
            ? "road-shoulder-line"
            : "road-divider",
        d: polylinePath(offsetPolyline(points, offset)),
      },
    ];
  });

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

/**
 * A graph node, drawn by kind — **once per drawn road end** rather than once at
 * the node, so a divided road's endpoint is marked on both carriageways instead
 * of in the median between them (ramps spec §2.10). `dots` is `nodeDots`' answer.
 *
 * **One group, whatever the count**, which is what leaves the hit target and the
 * drag exactly as they were: `onNodePointerDown` stays on a single element, and
 * `Canvas.tsx` takes its grab offset from the node's own position rather than
 * from the dot that was pressed. The `transform` therefore stays on `pos` and
 * each circle enters as a displacement from it — a zero displacement emitting
 * **no** `cx`/`cy`, since React writes `cx={0}` as `cx="0"` and a centred
 * undivided node's markup carries neither attribute.
 *
 * The halos come first as a block, not paired with their dots: where two dots
 * overlap — a divided waypoint at a lane drop puts them `4.5` apart — a halo
 * emitted after the first dot would paint over it.
 */
function NodeShape({
  node,
  pos,
  dots,
  interaction,
}: {
  node: Node;
  pos: Vec2;
  dots: Vec2[];
  interaction?: Interaction;
}) {
  const r = node.type === "junction" ? 9 : node.type === "waypoint" ? 4 : 6;
  const selected = isSelected(interaction?.selection ?? null, "node", node.id);
  const highlight = selected || interaction?.linkFrom === node.id;
  const nse = hairline(interaction);
  const at = dots.map((d) => ({ cx: d.x - pos.x || undefined, cy: d.y - pos.y || undefined }));
  return (
    <g
      className={`node node-${node.type}${selected ? " is-selected" : ""}`}
      transform={`translate(${pos.x} ${pos.y})`}
      onPointerDown={
        interaction && ((e: React.PointerEvent) => interaction.onNodePointerDown(e, node))
      }
    >
      {highlight &&
        at.map((d, i) => (
          <circle
            key={i}
            className="node-halo"
            r={r + 4}
            cx={d.cx}
            cy={d.cy}
            vectorEffect={nse}
          />
        ))}
      {at.map((d, i) => (
        <circle
          key={i}
          className="node-dot"
          r={r}
          cx={d.cx}
          cy={d.cy}
          vectorEffect={nse}
        />
      ))}
    </g>
  );
}

/**
 * A junction drawn as a recognizable symbol. The generic/signalized/priority
 * glyphs sit on an asphalt pad **shaped like the roads that meet there**; the
 * roundabout replaces the pad with a ring and island. Approach-derived details
 * (the outline, stop bars, arm widths) come from `arms`, which is why the glyph
 * reads correctly for any arm layout — and why a three-arm node reads as a T
 * without anyone picking anything (junction glyphs §2.2).
 *
 * **What turns the junction permits is not drawn here, or anywhere on the pad.**
 * It is paint on the approach lanes — a `turn_arrow` per lane, in the marking
 * layer — which is where a driver reads it and which is the form that survives
 * a sixteen-turn junction (lane arrows §1).
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
  // Both radii, and the arm reach that floors them, are `geometry.ts`'s — the
  // rim they describe is where an `end`-anchored marking measures its clearance
  // from, which is not a render-time question (lane arrows Phase 5).
  const rp = padRadius(arms, center, scale);
  // The pad itself: the approach roads, clipped to that same rim. Empty for a
  // junction with no arms, which is the one case still drawn as a disc.
  const rings = padShape(arms, center, rp);

  const ro = ringRadius(arms, center, scale);
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
      ) : rings.length ? (
        // One path, one class token, one fill: the bands overlap at the node and
        // the default nonzero rule reads them as a single area, so no boolean
        // union is computed anywhere (§2.2).
        <path className="jn-pad" d={polygonsPath(rings)} />
      ) : (
        // A junction the human placed and has not yet joined. It has no roads to
        // follow, and it still has to be visible and clickable.
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
          points={diamondPoints(diamondHalf(rings, rp))}
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
        outbound: a.outbound,
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
          it. So the surface is painted first and the chevrons ride on it — the
          reason survives the hatch it was written for, since a chevron on bare
          paper needs the asphalt under it just as the pattern did. */}
      <polygon className="jn-gore" points={points} />
      {/* What the gore actually says, and the whole of Phase 5: hatching says
          "not a running lane", chevrons say "go round this, on this side". Which
          side is `goreFlow`'s one derivation — the pair is already chosen, and
          this is the only place a gore consults the direction of travel. */}
      <path
        className="jn-gore-chevrons"
        d={polylinesPath(goreChevrons(nose, fa, fb, goreFlow(pair[0], pair[1])))}
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

/** The four directions a priority diamond's tips point in, in the glyph's frame. */
const DIAMOND_TIPS: Vec2[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

/**
 * The priority diamond's half-diagonal — **measured against the pad it will sit
 * on**, in each direction its tips actually point.
 *
 * `rp * 0.85` alone is inside a disc and is not always inside a union of bands:
 * on a T of 4-lane roads the north tip lands 3.6 units past the through road's
 * own edge, and floats filled yellow on bare paper. The bound is measured rather
 * than derived from the arms' widths because a width-derived inradius is wrong —
 * a band is cut at the centre, so one arm contributes a half-disc, and a T with a
 * 1-lane through road and a 4-lane stem reports 19.5 where the pad reaches 6
 * (junction glyphs §2.3).
 *
 * Two floors, and they answer different questions:
 *
 * - **With no rings the disc is back, and so is `rp * 0.85` unchanged.** That
 *   branch paints a full disc of asphalt, so a bound measured against an empty
 *   pad would erase the badge from under it.
 * - **Where the pad has rings but does not cover the glyph centre, `rp * 0.35`.**
 *   The centre sits in a median when every approach is divided; a single-arm
 *   junction and a Y whose arms all leave one way reach the same state. The badge
 *   overhangs a little there, which is the trade taken: a badge that vanishes is
 *   harder to diagnose than one that overhangs (OQ-5). The floor applies **only**
 *   to that vacuous case — a measurement of 6 is a real 6, and raising it would
 *   put back the yellow this function exists to remove.
 */
function diamondHalf(rings: Vec2[][], rp: number): number {
  const full = rp * 0.85;
  if (!rings.length) return full;
  const reach = Math.min(
    ...DIAMOND_TIPS.map((d) => rayPadExit(rings, { x: 0, y: 0 }, d)),
  );
  return reach > 0 ? Math.min(full, reach) : rp * 0.35;
}

/**
 * A roadside sign: one plate, the label on it, and the chrome every selectable
 * thing carries.
 *
 * **Node-shaped, not marking-shaped** (signs spec §2.5). Its position is its own,
 * so the group is translated to it and everything below is drawn about the origin
 * from build constants — the way {@link NodeShape} and {@link JunctionGlyphShape}
 * are, and unlike a marking, which derives every point from the road it is painted
 * on.
 *
 * **One hit box and one halo for every kind**, whatever the sign paints. That is
 * the marking layer's rule (its hit target is the anchor's bar for all six kinds)
 * applied here for the same reason: selecting a sign has to feel identical across
 * the vocabulary. It is {@link signBox} that keeps it true now that six of the
 * eight kinds are not rectangles — a plate is as wide as its label and two type
 * sizes tall, a symbol is `SIGN_SIZE` in both directions, and a halo taken from
 * the wrong one would sit *inside* a roundel.
 *
 * A **light** outline takes `non-scaling-stroke` on the canvas, on `.jn-priority`'s
 * precedent rather than the marking layer's: a sign is a *symbol*, and a 1-unit
 * outline that scaled away at low zoom would stop separating a white plate from
 * light paper. A symbol's own red border is proportion rather than separation, so
 * it scales with the drawing like the paint it is.
 */
function SignShape({
  sign,
  pos,
  interaction,
}: {
  sign: Sign;
  pos: Vec2;
  interaction?: Interaction;
}) {
  const chrome = signBox(sign.kind);
  const selected = isSelected(interaction?.selection ?? null, "sign", sign.id);
  // `speed_limit` → `speed-limit`, so every kind takes its token from the model
  // rather than from a table that could fall out of step with it.
  const kind = sign.kind.type.replace(/_/g, "-");
  const nse = hairline(interaction);

  return (
    <g
      className={`sign sign-${kind}${selected ? " is-selected" : ""}`}
      transform={`translate(${pos.x} ${pos.y})`}
      onPointerDown={
        interaction &&
        ((e: React.PointerEvent) => interaction.onSignPointerDown(e, sign))
      }
    >
      {/* Both grown from the sign's own box, corners included, so each is the
          shape it stands for — `.marking-halo`'s butt caps follow the same rule. */}
      {interaction && <rect className="sign-hit" {...inflate(chrome, 3)} />}
      {selected && (
        <rect className="sign-halo" {...inflate(chrome, 4)} vectorEffect={nse} />
      )}
      {signPaint(sign.kind, nse)}
    </g>
  );
}

/**
 * What one sign actually paints — the shape that carries its meaning, and any
 * letters on it.
 *
 * {@link markingPaint}'s shape, one layer up: the renderer switches on the kind and
 * the geometry it calls owns no markup. **Exhaustive over `SignKind`**, so a kind
 * added to the model does not build until it is drawn — unlike the marking switch,
 * which has a fall-through bar because a hand-edited document can carry a kind
 * (`hatching`) that is deliberately out of scope. Every sign kind is in scope.
 *
 * `direction` shares `custom`'s arm, and that is the whole of what the two have in
 * common: both are plates sized to the words they carry, and what tells a
 * destination from a label is the **colour** `.sign-direction` paints it — a rule
 * on the group's own kind token, never a second shape here.
 *
 * **An empty label emits no `<text>` at all**, and the plate is what keeps a
 * freshly placed sign visible and selectable: the empty text marking's bar again.
 */
function signPaint(kind: SignKind, nse: "non-scaling-stroke" | undefined) {
  switch (kind.type) {
    case "speed_limit": {
      const { radius, ring } = signRoundel();
      return (
        <>
          <circle className="sign-roundel" r={radius} />
          <circle
            className="sign-roundel-ring"
            r={ring.radius}
            strokeWidth={ring.width}
          />
          {signText(String(kind.kph))}
        </>
      );
    }
    case "stop":
      return (
        <>
          <path className="sign-octagon" d={polygonsPath([signOctagon()])} />
          {signText("STOP")}
        </>
      );
    // The two triangles differ only in which way they point, which is the whole
    // message: an inverted triangle is "give way" in every road atlas there is.
    case "give_way":
      return (
        <path
          className="sign-triangle"
          d={polygonsPath([signTriangle("down")])}
        />
      );
    case "warning":
      // The symbol names a pictogram and is deliberately **not** drawn: a symbol
      // library is a catalogue of artwork rather than a phase, so the triangle
      // carries "warning" on its own and the string lives in the Inspector
      // (§2.9, OQ-6).
      return (
        <path className="sign-triangle" d={polygonsPath([signTriangle("up")])} />
      );
    case "priority": {
      const { border, face } = signPriority();
      return (
        <>
          <path
            className="sign-diamond-border"
            d={polygonsPath([border])}
            vectorEffect={nse}
          />
          <path className="sign-diamond" d={polygonsPath([face])} />
        </>
      );
    }
    case "no_entry": {
      const { radius, bar } = signNoEntry();
      return (
        <>
          <circle className="sign-disc" r={radius} />
          <rect className="sign-bar" {...bar} />
        </>
      );
    }
    case "direction":
    case "custom": {
      const label = signPlateLabel(kind) ?? "";
      const plate = signPlate(label);
      return (
        <>
          <rect
            className="sign-plate"
            x={plate.box.x}
            y={plate.box.y}
            width={plate.box.width}
            height={plate.box.height}
            rx={plate.radius}
            vectorEffect={nse}
          />
          {label ? signText(label) : null}
        </>
      );
    }
  }
}

/**
 * A sign's own words, centred on its position.
 *
 * One `<text>`, `text-anchor="middle"` on a point, and **no `transform`**: a sign's
 * text is never at an angle (§2.9), unlike the one run in the drawing that is.
 * The face and the size ride as **presentation attributes** rather than as rules in
 * `diagram.css`, for the reason painted road text's do — that stylesheet travels
 * inside every exported picture, and most of them embed no typeface (§2.3).
 *
 * The vertical centring is {@link BASELINE_DROP}, which is the plate's baseline and
 * a painted word's alike, so a number in a roundel and a label on a plate sit the
 * same way in their shapes.
 */
function signText(content: string) {
  return (
    <text
      className="sign-label"
      x={0}
      y={BASELINE_DROP}
      fontFamily={FONT_FAMILY}
      fontSize={TEXT_SIZE}
      textAnchor="middle"
    >
      {content}
    </text>
  );
}

/** A sign's box grown by `pad` on every side, rounding included — the geometry
 *  its hit target and its halo share. */
function inflate(chrome: SignChrome, pad: number) {
  const { x, y, width, height } = chrome.box;
  return {
    x: x - pad,
    y: y - pad,
    width: width + 2 * pad,
    height: height + 2 * pad,
    rx: chrome.radius + pad,
  };
}
