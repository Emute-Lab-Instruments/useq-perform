import { For, Show, type JSX } from "solid-js";
import type { HintEntry } from "../hintData.ts";
import { groupByCategory, categoryLabel } from "../hintData.ts";
import type { ActionCategory } from "../../../lib/keybindings/actions.ts";
import { HintRow } from "./HintRow.tsx";
import { HintChildRows } from "./HintChildRows.tsx";

interface HintColumnsProps {
  entries: HintEntry[];
  columns: 1 | 2 | 3;
  grouped: boolean;
  expandedNamespaces: Set<string>;
  onExecute: (entry: HintEntry) => void;
  onToggleExpand: (entry: HintEntry) => void;
}

interface ColumnData {
  groups: { category: ActionCategory | null; entries: HintEntry[] }[];
}

function distributeIntoColumns(
  grouped: Map<ActionCategory, HintEntry[]>,
  numCols: 1 | 2 | 3,
): ColumnData[] {
  const groups = [...grouped.entries()].map(([cat, items]) => ({
    category: cat,
    entries: items,
    rowCount: items.length + 1, // +1 for header
  }));

  if (numCols === 1) {
    return [{ groups: groups.map((g) => ({ category: g.category, entries: g.entries })) }];
  }

  const columns: ColumnData[] = Array.from({ length: numCols }, () => ({ groups: [] }));
  const columnHeights = new Array(numCols).fill(0);

  for (const group of groups) {
    const minIdx = columnHeights.indexOf(Math.min(...columnHeights));
    columns[minIdx].groups.push({ category: group.category, entries: group.entries });
    columnHeights[minIdx] += group.rowCount;
  }

  return columns;
}

export function HintColumns(props: HintColumnsProps): JSX.Element {
  const columnsData = () => {
    if (!props.grouped || props.columns === 1) {
      return [{ groups: [{ category: null as ActionCategory | null, entries: props.entries }] }];
    }
    const grouped = groupByCategory(props.entries);
    return distributeIntoColumns(grouped, props.columns);
  };

  return (
    <div
      class="mh-columns"
      style={{ "grid-template-columns": `repeat(${props.columns}, 1fr)` }}
    >
      <For each={columnsData()}>
        {(col) => (
          <div class="mh-column">
            <For each={col.groups}>
              {(group) => (
                <div class="mh-group">
                  <Show when={group.category && props.grouped}>
                    <div class="mh-category-header">
                      {categoryLabel(group.category!)}
                    </div>
                  </Show>
                  <For each={group.entries}>
                    {(entry) => (
                      <>
                        <HintRow
                          entry={entry}
                          onExecute={props.onExecute}
                          onToggleExpand={props.onToggleExpand}
                          isExpanded={props.expandedNamespaces.has(entry.key)}
                        />
                        <Show when={entry.isChord && entry.children && props.expandedNamespaces.has(entry.key)}>
                          <HintChildRows
                            children={entry.children!}
                            onExecute={props.onExecute}
                          />
                        </Show>
                      </>
                    )}
                  </For>
                </div>
              )}
            </For>
          </div>
        )}
      </For>
    </div>
  );
}
