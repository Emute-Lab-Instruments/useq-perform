import { Component, For, createSignal, createMemo, Show, onMount, createResource } from "solid-js";
import { 
  referenceStore, 
  setReferenceStore, 
  toggleStarred, 
  toggleExpanded, 
  setTargetVersion, 
  ReferenceEntry, 
  Version 
} from "../../utils/referenceStore";
import { CodeMirrorEditor } from "./CodeMirrorEditor";
import { marked } from "marked";
import { currentVersion as connectedFirmwareVersion } from "../../../src/utils/upgradeCheck.mjs";

// Version utilities
const parseVersionString = (version: any): Version | null => {
  if (!version || typeof version !== "string") return null;
  const trimmed = version.trim().replace(/^v/i, "");
  if (!trimmed) return null;
  const [majorStr, minorStr = "0", patchStr = "0"] = trimmed.split(".");
  const major = parseInt(majorStr, 10);
  const minor = parseInt(minorStr, 10);
  const patch = parseInt(patchStr, 10);
  if (isNaN(major) || isNaN(minor)) return null;
  return { major, minor, patch: isNaN(patch) ? 0 : patch, raw: `${major}.${minor}.${isNaN(patch) ? 0 : patch}` };
};

const compareVersions = (left: Version | null, right: Version | null): number => {
  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  return left.patch - right.patch;
};

const normalizeEntry = (raw: any): ReferenceEntry | null => {
  if (!raw || typeof raw !== "object") return null;
  return {
    ...raw,
    name: raw.name || "",
    aliases: Array.isArray(raw.aliases) ? raw.aliases : [],
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    parameters: Array.isArray(raw.parameters) ? raw.parameters.map((p: any) => 
      typeof p === "string" ? { name: p, description: "" } : p
    ) : [],
    examples: Array.isArray(raw.examples) ? raw.examples : [],
    meta: {
      introduced: parseVersionString(raw.introduced_in_version),
      changed: parseVersionString(raw.changed_in_version),
    },
  };
};

const ReferenceItem: Component<{ entry: ReferenceEntry; targetVersion: Version | null }> = (props) => {
  const isExpanded = () => referenceStore.expanded.has(props.entry.name);
  const isStarred = () => referenceStore.starred.has(props.entry.name);

  const isAvailable = () => {
    if (!props.targetVersion || !props.entry.meta.introduced) return true;
    return compareVersions(props.targetVersion, props.entry.meta.introduced) >= 0;
  };

  const hasUpcomingChange = () => {
    if (!props.targetVersion || !props.entry.meta.changed) return false;
    return compareVersions(props.targetVersion, props.entry.meta.changed) < 0;
  };

  return (
    <div 
      class="doc-function-item" 
      classList={{ 
        "doc-function-item--expanded": isExpanded(),
        "doc-function-item--unavailable": !isAvailable()
      }}
      data-function={props.entry.name}
    >
      <div class="doc-function-header" onClick={() => toggleExpanded(props.entry.name)}>
        <div class="doc-function-name">
          {props.entry.name}
          <Show when={props.entry.parameters.length > 0}>
            <span class="doc-function-params-container">
              <For each={props.entry.parameters}>
                {(param) => <span class="doc-function-param"> &lt;{param.name}&gt;</span>}
              </For>
            </span>
          </Show>
        </div>
        <Show when={props.entry.meta.introduced}>
          <span class="doc-function-version-chip">
            {isAvailable() ? `Since v${props.entry.meta.introduced!.raw}` : `Requires v${props.entry.meta.introduced!.raw}`}
          </span>
        </Show>
        <button 
          class="doc-star-button" 
          onClick={(e) => { e.stopPropagation(); toggleStarred(props.entry.name); }}
        >
          {isStarred() ? "★" : "☆"}
        </button>
        <span class="doc-expand-indicator">{isExpanded() ? "▼" : "▶"}</span>
      </div>

      <Show when={isExpanded()}>
        <div class="doc-function-content doc-function-content--active">
          <Show when={!isAvailable()}>
            <div class="doc-function-availability-note">
              Available from firmware v{props.entry.meta.introduced?.raw}
            </div>
          </Show>

          <div class="doc-function-description" innerHTML={marked.parse(props.entry.description) as string} />

          <Show when={props.entry.meta.changed}>
            <div class={`doc-function-change-note ${hasUpcomingChange() ? 'doc-function-change-note--upcoming' : ''}`}>
              {hasUpcomingChange() ? `Changes coming in v${props.entry.meta.changed!.raw}` : `Updated in v${props.entry.meta.changed!.raw}`}
            </div>
          </Show>

          <Show when={props.entry.parameters.length > 0}>
            <div class="doc-section-title">Parameters</div>
            <ul class="doc-params-list">
              <For each={props.entry.parameters}>
                {(param) => (
                  <li class="doc-param-item">
                    <span class="doc-param-name">{param.name}</span>
                    <Show when={param.description}>
                      {" "}<span class="doc-param-description">{param.description}</span>
                    </Show>
                    <Show when={param.range}>
                      <div class="doc-param-range">Range: {param.range}</div>
                    </Show>
                  </li>
                )}
              </For>
            </ul>
          </Show>

          <Show when={props.entry.examples.length > 0}>
            <div class="doc-section-title">Examples</div>
            <div class="doc-examples-list">
              <For each={props.entry.examples}>
                {(example) => (
                  <div class="doc-example-wrapper">
                    <CodeMirrorEditor code={example} readOnly={true} fontSize="12px" minHeight="30px" />
                    <button 
                      class="doc-copy-button" 
                      onClick={(e) => {
                        e.stopPropagation();
                        navigator.clipboard.writeText(example);
                      }}
                    >
                      Copy
                    </button>
                  </div>
                )}
              </For>
            </div>
          </Show>

          <Show when={props.entry.tags.length > 0}>
            <div class="doc-section-title">Tags</div>
            <div class="doc-function-tags">
              <For each={props.entry.tags}>
                {(tag) => <span class="doc-function-tag">{tag}</span>}
              </For>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
};

export const ModuLispReferenceTab: Component = () => {
  const [selectedTags, setSelectedTags] = createSignal<Set<string>>(new Set());

  const fetchReferenceData = async () => {
    const response = await fetch("assets/modulisp_reference_data.json");
    const data = await response.json();
    const normalized = data.map(normalizeEntry).filter(Boolean);
    setReferenceStore("data", normalized);
    return normalized;
  };

  const [data] = createResource(fetchReferenceData);

  const allTags = createMemo(() => {
    const tags = new Set<string>();
    referenceStore.data.forEach(entry => entry.tags.forEach(t => tags.add(t)));
    return Array.from(tags).sort();
  });

  const versionOptions = createMemo(() => {
    const versions = new Map<string, Version>();
    referenceStore.data.forEach(entry => {
      if (entry.meta.introduced) versions.set(entry.meta.introduced.raw, entry.meta.introduced);
      if (entry.meta.changed) versions.set(entry.meta.changed.raw, entry.meta.changed);
    });
    
    // Add connected version if any
    const connected = parseVersionString(connectedFirmwareVersion?.string);
    if (connected) versions.set(connected.raw, connected);

    return Array.from(versions.values()).sort((a, b) => compareVersions(b, a));
  });

  const parsedTargetVersion = createMemo(() => parseVersionString(referenceStore.targetVersion));

  const filteredEntries = createMemo(() => {
    let filtered = [...referenceStore.data];
    
    if (selectedTags().size > 0) {
      filtered = filtered.filter(entry => entry.tags.some(t => selectedTags().has(t)));
    }

    filtered.sort((a, b) => {
      const aStarred = referenceStore.starred.has(a.name) ? 0 : 1;
      const bStarred = referenceStore.starred.has(b.name) ? 0 : 1;
      if (aStarred !== bStarred) return aStarred - bStarred;

      const target = parsedTargetVersion();
      const aAvailable = (!target || !a.meta.introduced || compareVersions(target, a.meta.introduced) >= 0) ? 0 : 1;
      const bAvailable = (!target || !b.meta.introduced || compareVersions(target, b.meta.introduced) >= 0) ? 0 : 1;
      if (aAvailable !== bAvailable) return aAvailable - bAvailable;

      return a.name.localeCompare(b.name);
    });

    return filtered;
  });

  const toggleTag = (tag: string) => {
    const next = new Set(selectedTags());
    if (next.has(tag)) next.delete(tag);
    else next.add(tag);
    setSelectedTags(next);
  };

  return (
    <div class="modulisp-reference-container">
      <div class="doc-tags-container">
        <div class="doc-filters-controls">
          <div class="doc-version-filter">
            <label class="doc-filter-label" for="modulisp-version-filter">Firmware version</label>
            <select 
              id="modulisp-version-filter" 
              class="doc-version-select"
              value={referenceStore.targetVersion || ""}
              onChange={(e) => setTargetVersion(e.currentTarget.value || null)}
            >
              <option value="">Show all firmware versions</option>
              <For each={versionOptions()}>
                {(v) => (
                  <option value={v.raw}>
                    v{v.raw} {connectedFirmwareVersion?.string === v.raw ? "(connected)" : ""}
                  </option>
                )}
              </For>
            </select>
          </div>
          <button 
            class="doc-clear-tags" 
            disabled={selectedTags().size === 0}
            onClick={() => setSelectedTags(new Set())}
          >
            Clear tags
          </button>
        </div>
        <div class="doc-tags-wrapper">
          <For each={allTags()}>
            {(tag) => (
              <div 
                class="doc-tag" 
                classList={{ selected: selectedTags().has(tag) }}
                onClick={() => toggleTag(tag)}
              >
                {tag}
              </div>
            )}
          </For>
        </div>
      </div>

      <div class="doc-function-list">
        <Show when={!data.loading} fallback={<div>Loading reference...</div>}>
          <For each={filteredEntries()}>
            {(entry) => <ReferenceItem entry={entry} targetVersion={parsedTargetVersion()} />}
          </For>
          <Show when={filteredEntries().length === 0}>
            <div class="doc-no-results">No functions match the current filters.</div>
          </Show>
        </Show>
      </div>
    </div>
  );
};