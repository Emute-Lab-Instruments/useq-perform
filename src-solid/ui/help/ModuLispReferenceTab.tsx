import { Component, For, createSignal, createMemo, Show, createResource } from "solid-js";
import { 
  referenceStore, 
  setReferenceStore, 
  setTargetVersion, 
  ReferenceEntry, 
  Version,
  parseVersionString,
  compareVersions
} from "../../utils/referenceStore";
import { ReferenceItem } from "./ReferenceItem";
import { ReferenceFilters } from "./ReferenceFilters";
import { currentVersion as connectedFirmwareVersion } from "../../../src/utils/upgradeCheck.mjs";
import { loadReferenceDataFromCandidates } from "./referenceDataLoader";

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

export const ModuLispReferenceTab: Component = () => {
  const [selectedTags, setSelectedTags] = createSignal<Set<string>>(new Set());

  const fetchReferenceData = async (): Promise<ReferenceEntry[]> => {
    const data = await loadReferenceDataFromCandidates();
    const normalized = data
      .map(normalizeEntry)
      .filter((entry): entry is ReferenceEntry => Boolean(entry));
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
      <ReferenceFilters 
        versionOptions={versionOptions()}
        currentTargetVersion={referenceStore.targetVersion}
        onVersionChange={setTargetVersion}
        allTags={allTags()}
        selectedTags={selectedTags()}
        onTagToggle={toggleTag}
        onClearTags={() => setSelectedTags(new Set())}
        connectedVersionString={connectedFirmwareVersion?.string}
      />

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
