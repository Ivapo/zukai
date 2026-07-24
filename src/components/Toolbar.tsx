/** Top control bar: wordmark, tool selection, and zoom readout. */

import type { ReactNode } from "react";
import { clampZoom } from "../editor/geometry";
import { Action, EditorState, Tool } from "../editor/state";
import { fileLabel } from "../model/document";

interface ToolbarProps {
  state: EditorState;
  dispatch: (action: Action) => void;
}

const TOOLS: { tool: Tool; label: string; hint: string; icon: ReactNode }[] = [
  { tool: "select", label: "Select", hint: "V", icon: <CursorIcon /> },
  { tool: "node", label: "Node", hint: "N", icon: <NodeIcon /> },
  { tool: "link", label: "Link", hint: "L", icon: <LinkIcon /> },
];

export function Toolbar({ state, dispatch }: ToolbarProps) {
  const { tool, view } = state;
  return (
    <header className="toolbar">
      <div className="toolbar-left">
        <div className="wordmark">
          Zukai<span className="wordmark-sub">schematic</span>
        </div>
        <span
          className={`doc-name${state.dirty ? " is-dirty" : ""}`}
          title={state.dirty ? "Unsaved changes" : undefined}
        >
          {fileLabel(state.currentPath)}
        </span>
      </div>

      <div className="tools" role="radiogroup" aria-label="Drawing tool">
        {TOOLS.map((t) => (
          <button
            key={t.tool}
            className={`tool${tool === t.tool ? " is-active" : ""}`}
            role="radio"
            aria-checked={tool === t.tool}
            title={`${t.label} (${t.hint})`}
            onClick={() => dispatch({ type: "setTool", tool: t.tool })}
          >
            {t.icon}
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      <div className="zoom">
        <button
          className="zoom-btn"
          title="Zoom out"
          onClick={() => dispatch({ type: "setView", view: scaleView(view, 1 / 1.2) })}
        >
          −
        </button>
        <span className="zoom-value">{Math.round(view.k * 100)}%</span>
        <button
          className="zoom-btn"
          title="Zoom in"
          onClick={() => dispatch({ type: "setView", view: scaleView(view, 1.2) })}
        >
          +
        </button>
      </div>
    </header>
  );
}

/** Zoom about the current view centre-ish (origin) by a factor. */
function scaleView(view: EditorState["view"], factor: number) {
  const k = clampZoom(view.k * factor);
  return { ...view, k };
}

function CursorIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden>
      <path
        d="M3 2l9 4.5-3.7 1.2L6.8 12 3 2z"
        fill="currentColor"
      />
    </svg>
  );
}

function NodeIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden>
      <circle cx="8" cy="8" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden>
      <circle cx="3" cy="13" r="2" fill="currentColor" />
      <circle cx="13" cy="3" r="2" fill="currentColor" />
      <path d="M4 12L12 4" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
