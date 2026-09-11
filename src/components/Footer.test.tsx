import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { EditorState, initialState } from "../editor/state";
import { FileActions, Footer } from "./Footer";

const noop = () => {};

const FILES: FileActions = {
  onNew: noop,
  onOpen: noop,
  onSave: noop,
  onSaveAs: noop,
  onExport: noop,
  onImport: noop,
  onExportSvg: noop,
  onExportPng: noop,
};

/** `isTauri()` reads this global, so setting it is what makes a desktop render. */
const tauriGlobal = globalThis as { isTauri?: boolean };

/** The file name's `class`, for a state on one host. */
function docNameClass(patch: Partial<EditorState>, desktop: boolean): string {
  if (desktop) tauriGlobal.isTauri = true;
  else delete tauriGlobal.isTauri;
  const html = renderToStaticMarkup(
    <Footer
      state={{ ...initialState(), ...patch }}
      files={FILES}
      onOpenExample={noop}
    />,
  );
  const match = /class="(doc-name[^"]*)"/.exec(html);
  if (!match) throw new Error("the footer rendered no file name");
  return match[1];
}

describe("the dot before the file name", () => {
  afterEach(() => {
    delete tauriGlobal.isTauri;
  });

  it("is yellow for unsaved changes, on both hosts", () => {
    expect(docNameClass({ dirty: true, currentPath: "/d/a.zkai" }, true)).toBe(
      "doc-name is-dirty",
    );
    expect(docNameClass({ dirty: true, currentPath: null }, false)).toBe(
      "doc-name is-dirty",
    );
  });

  it("is green on the desktop for a clean document that has a file", () => {
    expect(docNameClass({ dirty: false, currentPath: "/d/a.zkai" }, true)).toBe(
      "doc-name is-saved",
    );
  });

  it("is absent for a clean document with no file yet", () => {
    expect(docNameClass({ dirty: false, currentPath: null }, true)).toBe(
      "doc-name",
    );
  });

  // The case a plain `!dirty && currentPath` gets wrong: Open and the Examples
  // menu both set a name in a browser, and nothing there can be saved back to it.
  it("is never green in a browser, even clean and named", () => {
    expect(
      docNameClass({ dirty: false, currentPath: "roundabout.zkai" }, false),
    ).toBe("doc-name");
  });
});
