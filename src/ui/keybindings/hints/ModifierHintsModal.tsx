import { type JSX } from "solid-js";
import type { HintEntry } from "../hintData.ts";
import { columnCount } from "../hintData.ts";
import { HintColumns } from "./HintColumns.tsx";

interface ModifierHintsModalProps {
  header: string;
  entries: HintEntry[];
  expandedNamespaces: Set<string>;
  onExecute: (entry: HintEntry) => void;
  onToggleExpand: (entry: HintEntry) => void;
  onBackdropClick: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

export function ModifierHintsModal(props: ModifierHintsModalProps): JSX.Element {
  const cols = () => columnCount("modal", props.entries.length);

  function handleBackdropMouseDown(e: MouseEvent): void {
    e.preventDefault();
    if (e.target === e.currentTarget) {
      props.onBackdropClick();
    }
  }

  return (
    <div
      class="mh-modal-backdrop"
      onMouseDown={handleBackdropMouseDown}
    >
      <div
        class="mh-modal-content"
        role="dialog"
        aria-live="polite"
        onMouseEnter={props.onMouseEnter}
        onMouseLeave={props.onMouseLeave}
      >
        <div class="mh-header">{props.header}</div>
        <div class="mh-body">
          <HintColumns
            entries={props.entries}
            columns={cols()}
            grouped={true}
            expandedNamespaces={props.expandedNamespaces}
            onExecute={props.onExecute}
            onToggleExpand={props.onToggleExpand}
          />
        </div>
      </div>
    </div>
  );
}
