import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Action, EditorState, initialState, reducer } from "../editor/state";
import { Document } from "../model/types";
import { Diagram, Interaction } from "./Diagram";

/** Apply a sequence of actions, as the UI would dispatch them. */
function run(state: EditorState, ...actions: Action[]): EditorState {
  return actions.reduce(reducer, state);
}

/**
 * An endpoint and a roundabout junction joined by a 3-lane link — enough to
 * exercise every branch that carries chrome: road hit target and halo, lane
 * dividers, the junction hit disc, and the roundabout's `vector-effect` circles.
 */
function sample(): Document {
  return run(
    initialState(),
    { type: "addNode", pos: { x: 0, y: 0 } },
    { type: "addNode", pos: { x: 120, y: 40 } },
    { type: "startLink", from: "N1" },
    { type: "completeLink", to: "N2" },
    { type: "setLinkLanes", id: "L1", count: 3 },
    { type: "setNodeKind", id: "N2", kind: "junction" },
    { type: "setJunctionGlyph", id: "N2", glyph: "roundabout" },
  ).doc;
}

/** The live canvas's interaction, with the road selected. */
function interaction(): Interaction {
  return {
    selection: { kind: "link", id: "L1" },
    linkFrom: null,
    cursor: null,
    onNodePointerDown: () => {},
    onLinkPointerDown: () => {},
  };
}

describe("Diagram in export mode", () => {
  it("renders the drawing and none of the canvas chrome", () => {
    const svg = renderToStaticMarkup(<Diagram doc={sample()} />);

    expect(svg).not.toMatch(/road-hit|jn-hit|halo|is-selected|link-preview/);
    // Hairlines must scale with the drawing in a file (spec §2.5).
    expect(svg).not.toMatch(/vector-effect/);
  });

  it("emits its own <g class=\"diagram\"> root around the drawing", () => {
    const svg = renderToStaticMarkup(<Diagram doc={sample()} />);

    expect(svg.startsWith('<g class="diagram">')).toBe(true);
    expect(svg.endsWith("</g>")).toBe(true);
    expect(svg).toContain("road-casing");
    expect(svg).toContain("node-dot");
    expect(svg).toContain("jn-ring");
  });

  it("draws an empty document as an empty group", () => {
    const empty = initialState().doc;

    expect(renderToStaticMarkup(<Diagram doc={empty} />)).toBe(
      '<g class="diagram"></g>',
    );
  });
});

describe("Diagram on the live canvas", () => {
  // Guards against gating the chrome the wrong way round: the assertions above
  // would also pass if `interaction` never rendered anything.
  it("renders hit targets, the selection halo, and non-scaling strokes", () => {
    const svg = renderToStaticMarkup(
      <Diagram doc={sample()} interaction={interaction()} />,
    );

    expect(svg).toContain("road-hit");
    expect(svg).toContain("road-halo");
    expect(svg).toContain("jn-hit");
    expect(svg).toContain("is-selected");
    expect(svg).toContain('vector-effect="non-scaling-stroke"');
  });

  it("previews the in-progress link only while one is being drawn", () => {
    const drawing: Interaction = {
      ...interaction(),
      selection: null,
      linkFrom: "N1",
      cursor: { x: 60, y: 90 },
    };

    expect(
      renderToStaticMarkup(<Diagram doc={sample()} interaction={drawing} />),
    ).toContain("link-preview");
    expect(
      renderToStaticMarkup(
        <Diagram doc={sample()} interaction={interaction()} />,
      ),
    ).not.toContain("link-preview");
  });
});
