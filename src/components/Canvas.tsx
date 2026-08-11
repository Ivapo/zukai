/** The SVG drawing surface: grid, view transform, and all pointer interaction. */

import type React from "react";
import { useRef, useState } from "react";
import {
  findLink,
  findMarking,
  linkPolyline,
  linkStyle,
  nodePos,
} from "../model/document";
import {
  LaneIdx,
  Link,
  LinkEnd,
  LinkId,
  Marking,
  MarkingId,
  Node,
  NodeId,
  Sign,
  SignId,
  Vec2,
} from "../model/types";
import {
  LANE_PX,
  UNITS_PER_METRE,
  anchoredAlong,
  bandAt,
  bendInsertion,
  boundaryAt,
  carriageways,
  drawnPolyline,
  laneBands,
  nearestOnPolyline,
  polylineLength,
  screenToWorld,
  zoomAbout,
} from "../editor/geometry";
import { Action, EditorState } from "../editor/state";
import { Diagram } from "./Diagram";

interface CanvasProps {
  state: EditorState;
  dispatch: (action: Action) => void;
}

/**
 * Active pointer drag, tracked in a ref so it doesn't trigger re-renders.
 *
 * **A marking carries no grab offset, and that is a decision.** A node or a sign
 * is dragged *by the point you took hold of*, so both remember where inside
 * themselves the pointer landed; a marking is **re-projected onto its road
 * absolutely**, so the paint goes wherever the pointer is. The cost is a jump of
 * at most half the 12-unit hit strip when you first grab one. What it buys is the
 * case that matters after an import: a marking whose metres run past the drawn
 * end of its road is clamped into the junction pad by `pointAlongPolyline` (lane
 * arrows §2.3), and only an absolute drag can bring it back — an offset-preserving
 * one would carry the overshoot along with it and never reach the road.
 */
type Drag =
  | { kind: "node"; id: NodeId; offX: number; offY: number }
  | { kind: "sign"; id: SignId; offX: number; offY: number }
  | { kind: "marking"; id: MarkingId }
  // A bend takes the grab offset a node and a sign take, and for their reason:
  // it is dragged *by the point you took hold of*. Measured against the
  // **layout** bend, which is what `moveBend` writes, while the handle is drawn
  // at the offset vertex — so on a divided road the offset absorbs the lateral
  // shift and the road stays put under the pointer (link bends §2.6).
  | { kind: "bend"; link: LinkId; index: number; offX: number; offY: number }
  // The press that has not yet become a drag, and **the first gesture in this
  // file with a threshold**: every other drag begins on pointer-down. A press on
  // a road creates something rather than grabbing something, so a few pixels of
  // movement have to separate "bend this road" from "select it" — otherwise an
  // ordinary selecting click litters the document with zero-length bends
  // (link bends OQ-4).
  | { kind: "linkPress"; link: LinkId; startX: number; startY: number }
  | { kind: "pan"; startTx: number; startTy: number; startX: number; startY: number };

/**
 * How far the pointer must travel before a press on a road bends it, in **screen
 * pixels** — not world units, or the gesture would change meaning with zoom.
 *
 * Small enough that pulling a road bends it without a deliberate wind-up, large
 * enough that the hand-tremor in a click does not. Settled in the app, as every
 * constant in this project has been.
 */
const BEND_THRESHOLD = 4;

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
    // A sign carries its own position, so it lands wherever the pointer is — and
    // that includes *over a road*, which costs nothing: `onLinkPointerDown` lets
    // every tool but its own fall through to here (signs spec §2.5).
    if (tool === "sign") {
      dispatch({ type: "addSign", pos: worldPoint(e) });
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

  /**
   * A road's own clicks.
   *
   * Under the select tool this is **a press that may become a bend** (link bends
   * §2.6): the road is selected immediately, as it always was, and the press is
   * remembered. Only once the pointer has travelled {@link BEND_THRESHOLD} does
   * {@link onPointerMove} mint a vertex and start dragging it, so a click that
   * does not move still just selects.
   */
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
    // The guard the node, marking and sign handlers have always had, and this
    // one needed only once a road became draggable: without it a middle-drag on
    // a road would mint bends instead of panning, and the `stopPropagation`
    // above means the `<svg>` never gets its chance.
    if (e.button === 1) {
      beginPan(e);
      return;
    }
    dispatch({ type: "select", selection: { kind: "link", id: link.id } });
    const s = screenPoint(e);
    drag.current = {
      kind: "linkPress",
      link: link.id,
      startX: s.x,
      startY: s.y,
    };
    svgRef.current?.setPointerCapture(e.pointerId);
  }

  /**
   * A bend's own handle. Handles are the topmost layer of all — above even the
   * signs, being chrome rather than drawing — so this event can reach nothing
   * already here, and *not* stopping propagation would send it to the `<svg>`,
   * whose select tail clears the selection and starts a pan. The trap
   * {@link onMarkingPointerDown} and {@link onSignPointerDown} both guard.
   *
   * **The offset is measured against the layout bend, not the handle**, because
   * `moveBend` writes the layout polyline while the handle is drawn on the
   * offset one. On a divided road the two are `lateralShift` apart, and taking
   * the offset from the handle would step the road sideways on the first
   * pointer-move.
   */
  function onBendPointerDown(e: React.PointerEvent, link: Link, index: number) {
    e.stopPropagation();
    if (e.button === 1) {
      beginPan(e);
      return;
    }
    if (tool !== "select") return;
    // The leading `select` is load-bearing beyond the selection, as it is for a
    // marking: it leaves `doc` alone and so resets `coalesceKey`, opening the
    // drag's undo run.
    dispatch({ type: "select", selection: { kind: "bend", link: link.id, index } });
    const at = doc.layout.links[link.id]?.bends?.[index];
    if (!at) return;
    const w = worldPoint(e);
    drag.current = {
      kind: "bend",
      link: link.id,
      index,
      offX: w.x - at.x,
      offY: w.y - at.y,
    };
    svgRef.current?.setPointerCapture(e.pointerId);
  }

  /**
   * Turn a press on a road into a bend under the pointer — the moment the
   * gesture crosses {@link BEND_THRESHOLD}.
   *
   * **The bend goes on the road, not under the pointer**, which is what makes
   * the insert feel right: pressing a road and pulling it should bend it, not
   * shift it sideways. `bendInsertion` is where that lives — it takes the
   * pointer's arc length along the polyline the road is *drawn* along and
   * answers in the one it is *routed* along, index included, from a single walk.
   *
   * The **press** point is what is projected, not the pointer's position now, so
   * the vertex lands where the road was taken hold of. The grab offset is then
   * measured from the current pointer, so there is no jump at the insert and
   * none at the start of the drag either.
   */
  function beginBend(press: Drag & { kind: "linkPress" }, now: Vec2) {
    const link = findLink(doc, press.link);
    if (!link) return;
    const layout = linkPolyline(doc, link);
    const drawn = drawnPolyline(doc, link, carriageways(doc));
    if (!layout || !drawn) return;
    const at = bendInsertion(
      layout,
      drawn,
      screenToWorld(view, press.startX, press.startY),
    );
    if (!at) return;

    dispatch({ type: "addBend", link: link.id, index: at.index, pos: at.pos });
    drag.current = {
      kind: "bend",
      link: link.id,
      index: at.index,
      offX: now.x - at.pos.x,
      offY: now.y - at.pos.y,
    };
  }

  /**
   * A pointer on `link`, as a marking's own two fields. The click carries
   * everything one needs, which is what keeps placement from growing a dialog:
   *
   * - **how far along** — an arc-length on the polyline the road is actually
   *   *drawn* along, carriageway offset and alignment included, divided by
   *   `UNITS_PER_METRE` because `Marking.position` is metres (§2.2);
   * - **which lane** — that same click's **signed** lateral offset, matched
   *   against the lane bands. Outside every band (the casing lip, or the fat
   *   invisible hit path) means the whole carriageway.
   *
   * **`boundaries` is the one kind-aware argument**, and it belongs to a caller
   * rather than to the geometry: a `lane_line`'s `lane` names a *boundary*, of
   * which a road has one fewer than it has lanes, so matching it against the bands
   * can name `n-1` — an index `laneLine` cannot draw, which makes the marking
   * vanish mid-drag. The kind-aware marking rules already live in the UI layer
   * rather than in the reducer (markings §2.3), and this is one more of them.
   *
   * **`anchor` is the frame the answer is reported in**, and it is not
   * kind-aware — it is read off the marking's own state. `nearestOnPolyline`
   * measures from the polyline's start, so an `end`-anchored marking's metres
   * have to come back measured from the other end, or a drag writes a distance
   * the drawing reads backwards and the paint mirrors about the road's midpoint
   * (lane arrows §2.3.1). The flip lives here rather than at the call site so the
   * metre/unit boundary stays the two functions `rules/road-markings.md` names:
   * placement and dragging share this one, and the caller would have to re-derive
   * the polyline per pointer-move to know the total.
   *
   * Returns `null` for a link with no drawable polyline, on which no click can
   * mean anything.
   */
  function projectOntoLink(
    e: React.PointerEvent,
    link: Link,
    boundaries: boolean,
    anchor?: LinkEnd,
  ): { position: number; lane?: LaneIdx } | null {
    const points = drawnPolyline(doc, link, carriageways(doc));
    if (!points || points.length < 2) return null;
    const { along, offset } = nearestOnPolyline(points, worldPoint(e));
    const bands = laneBands(link.lanes, linkStyle(doc, link.id));
    return {
      position: anchoredAlong(polylineLength(points), along, anchor) / UNITS_PER_METRE,
      lane: boundaries ? boundaryAt(bands, offset) : bandAt(bands, offset),
    };
  }

  /**
   * Put a marking where the pointer landed on `link`.
   *
   * Always against the **lane bands**, never the boundaries: a placed marking is
   * always a `stop_line` (`addMarking` takes no kind), and the Kind picker is what
   * turns it into a lane line afterwards.
   */
  function placeMarking(e: React.PointerEvent, link: Link) {
    const at = projectOntoLink(e, link, false);
    if (!at) return;
    dispatch({ type: "addMarking", link: link.id, ...at });
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
    // The guard the node and sign handlers have always had, and this one needed
    // only once a marking became draggable: without it a middle-click on paint
    // drags the paint instead of panning, and that unconditional
    // `stopPropagation` above means the `<svg>` never gets its chance to pan.
    if (e.button === 1) {
      beginPan(e);
      return;
    }
    if (tool === "marking") {
      // Clicking near an existing marking places another on the same road: a
      // tool that refuses to place a second marking beside the first is the more
      // surprising behaviour.
      const link = findLink(doc, marking.link);
      if (link) placeMarking(e, link);
      return;
    }
    if (tool === "select") {
      // Select and begin dragging, `onNodePointerDown`'s shape — and the leading
      // `select` is load-bearing beyond the selection, since it resets
      // `coalesceKey` and so opens the drag's undo run (`rules/history.md`).
      dispatch({ type: "select", selection: { kind: "marking", id: marking.id } });
      drag.current = { kind: "marking", id: marking.id };
      svgRef.current?.setPointerCapture(e.pointerId);
    }
  }

  /**
   * A sign's own clicks. Signs are the topmost layer, so this event can reach no
   * road, marking or glyph group — but *not* stopping propagation would send it to
   * the `<svg>`, whose select tail clears the selection and starts a pan, and
   * whose sign-tool arm would drop a second sign. Same trap
   * {@link onMarkingPointerDown} guards against.
   *
   * **Under the sign tool, clicking a sign selects and drags it rather than
   * dropping another on top — the *node* tool's rule, not the marking tool's.** A
   * marking belongs to a road with room for two and has a 12-unit hit strip that
   * is hard to avoid, so placing another there is the less surprising behaviour; a
   * sign is a free-standing object at a point, and a second one minted exactly
   * beneath the first would be invisible — you would drag one and find another
   * under it.
   */
  function onSignPointerDown(e: React.PointerEvent, sign: Sign) {
    e.stopPropagation();
    if (e.button === 1) {
      beginPan(e);
      return;
    }
    dispatch({ type: "select", selection: { kind: "sign", id: sign.id } });
    const p = doc.layout.signs[sign.id];
    const w = worldPoint(e);
    if (p) {
      drag.current = { kind: "sign", id: sign.id, offX: w.x - p.x, offY: w.y - p.y };
      svgRef.current?.setPointerCapture(e.pointerId);
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (tool === "link" && linkFrom) setCursor(worldPoint(e));

    const d = drag.current;
    if (!d) return;
    const s = screenPoint(e);
    if (d.kind === "linkPress") {
      // Below the threshold there is no gesture yet — and crucially no dispatch,
      // so a click that wanders a pixel still leaves the document untouched.
      if (Math.hypot(s.x - d.startX, s.y - d.startY) < BEND_THRESHOLD) return;
      beginBend(d, screenToWorld(view, s.x, s.y));
      return;
    }
    if (d.kind === "pan") {
      dispatch({
        type: "setView",
        view: {
          ...view,
          tx: d.startTx + (s.x - d.startX),
          ty: d.startTy + (s.y - d.startY),
        },
      });
    } else if (d.kind === "marking") {
      // The odd one out: a marking has no free position to offset, only a place
      // **on a road**, so this re-runs placement's projection rather than the two
      // subtractions below. The marking supplies its own link — a drag slides it
      // along the road it is painted on and never re-homes it to another — its
      // own kind, which is what picks boundaries over lane bands, and its own
      // anchor, which is the frame the answer comes back in.
      const marking = findMarking(doc, d.id);
      const link = marking && findLink(doc, marking.link);
      if (!marking || !link) return;
      const at = projectOntoLink(
        e,
        link,
        marking.kind.type === "lane_line",
        marking.anchor,
      );
      if (at) dispatch({ type: "moveMarking", id: d.id, ...at });
    } else {
      const w = screenToWorld(view, s.x, s.y);
      const pos = { x: w.x - d.offX, y: w.y - d.offY };
      // Three drags share one piece of offset arithmetic and differ only in what
      // they move. Left as an unconditional `moveNode` this would fail
      // **silently** for a sign: that reducer's guard is a layout lookup, and
      // `layout.nodes["S1"]` is simply absent, so the sign would refuse to move
      // with nothing thrown and nothing logged. A bend is the third, and it is
      // the one that cannot be named by an id at all.
      dispatch(
        d.kind === "sign"
          ? { type: "moveSign", id: d.id, pos }
          : d.kind === "bend"
            ? { type: "moveBend", link: d.link, index: d.index, pos }
            : { type: "moveNode", id: d.id, pos },
      );
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
            onSignPointerDown,
            onBendPointerDown,
          }}
        />
      </g>
    </svg>
  );
}
