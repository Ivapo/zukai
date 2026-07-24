import type { UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Canvas } from "./components/Canvas";
import { Inspector } from "./components/Inspector";
import { FileActions, Toolbar } from "./components/Toolbar";
import {
  installCloseGuard,
  newDocument,
  openDocument,
  openRecentDocument,
  refreshRecents,
  saveDocument,
  saveDocumentAs,
} from "./editor/files";
import { installMenu } from "./editor/menu";
import { initialState, reducer, Tool } from "./editor/state";
import { fileLabel } from "./model/document";
import "./styles.css";

/** Single-key shortcuts for switching tools. */
const TOOL_KEYS: Record<string, Tool> = { v: "select", n: "node", l: "link" };

function App() {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  /** Whether the native menu owns the Cmd/Ctrl chords (desktop) or we do. */
  const [menuInstalled, setMenuInstalled] = useState(false);

  // The file commands are async and outlive the render that started them, so
  // they read the live state through a ref rather than closing over a snapshot.
  const stateRef = useRef(state);
  stateRef.current = state;
  const files = useMemo<FileActions>(
    () => ({
      onNew: () => void newDocument(stateRef.current, dispatch),
      onOpen: () => void openDocument(stateRef.current, dispatch),
      onSave: () => void saveDocument(stateRef.current, dispatch),
      onSaveAs: () => void saveDocumentAs(stateRef.current, dispatch),
    }),
    [],
  );

  // Desktop-only, installed once: the remembered file list and the guard that
  // stops the window's close button from discarding unsaved work.
  useEffect(() => {
    void refreshRecents(dispatch);
    let unlisten: UnlistenFn | null = null;
    let unmounted = false;
    void installCloseGuard(() => stateRef.current).then((fn) => {
      if (unmounted) fn?.();
      else unlisten = fn;
    });
    return () => {
      unmounted = true;
      unlisten?.();
    };
  }, []);

  // The native menu mirrors the toolbar commands; rebuilt when the recent list
  // changes so "Open Recent" stays current.
  useEffect(() => {
    void installMenu({
      files,
      recents: state.recents,
      onOpenRecent: (path) =>
        void openRecentDocument(stateRef.current, dispatch, path),
      onUndo: () => dispatch({ type: "undo" }),
      onRedo: () => dispatch({ type: "redo" }),
    }).then(setMenuInstalled);
  }, [files, state.recents]);

  // Reflect the file name and unsaved state in the window/tab title.
  useEffect(() => {
    const dot = state.dirty ? "• " : "";
    document.title = `${dot}${fileLabel(state.currentPath)} — Zukai`;
  }, [state.currentPath, state.dirty]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Ignore keystrokes aimed at text inputs.
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

      // File and history shortcuts own every Cmd/Ctrl chord; returning
      // unconditionally keeps e.g. Cmd+N from also falling through to the Node
      // tool key below.
      if (e.metaKey || e.ctrlKey) {
        // With a native menu installed its accelerators fire these commands, so
        // handling them here as well would run some of them twice.
        if (menuInstalled) return;
        switch (e.key.toLowerCase()) {
          case "s":
            e.preventDefault();
            e.shiftKey ? files.onSaveAs() : files.onSave();
            break;
          case "o":
            e.preventDefault();
            files.onOpen();
            break;
          case "n":
            e.preventDefault();
            files.onNew();
            break;
          case "z":
            e.preventDefault();
            dispatch({ type: e.shiftKey ? "redo" : "undo" });
            break;
          // Redo's Windows spelling. Browser-path only: a native menu item
          // carries one accelerator, and the Edit menu already has Shift+Cmd+Z.
          case "y":
            e.preventDefault();
            dispatch({ type: "redo" });
            break;
        }
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        if (state.selection) {
          e.preventDefault();
          dispatch({ type: "deleteSelection" });
        }
      } else if (e.key === "Escape") {
        dispatch({ type: "cancelLink" });
        dispatch({ type: "select", selection: null });
      } else {
        const tool = TOOL_KEYS[e.key.toLowerCase()];
        if (tool) dispatch({ type: "setTool", tool });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.selection, files, menuInstalled]);

  return (
    <div className="app">
      <Toolbar state={state} dispatch={dispatch} files={files} />
      <div className="workspace">
        <Canvas state={state} dispatch={dispatch} />
        <Inspector state={state} dispatch={dispatch} />
      </div>
    </div>
  );
}

export default App;
