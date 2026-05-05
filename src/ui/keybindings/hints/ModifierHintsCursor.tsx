import { type JSX } from "solid-js";
import type { HintEntry } from "../hintData.ts";
import { HintColumns } from "./HintColumns.tsx";

interface ModifierHintsCursorProps {
  header: string;
  entries: HintEntry[];
  expandedNamespaces: Set<string>;
  onExecute: (entry: HintEntry) => void;
  onToggleExpand: (entry: HintEntry) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  position: { x: number; y: number } | null;
}

function getEditorCursorPosition(): { x: number; y: number } | null {
  const editor = document.querySelector(".cm-editor");
  if (!editor) return null;

  const cursor = editor.querySelector(".cm-cursor-primary, .cm-cursor");
  if (cursor) {
    const rect = cursor.getBoundingClientRect();
    return { x: rect.left, y: rect.bottom + 4 };
  }

  const editorRect = editor.getBoundingClientRect();
  return {
    x: editorRect.left + editorRect.width / 2,
    y: editorRect.top + editorRect.height * 0.3,
  };
}

export { getEditorCursorPosition };

export function ModifierHintsCursor(props: ModifierHintsCursorProps): JSX.Element {
  const positionStyle = (): JSX.CSSProperties => {
    const pos = props.position;
    if (!pos) {
      return { left: "50%", top: "25vh", transform: "translateX(-50%)" };
    }
    const x = Math.min(pos.x, window.innerWidth - 280);
    const y = Math.min(pos.y, window.innerHeight - 200);
    return {
      left: `${Math.max(8, x)}px`,
      top: `${Math.max(8, y)}px`,
    };
  };

  return (
    <div
      class="mh-cursor"
      style={positionStyle()}
      role="tooltip"
      aria-live="polite"
      onMouseEnter={props.onMouseEnter}
      onMouseLeave={props.onMouseLeave}
    >
      <div class="mh-header">{props.header}</div>
      <div class="mh-body">
        <HintColumns
          entries={props.entries}
          columns={1}
          grouped={false}
          expandedNamespaces={props.expandedNamespaces}
          onExecute={props.onExecute}
          onToggleExpand={props.onToggleExpand}
        />
      </div>
    </div>
  );
}
