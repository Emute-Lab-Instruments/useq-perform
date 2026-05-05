import type { JSX } from "solid-js";
import type { HintEntry } from "../hintData.ts";

interface HintRowProps {
  entry: HintEntry;
  indented?: boolean;
  onExecute: (entry: HintEntry) => void;
  onToggleExpand?: (entry: HintEntry) => void;
  isExpanded?: boolean;
}

export function HintRow(props: HintRowProps): JSX.Element {
  function handleMouseDown(e: MouseEvent): void {
    e.preventDefault();
  }

  function handleClick(): void {
    props.onExecute(props.entry);
  }

  function handleToggleClick(e: MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();
    props.onToggleExpand?.(props.entry);
  }

  return (
    <div
      class={`mh-row${props.indented ? " mh-row--indented" : ""}`}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      tabindex={-1}
    >
      <span class="mh-key">
        {props.entry.displayKey}
        {props.entry.isChord && (
          <span class="mh-chord-arrow">{"→"}</span>
        )}
      </span>
      <span class="mh-desc">{props.entry.description}</span>
      {props.entry.isChord && props.onToggleExpand && (
        <button
          class="mh-expand"
          onMouseDown={handleMouseDown}
          onClick={handleToggleClick}
          tabindex={-1}
        >
          {props.isExpanded ? "▾" : "▸"}
        </button>
      )}
    </div>
  );
}
