/**
 * The New / Open / Save / Save As / Export commands, plus the two that read and
 * write Assimilator's `network.yaml`: native file dialogs, the IPC calls to the
 * Rust commands behind them, the recent-files list, and the window's
 * unsaved-changes guard.
 *
 * With `menu.ts` this is one of only two modules that touch the Tauri runtime,
 * deliberately kept out of the reducer so the *apply* logic
 * (`loadDocument`/`newDocument`/`markSaved`, `normalizeDocument`) stays pure and
 * unit-testable. Dialogs and `invoke` only work under `tauri dev`/a built app —
 * in the plain Vite dev server every command below fails and is reported, rather
 * than throwing into the void.
 */

import { invoke, isTauri } from "@tauri-apps/api/core";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask, message, open, save } from "@tauri-apps/plugin-dialog";
import {
  ensureExtension,
  ensureZkaiExtension,
  RawDocument,
  withExtension,
  ZKAI_EXTENSION,
} from "../model/document";
import { Document, Junction } from "../model/types";
import {
  diagramSvg,
  exportFormat,
  measureDiagram,
  PNG_SCALE,
  rasterizePng,
} from "./export";
import { Action, EditorState } from "./state";

type Dispatch = (action: Action) => void;

const FILTERS = [{ name: "Zukai schematic", extensions: [ZKAI_EXTENSION] }];

/**
 * The one a network export is *written* under. Both spellings are read — the
 * filter below takes either — but a file has to be written under one of them.
 */
const NETWORK_EXTENSION = "yaml";

/**
 * Assimilator's format, and the reason Open and Import can share a dialog
 * without sharing a filter: pointing one at the other's file is the obvious user
 * error, and the extension is what heads it off — neither reader sniffs content.
 */
const NETWORK_FILTERS = [
  { name: "Assimilator network", extensions: [NETWORK_EXTENSION, "yml"] },
];

/** Image formats the export dialog offers; the chosen extension picks between them. */
const EXPORT_FILTERS = [
  { name: "SVG image", extensions: ["svg"] },
  { name: "PNG image", extensions: ["png"] },
];

/** Discard the current document for a fresh one, guarding unsaved changes. */
export async function newDocument(
  state: EditorState,
  dispatch: Dispatch,
): Promise<void> {
  try {
    if (await confirmDiscard(state)) dispatch({ type: "newDocument" });
  } catch (err) {
    await report("Couldn't start a new document", err);
  }
}

/** Pick a `.zkai` file and load it, guarding unsaved changes. */
export async function openDocument(
  state: EditorState,
  dispatch: Dispatch,
): Promise<void> {
  try {
    if (!(await confirmDiscard(state))) return;
    const path = await open({
      title: "Open schematic",
      multiple: false,
      directory: false,
      filters: FILTERS,
    });
    if (path === null) return;
    await load(path, dispatch);
  } catch (err) {
    await report("Couldn't open the file", err);
  }
}

/**
 * Pick an Assimilator `network.yaml` and import it as the current document,
 * guarding unsaved changes exactly as Open does.
 *
 * Two things differ from {@link openDocument}, and both follow from the file
 * belonging to another program. The document arrives **dirty and pathless** (the
 * `importDocument` action), so Save asks for a `.zkai` rather than writing a
 * schematic back over Assimilator's network. And the path is **not remembered**:
 * "Open Recent" opens through `load_document`, which reads `.zkai`, so a
 * `network.yaml` in that list would be an entry that can only ever fail.
 */
export async function importNetwork(
  state: EditorState,
  dispatch: Dispatch,
): Promise<void> {
  try {
    if (!(await confirmDiscard(state))) return;
    const path = await open({
      title: "Import network",
      multiple: false,
      directory: false,
      filters: NETWORK_FILTERS,
    });
    if (path === null) return;
    // Raw, like `load`: the reducer is the one place that normalizes.
    const doc = await invoke<RawDocument>("import_network", { path });
    dispatch({ type: "importDocument", doc });
  } catch (err) {
    await report("Couldn't import the network", err);
  }
}

/** Open a remembered path from the menu's recent list, skipping the picker. */
export async function openRecentDocument(
  state: EditorState,
  dispatch: Dispatch,
  path: string,
): Promise<void> {
  try {
    if (!(await confirmDiscard(state))) return;
    await load(path, dispatch);
  } catch (err) {
    await report("Couldn't open the file", err);
    // The file may have been moved or deleted since it was remembered; a re-read
    // prunes it from the list.
    await refreshRecents(dispatch);
  }
}

/** Save to the backing file, falling back to Save As when there isn't one. */
export async function saveDocument(
  state: EditorState,
  dispatch: Dispatch,
): Promise<void> {
  try {
    const path = state.currentPath ?? (await pickSavePath(state));
    if (path === null) return;
    await write(path, state, dispatch);
  } catch (err) {
    await report("Couldn't save the file", err);
  }
}

/** Always ask for a path, then save to it (and adopt it as the backing file). */
export async function saveDocumentAs(
  state: EditorState,
  dispatch: Dispatch,
): Promise<void> {
  try {
    const path = await pickSavePath(state);
    if (path === null) return;
    await write(path, state, dispatch);
  } catch (err) {
    await report("Couldn't save the file", err);
  }
}

/**
 * Write the drawing out as a picture — chrome-free, cropped to the diagram, and
 * independent of where the canvas happens to be scrolled.
 *
 * **An export is not a document.** It is a sibling of {@link write}, never a
 * caller: it must not remember the path as a recent *document*, must not clear
 * `dirty`, and must not adopt the file as the one being edited — which is why it
 * takes no `dispatch` at all. Nothing about the editor changes because a picture
 * was written.
 */
export async function exportDiagram(state: EditorState): Promise<void> {
  try {
    const chosen = await save({
      title: "Export diagram",
      defaultPath: withExtension(
        state.currentPath ?? state.doc.metadata.name,
        "svg",
      ),
      filters: EXPORT_FILTERS,
    });
    if (chosen === null) return;

    // Built once: both formats frame the same drawing, and the raster is this
    // very file rendered by the webview rather than a second drawing of it.
    const svg = diagramSvg(state.doc, await measureDiagram(state.doc));

    if (exportFormat(chosen) === "png") {
      const bytes = await rasterizePng(svg, PNG_SCALE);
      // `Array.from` is load-bearing: nested in the argument object a
      // `Uint8Array` stringifies to `{"0":…,"1":…}`, which serde will not read
      // back as a `Vec<u8>`. A plain number array it does.
      // The path is written exactly as chosen — `exportFormat` only says "png"
      // for a name that already ends in it, so there is nothing to append.
      await invoke("write_binary_file", {
        path: chosen,
        contents: Array.from(bytes),
      });
      return;
    }

    await invoke("write_text_file", {
      path: ensureExtension(chosen, "svg"),
      contents: svg,
    });
  } catch (err) {
    await report("Couldn't export the diagram", err);
  }
}

/**
 * Write the document out as an Assimilator `network.yaml`: its topology, with
 * the metric geometry a schematic does not have synthesized for it in Rust
 * (`rules/network-yaml.md`).
 *
 * **An export is not a document**, and this one inherits that rule from
 * {@link exportDiagram} unchanged: it takes no `dispatch`, so it cannot mark the
 * document saved, cannot adopt the path as the one being edited, and cannot push
 * it onto a recent list that opens `.zkai` files through `load_document`. A
 * document is exactly as dirty after an export as it was before one.
 *
 * It is *not* {@link importNetwork}'s mirror image, which is the whole subject
 * of {@link exportNotice}.
 */
export async function exportNetwork(state: EditorState): Promise<void> {
  try {
    const chosen = await save({
      title: "Export network",
      // Not the document's name, unlike every other dialog here: Assimilator
      // resolves a scenario's network through its `project.yaml`, and every
      // scenario in its demo tree names the file `network.yaml`.
      defaultPath: `network.${NETWORK_EXTENSION}`,
      filters: NETWORK_FILTERS,
    });
    if (chosen === null) return;

    await invoke("export_network", {
      path: ensureExtension(chosen, NETWORK_EXTENSION),
      doc: state.doc,
    });
    await notify("Network exported", exportNotice(state.doc));
  } catch (err) {
    await report("Couldn't export the network", err);
  }
}

/**
 * What the written file does not carry, said out loud rather than left to be
 * discovered by the person who runs it.
 *
 * Two losses. The first is unconditional (spec OQ-5): `detectors`, `stops`,
 * `crossings`, `rerouters` and every simulation-only junction field are dropped,
 * because a schematic has nowhere to draw one — so an imported file's blocks do
 * not survive the round trip, and the geometry that replaces its polylines is a
 * placeholder rather than a survey.
 *
 * The second is conditional, because it depends on where the junction came from
 * (OQ-8). `priority`/`yields_to` are carried through an import but never
 * *authored* — nothing in the schematic model says which arm is the major road —
 * so a priority junction drawn here exports with every movement `major`, which
 * is a give-way rule with nothing giving way. "Has movements and not one of them
 * is minor" is the test: an imported priority junction has one, and earns no
 * sentence.
 */
export function exportNotice(doc: Document): string {
  const notes = [
    "Topology and placeholder geometry only. Detectors, stops and simulation-only fields were not written.",
  ];
  if (doc.junctions.some(authoredPriority)) {
    notes.push(
      "A priority junction here was drawn rather than imported, so every movement is exported as major — nothing will yield.",
    );
  }
  return notes.join("\n\n");
}

/** A give-way junction with movements, none of which yields. See {@link exportNotice}. */
function authoredPriority(junction: Junction): boolean {
  // Absent is the one representation for an empty list: Rust elides the key.
  const movements = junction.movements ?? [];
  return (
    junction.control === "unsignalized" &&
    junction.rule === "priority" &&
    movements.length > 0 &&
    !movements.some((m) => m.priority === "minor")
  );
}

/** Read a document through the Rust command and install it as the current one. */
async function load(path: string, dispatch: Dispatch): Promise<void> {
  // Handed to the reducer raw: the command's JSON omits empty collections
  // (`skip_serializing_if`), and `loadDocument` is the one place that normalizes.
  const doc = await invoke<RawDocument>("load_document", { path });
  dispatch({ type: "loadDocument", doc, path });
  await rememberRecent(path, dispatch);
}

/** Run the save dialog; `null` when the user cancels. */
async function pickSavePath(state: EditorState): Promise<string | null> {
  const chosen = await save({
    title: "Save schematic",
    defaultPath: ensureZkaiExtension(
      state.currentPath ?? state.doc.metadata.name,
    ),
    filters: FILTERS,
  });
  return chosen === null ? null : ensureZkaiExtension(chosen);
}

/** Write the document through the Rust command and clear `dirty`. */
async function write(
  path: string,
  state: EditorState,
  dispatch: Dispatch,
): Promise<void> {
  await invoke("save_document", { path, doc: state.doc });
  dispatch({ type: "markSaved", path });
  await rememberRecent(path, dispatch);
}

/**
 * Load the remembered document list into state. Silent without a Tauri runtime:
 * the browser dev server has no menu to show them in anyway.
 */
export async function refreshRecents(dispatch: Dispatch): Promise<void> {
  if (!isTauri()) return;
  try {
    const recents = await invoke<string[]>("recent_files");
    dispatch({ type: "setRecents", recents });
  } catch (err) {
    console.error(`[zukai] Couldn't read the recent files: ${detail(err)}`);
  }
}

/**
 * Remember a path as the most recent document. Deliberately swallows its errors:
 * a broken recents store must not turn a successful save or open into a failure.
 */
async function rememberRecent(path: string, dispatch: Dispatch): Promise<void> {
  try {
    const recents = await invoke<string[]>("push_recent_file", { path });
    dispatch({ type: "setRecents", recents });
  } catch (err) {
    console.error(`[zukai] Couldn't update the recent files: ${detail(err)}`);
  }
}

/**
 * Guard the window's close button with the same prompt as New/Open, so closing
 * never silently drops unsaved work. Returns the unlisten handle, or `null` when
 * there is no native window to guard (plain `bun run dev`).
 */
export async function installCloseGuard(
  getState: () => EditorState,
): Promise<UnlistenFn | null> {
  if (!isTauri()) return null;
  try {
    return await getCurrentWindow().onCloseRequested(async (event) => {
      try {
        if (!(await confirmDiscard(getState()))) event.preventDefault();
      } catch (err) {
        // A prompt that failed to appear is no reason to lose the document:
        // keep the window and tell the user why it would not close.
        event.preventDefault();
        await report("Couldn't check for unsaved changes", err);
      }
    });
  } catch (err) {
    console.error(`[zukai] Couldn't guard the close button: ${detail(err)}`);
    return null;
  }
}

/**
 * `true` when it is safe to replace the current document — either nothing is
 * unsaved, or the user confirmed. Uses the dialog plugin's `ask()`; the webview's
 * own `window.confirm` is unreliable across platforms.
 */
async function confirmDiscard(state: EditorState): Promise<boolean> {
  if (!state.dirty) return true;
  return ask("Discard unsaved changes?", {
    title: "Unsaved changes",
    kind: "warning",
    okLabel: "Discard",
    cancelLabel: "Cancel",
  });
}

/**
 * Tell the user something that is not a failure.
 *
 * Swallows its own error on `rememberRecent`'s precedent, and for the same
 * reason: a notice that could not be shown must never turn a command that
 * *succeeded* into a reported failure.
 */
async function notify(title: string, text: string): Promise<void> {
  try {
    await message(text, { title, kind: "info" });
  } catch (err) {
    console.error(`[zukai] Couldn't show "${title}": ${detail(err)}`);
  }
}

/** Surface a failed command to the user, always leaving a console trail. */
async function report(title: string, err: unknown): Promise<void> {
  const text = detail(err);
  console.error(`[zukai] ${title}: ${text}`);
  try {
    await message(text, { title, kind: "error" });
  } catch {
    // No Tauri runtime (plain `bun run dev`) — the console line above is it.
  }
}

/** Readable text for a thrown value; Tauri command errors arrive as `Err(String)`. */
function detail(err: unknown): string {
  if (typeof err === "string") return err;
  return err instanceof Error ? err.message : String(err);
}
