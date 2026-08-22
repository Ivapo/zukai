/**
 * The New / Open / Save / Save As / Import / Export commands.
 *
 * Import comes in two shapes — one that asks the host for a file and one that
 * is handed a `File` — and the second is what a canvas drop calls.
 *
 * Every one of them is the same shape: decide what the user wants, ask the
 * *host* to touch the outside world, then dispatch. The host
 * (`host.ts`) is what makes them work in a browser tab as well as in the desktop
 * app — this module names no dialog, no `invoke` and no window, and that is the
 * property to preserve. It is deliberately kept out of the reducer so the
 * *apply* logic (`loadDocument`/`newDocument`/`markSaved`, `normalizeDocument`)
 * stays pure and unit-testable.
 *
 * Two conventions the hosts share: a `null` return means the user **cancelled**
 * and nothing is wrong, while a **throw** is a failure and lands in `report`.
 */

import { RawDocument } from "../model/document";
import {
  diagramSvg,
  ExportFormat,
  measureDiagram,
  PNG_SCALE,
  rasterizePng,
} from "./export";
import { host, Unsubscribe } from "./host";
import { Action, EditorState } from "./state";

type Dispatch = (action: Action) => void;

/** Start again, after checking there is nothing to lose. */
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

/** Pick a `.zkai` and load it, after checking there is nothing to lose. */
export async function openDocument(
  state: EditorState,
  dispatch: Dispatch,
): Promise<void> {
  try {
    // Before the prompt, not after: a host that cannot open anything must not
    // make the user answer a discard question first. The call throws, and the
    // catch below turns that into the banner.
    if (!host().canOpenDocuments) {
      await host().open();
      return;
    }
    if (!(await confirmDiscard(state))) return;
    const opened = await host().open();
    if (opened === null) return;
    await install(opened.doc, opened.path, dispatch);
  } catch (err) {
    await report("Couldn't open the file", err);
  }
}

/**
 * Import an Assimilator `network.yaml` as a new document.
 *
 * The result arrives **dirty and pathless** (`importDocument`, not
 * `loadDocument`): it is a fresh schematic derived from someone else's file, not
 * a Zukai document that lives at that path, so Save must ask where to put it.
 * The network's path is deliberately not pushed to recents for the same reason.
 *
 * No `canOpenDocuments` check, unlike `openDocument`: both hosts can read a
 * network now — the desktop over IPC, the browser through the wasm — and that
 * flag is about `.zkai`.
 */
export async function importNetwork(
  state: EditorState,
  dispatch: Dispatch,
): Promise<void> {
  try {
    if (!(await confirmDiscard(state))) return;
    const doc = await host().importNetwork();
    if (doc === null) return;
    dispatch({ type: "importDocument", doc });
  } catch (err) {
    await report("Couldn't import the network", err);
  }
}

/**
 * Import a network the user has already handed over — a dropped file.
 *
 * The push-shaped twin of {@link importNetwork}, which is pull-shaped: there,
 * the host opens a picker and sources the file itself; here the `File` arrives
 * first and the host is asked only to read its text. Everything else is
 * identical, discard prompt included, so a drop cannot lose work a click would
 * have protected. `File` is a web type both hosts have, and `file.text()` names
 * no codec — {@link Host.importNetworkText} is where that lives.
 */
export async function importNetworkFile(
  state: EditorState,
  dispatch: Dispatch,
  file: File,
): Promise<void> {
  try {
    if (!(await confirmDiscard(state))) return;
    const doc = await host().importNetworkText(await file.text());
    dispatch({ type: "importDocument", doc });
  } catch (err) {
    await report("Couldn't import the network", err);
  }
}

/**
 * Say so when something was dropped that this build cannot read.
 *
 * Lives here rather than at the drop site so that `report` — and therefore the
 * banner — keeps exactly one caller-facing home. `.zkai` joins the readable set
 * in Phase 3; until then it lands here with everything else.
 */
export async function reportUnsupportedDrop(name: string): Promise<void> {
  await report(
    "Couldn't open the dropped file",
    `${name} is not an Assimilator network. Drop a .yaml or .yml network file.`,
  );
}

/** Open a remembered file, after checking there is nothing to lose. */
export async function openRecentDocument(
  state: EditorState,
  dispatch: Dispatch,
  path: string,
): Promise<void> {
  try {
    if (!(await confirmDiscard(state))) return;
    await install(await host().read(path), path, dispatch);
  } catch (err) {
    await report("Couldn't open the file", err);
    // The file may have been moved or deleted since it was remembered; a re-read
    // prunes it from the list.
    await refreshRecents(dispatch);
  }
}

/** Save to the document's own path, asking for one if it has none. */
export async function saveDocument(
  state: EditorState,
  dispatch: Dispatch,
): Promise<void> {
  try {
    const path = await host().save(
      state.doc,
      state.currentPath,
      state.currentPath ?? state.doc.metadata.name,
    );
    if (path === null) return;
    await adopt(path, dispatch);
  } catch (err) {
    await report("Couldn't save the file", err);
  }
}

/** Always ask where, whatever the document's path is. */
export async function saveDocumentAs(
  state: EditorState,
  dispatch: Dispatch,
): Promise<void> {
  try {
    const path = await host().save(
      state.doc,
      null,
      state.currentPath ?? state.doc.metadata.name,
    );
    if (path === null) return;
    await adopt(path, dispatch);
  } catch (err) {
    await report("Couldn't save the file", err);
  }
}

/**
 * Write the drawing out as a picture.
 *
 * Takes no `dispatch` on purpose: writing a picture changes nothing about the
 * document, so it must not mark it saved, adopt the path, or touch recents.
 *
 * `format` is how the browser asks for one of its two explicit commands. The
 * desktop passes nothing and its save dialog decides, which is the only way a
 * single Export… command can offer both (`export.tsx:exportFormat`).
 */
export async function exportDiagram(
  state: EditorState,
  format: ExportFormat | null = null,
): Promise<void> {
  try {
    const target = await host().exportTarget({
      format,
      currentPath: state.currentPath,
      name: state.doc.metadata.name,
    });
    if (target === null) return;

    // Built once: both formats frame the same drawing, and the raster is this
    // very file rendered by the browser rather than a second drawing of it.
    const svg = diagramSvg(state.doc, await measureDiagram(state.doc));

    await host().deliverExport(
      target,
      target.format === "png" ? await rasterizePng(svg, PNG_SCALE) : svg,
    );
  } catch (err) {
    await report("Couldn't export the diagram", err);
  }
}

/**
 * Adopt a freshly written path: the document now lives there and is clean.
 * One site, so both save commands remember the file exactly once.
 */
async function adopt(path: string, dispatch: Dispatch): Promise<void> {
  dispatch({ type: "markSaved", path });
  await rememberRecent(path, dispatch);
}

/**
 * Install a loaded document. One site, so both open commands dispatch and
 * remember identically.
 */
async function install(
  doc: RawDocument,
  path: string,
  dispatch: Dispatch,
): Promise<void> {
  // Raw: the reducer is the one place that normalizes.
  dispatch({ type: "loadDocument", doc, path });
  await rememberRecent(path, dispatch);
}

/** Re-read the remembered file list. Empty on a host that remembers nothing. */
export async function refreshRecents(dispatch: Dispatch): Promise<void> {
  try {
    dispatch({ type: "setRecents", recents: await host().recents() });
  } catch (err) {
    console.error(`[zukai] Couldn't read the recent files: ${detail(err)}`);
  }
}

/**
 * Push a path to the front of the remembered list.
 *
 * Failures are swallowed to a console line on purpose: a broken recents store is
 * not a reason to tell someone their save failed, because it did not.
 */
async function rememberRecent(
  path: string,
  dispatch: Dispatch,
): Promise<void> {
  try {
    dispatch({ type: "setRecents", recents: await host().rememberRecent(path) });
  } catch (err) {
    console.error(`[zukai] Couldn't update the recent files: ${detail(err)}`);
  }
}

/**
 * Stop the window closing on unsaved work. Returns the unsubscribe, or `null`
 * where the host has no such event to hook.
 *
 * `getState` rather than a snapshot: this is installed once and asked much
 * later, so it must read the document as it is at close time.
 */
export async function installCloseGuard(
  getState: () => EditorState,
): Promise<Unsubscribe | null> {
  try {
    return await host().closeGuard({
      hasUnsavedWork: () => getState().dirty,
      async mayClose() {
        try {
          return await confirmDiscard(getState());
        } catch (err) {
          // A prompt that failed to appear is no reason to lose the document:
          // keep the window and tell the user why it would not close.
          await report("Couldn't check for unsaved changes", err);
          return false;
        }
      },
    });
  } catch (err) {
    console.error(`[zukai] Couldn't guard the close button: ${detail(err)}`);
    return null;
  }
}

/**
 * Whether it is safe to throw the current document away — trivially true when
 * there is nothing unsaved, so a clean document never sees a prompt.
 */
async function confirmDiscard(state: EditorState): Promise<boolean> {
  if (!state.dirty) return true;
  return host().confirm("Discard unsaved changes?");
}

/** Surface a failed command to the user, always leaving a console trail. */
async function report(title: string, err: unknown): Promise<void> {
  const text = detail(err);
  console.error(`[zukai] ${title}: ${text}`);
  try {
    await host().notify(title, text);
  } catch {
    // Nothing left to try — the console line above is it.
  }
}

/** Readable text for a thrown value; Tauri command errors arrive as `Err(String)`. */
function detail(err: unknown): string {
  if (typeof err === "string") return err;
  return err instanceof Error ? err.message : String(err);
}
