/**
 * The dialog + IPC glue, with the Tauri runtime replaced by spies.
 *
 * The first test of `files.ts`, and it exists for one rule the reducer cannot
 * hold: **an export is not a document.** `exportNetwork` takes no `dispatch`, so
 * the compiler already stops it marking the document saved — what a test can
 * still see is the *IPC call list*, which is where the other half of the rule
 * lives: no `push_recent_file`, no `save_document`, one call and it is the
 * export. That is why these assertions are on the whole list rather than on a
 * single `toHaveBeenCalledWith`.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyDocument } from "../model/document";
import { Document, Junction } from "../model/types";
import { EditorState, initialState } from "./state";

// Hoisted: `vi.mock`'s factories run while `./files` is being imported, which is
// before any plain `const` in this file has been initialized.
const tauri = vi.hoisted(() => ({
  invoke: vi.fn(),
  ask: vi.fn(),
  message: vi.fn(),
  open: vi.fn(),
  save: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: tauri.invoke,
  isTauri: () => true,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: tauri.ask,
  message: tauri.message,
  open: tauri.open,
  save: tauri.save,
}));
// Imported at module load for the close guard; no test here installs one.
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onCloseRequested: () => () => {} }),
}));

const { exportNetwork, exportNotice, importNetwork } = await import("./files");

beforeEach(() => {
  vi.clearAllMocks();
  tauri.invoke.mockResolvedValue(undefined);
});

/** A clean state: `dirty` false, so the unsaved-changes guard never prompts. */
function clean(): EditorState {
  return initialState();
}

describe("exportNetwork", () => {
  it("makes exactly one IPC call, and it is the export", async () => {
    const state = clean();
    tauri.save.mockResolvedValue("/s/cross-4/network.yaml");

    await exportNetwork(state);

    // The whole call list, not just the presence of this one: an export must
    // not remember the path as a recent document (that list opens `.zkai`
    // through `load_document`) and must not reach `save_document`. The third
    // half of the rule — no `markSaved` — is the missing `dispatch` parameter.
    expect(tauri.invoke.mock.calls).toEqual([
      ["export_network", { path: "/s/cross-4/network.yaml", doc: state.doc }],
    ]);
  });

  it("writes nothing when the dialog is cancelled", async () => {
    tauri.save.mockResolvedValue(null);

    await exportNetwork(clean());

    expect(tauri.invoke).not.toHaveBeenCalled();
    expect(tauri.message).not.toHaveBeenCalled();
  });

  it("adds .yaml to an extensionless name and leaves .yml alone", async () => {
    tauri.save.mockResolvedValue("/s/foo");
    await exportNetwork(clean());
    expect(tauri.invoke.mock.calls[0][1]).toMatchObject({ path: "/s/foo.yaml" });

    tauri.save.mockResolvedValue("/s/foo.yml");
    await exportNetwork(clean());
    expect(tauri.invoke.mock.calls[1][1]).toMatchObject({ path: "/s/foo.yml" });
  });

  it("shows the notice after a successful write, and not after a failure", async () => {
    tauri.save.mockResolvedValue("/s/network.yaml");
    await exportNetwork(clean());
    expect(tauri.message).toHaveBeenCalledTimes(1);

    tauri.invoke.mockRejectedValueOnce("disk full");
    await exportNetwork(clean());
    // The second dialog is `report`'s, not the notice's.
    expect(tauri.message).toHaveBeenCalledTimes(2);
    expect(tauri.message.mock.calls[1][1]).toMatchObject({ kind: "error" });
  });
});

describe("exportNotice", () => {
  /** A junction with the given control/rule and one movement of each priority given. */
  function junction(rule: Junction["rule"], priorities: string[]): Junction {
    return {
      node_id: "N1",
      control: "unsignalized",
      rule,
      movements: priorities.map((p, i) => ({
        id: `M${i}`,
        from_link: "L1",
        to_link: "L2",
        type: "through" as const,
        priority: p as "major" | "minor",
      })),
    };
  }

  function withJunctions(...junctions: Junction[]): Document {
    return { ...emptyDocument("t"), junctions };
  }

  it("always says what is dropped", () => {
    expect(exportNotice(emptyDocument("t"))).toContain("Detectors");
  });

  it("warns when a priority junction was drawn here rather than imported", () => {
    const notice = exportNotice(withJunctions(junction("priority", ["major"])));
    expect(notice).toContain("nothing will yield");
  });

  it("stays quiet when something actually yields", () => {
    // An imported `t_junction` is exactly this: `rule: priority` with a movement
    // carrying `priority: minor`, which Zukai carries but cannot author.
    const notice = exportNotice(
      withJunctions(junction("priority", ["major", "minor"])),
    );
    expect(notice).not.toContain("nothing will yield");
  });

  it("stays quiet for a junction with no movements, and for another rule", () => {
    expect(exportNotice(withJunctions(junction("priority", [])))).not.toContain(
      "nothing will yield",
    );
    expect(
      exportNotice(withJunctions(junction("all_way_stop", ["major"]))),
    ).not.toContain("nothing will yield");
  });
});

describe("importNetwork", () => {
  it("installs the document and never remembers the path", async () => {
    const dispatch = vi.fn();
    tauri.open.mockResolvedValue("/s/t_junction/network.yaml");
    const raw = { schema_version: 1, metadata: { name: "T" } };
    tauri.invoke.mockResolvedValue(raw);

    await importNetwork(clean(), dispatch);

    // Raw, not normalized: the reducer is the one place that normalizes.
    expect(dispatch).toHaveBeenCalledWith({ type: "importDocument", doc: raw });
    // No `push_recent_file`: "Open Recent" opens through `load_document`, which
    // reads `.zkai`, so a `network.yaml` there could only ever fail.
    expect(tauri.invoke.mock.calls).toEqual([
      ["import_network", { path: "/s/t_junction/network.yaml" }],
    ]);
  });

  it("asks before discarding unsaved work, and stops when refused", async () => {
    const dispatch = vi.fn();
    tauri.ask.mockResolvedValue(false);

    await importNetwork({ ...clean(), dirty: true }, dispatch);

    expect(tauri.ask).toHaveBeenCalledTimes(1);
    expect(tauri.open).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });
});
