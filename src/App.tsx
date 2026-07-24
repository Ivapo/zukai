import { useEffect, useMemo, useReducer, useRef } from "react";
import { Canvas } from "./components/Canvas";
import { Inspector } from "./components/Inspector";
import { FileActions, Toolbar } from "./components/Toolbar";
import {
  newDocument,
  openDocument,
  saveDocument,
  saveDocumentAs,
} from "./editor/files";
import { initialState, reducer, Tool } from "./editor/state";
import { fileLabel } from "./model/document";
import "./styles.css";

/** Single-key shortcuts for switching tools. */
const TOOL_KEYS: Record<string, Tool> = { v: "select", n: "node", l: "link" };

function App() {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);

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

      // File shortcuts own every Cmd/Ctrl chord; returning unconditionally keeps
      // e.g. Cmd+N from also falling through to the Node tool key below.
      if (e.metaKey || e.ctrlKey) {
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
  }, [state.selection, files]);

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
