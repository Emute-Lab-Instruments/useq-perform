import { Component, For } from "solid-js";
import { Version } from "../../utils/referenceStore";

interface ReferenceFiltersProps {
  versionOptions: Version[];
  currentTargetVersion: string | null;
  onVersionChange: (version: string | null) => void;
  allTags: string[];
  selectedTags: Set<string>;
  onTagToggle: (tag: string) => void;
  onClearTags: () => void;
  connectedVersionString?: string;
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

export const ReferenceFilters: Component<ReferenceFiltersProps> = (props) => {
  return (
    <div class="doc-tags-container">
      <input
        type="text"
        class="doc-search-input"
        placeholder="Search functions..."
        value={props.searchQuery}
        onInput={(e) => props.onSearchChange(e.currentTarget.value)}
      />
      <div class="doc-filters-controls">
        <div class="doc-version-filter">
          <label class="doc-filter-label" for="modulisp-version-filter">Firmware version</label>
          <select 
            id="modulisp-version-filter" 
            class="doc-version-select"
            value={props.currentTargetVersion || ""}
            onChange={(e) => props.onVersionChange(e.currentTarget.value || null)}
          >
            <option value="">Show all firmware versions</option>
            <For each={props.versionOptions}>
              {(v) => (
                <option value={v.raw}>
                  v{v.raw} {props.connectedVersionString === v.raw ? "(connected)" : ""}
                </option>
              )}
            </For>
          </select>
        </div>
        <button 
          class="doc-clear-tags" 
          disabled={props.selectedTags.size === 0}
          onClick={props.onClearTags}
        >
          Clear tags
        </button>
      </div>
      <div class="doc-tags-wrapper">
        <For each={props.allTags}>
          {(tag) => (
            <div 
              class="doc-tag" 
              classList={{ selected: props.selectedTags.has(tag) }}
              onClick={() => props.onTagToggle(tag)}
            >
              {tag}
            </div>
          )}
        </For>
      </div>
    </div>
  );
};
