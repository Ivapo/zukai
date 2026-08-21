import { describe, expect, it } from "vitest";
import { browserExportTarget, exportMime } from "./export-target";

describe("exportMime", () => {
  it("names the two types a browser download needs", () => {
    expect(exportMime("svg")).toBe("image/svg+xml");
    expect(exportMime("png")).toBe("image/png");
  });
});

describe("browserExportTarget", () => {
  it("names a pathless document after itself", () => {
    expect(browserExportTarget("svg", null, "Untitled")).toEqual({
      destination: "Untitled.svg",
      format: "svg",
      mime: "image/svg+xml",
    });
  });

  it("carries the requested format into every field", () => {
    expect(browserExportTarget("png", null, "Untitled")).toEqual({
      destination: "Untitled.png",
      format: "png",
      mime: "image/png",
    });
  });

  it("prefers the document's own file name over its metadata name", () => {
    const target = browserExportTarget("svg", "/home/ivan/interchange.zkai", "Untitled");
    expect(target.destination).toBe("interchange.svg");
  });

  it("replaces the .zkai rather than appending to it", () => {
    // `withExtension`, not `ensureExtension`: `interchange.zkai.svg` would be
    // the wrong file name for the right bytes.
    expect(
      browserExportTarget("png", "/home/ivan/interchange.zkai", "Untitled")
        .destination,
    ).toBe("interchange.png");
  });

  it("drops the directory, because a download names a file and not a place", () => {
    // A `download` attribute carrying a path is meaningless at best; the
    // basename is the whole of what a browser can honour.
    for (const path of [
      "/home/ivan/Roads/interchange.zkai",
      "C:\\Users\\ivan\\Roads\\interchange.zkai",
    ]) {
      const { destination } = browserExportTarget("svg", path, "Untitled");
      expect(destination).toBe("interchange.svg");
      expect(destination).not.toMatch(/[\\/]/);
    }
  });

  it("keeps a dotted directory out of the name", () => {
    expect(
      browserExportTarget("svg", "/home/ivan/v1.2/drawing", "Untitled")
        .destination,
    ).toBe("drawing.svg");
  });

  it("splits a dotted name on its last dot, exactly as the desktop dialog does", () => {
    // Not a defect to fix on one host only: `withExtension` is what builds the
    // save dialog's default too, so both hosts propose `v1.svg` here. Diverging
    // would make the browser's file name unpredictable from the desktop's.
    expect(
      browserExportTarget("svg", null, "v1.2 interchange").destination,
    ).toBe("v1.svg");
  });

  it("gives a leading-dot name an extension instead of eating it", () => {
    expect(browserExportTarget("svg", null, ".hidden").destination).toBe(
      ".hidden.svg",
    );
  });
});
