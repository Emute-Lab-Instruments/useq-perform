import { For, type JSX } from "solid-js";
import type { HintEntry } from "../hintData.ts";
import { HintRow } from "./HintRow.tsx";

interface HintChildRowsProps {
  children: HintEntry[];
  onExecute: (entry: HintEntry) => void;
}

export function HintChildRows(props: HintChildRowsProps): JSX.Element {
  return (
    <div class="mh-children">
      <For each={props.children}>
        {(child) => (
          <HintRow entry={child} indented onExecute={props.onExecute} />
        )}
      </For>
    </div>
  );
}
