import { useEffect, useReducer } from "react";
import { Canvas } from "./components/Canvas";
import { Inspector } from "./components/Inspector";
import { Toolbar } from "./components/Toolbar";
import { initialState, reducer, Tool } from "./editor/state";
import "./styles.css";

/** Single-key shortcuts for switching tools. */
const TOOL_KEYS: Record<string, Tool> = { v: "select", n: "node", l: "link" };

function App() {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Ignore keystrokes aimed at text inputs.
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

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
  }, [state.selection]);

  return (
    <div className="app">
      <Toolbar state={state} dispatch={dispatch} />
      <div className="workspace">
        <Canvas state={state} dispatch={dispatch} />
        <Inspector state={state} dispatch={dispatch} />
      </div>
    </div>
  );
}

export default App;
