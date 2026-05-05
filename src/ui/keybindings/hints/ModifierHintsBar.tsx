import { type JSX } from "solid-js";
import type { HintEntry } from "../hintData.ts";
import { columnCount } from "../hintData.ts";
import { HintColumns } from "./HintColumns.tsx";

interface ModifierHintsBarProps {
  header: string;
  entries: HintEntry[];
  expandedNamespaces: Set<string>;
  onExecute: (entry: HintEntry) => void;
  onToggleExpand: (entry: HintEntry) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

export function ModifierHintsBar(props: ModifierHintsBarProps): JSX.Element {
  const cols = () => columnCount("bar", props.entries.length);

  return (
    <div
      class="mh-bar"
      role="complementary"
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
  );
}
