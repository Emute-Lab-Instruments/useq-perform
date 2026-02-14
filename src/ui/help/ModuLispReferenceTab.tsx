import { Component, For, createSignal, createMemo, Show, createResource, onMount, onCleanup } from "solid-js";
import {
  referenceStore,
  setReferenceStore,
  setTargetVersion,
  toggleExpanded,
  ReferenceEntry,
  Version,
  parseVersionString,
  compareVersions
} from "../../utils/referenceStore";
import { ReferenceItem } from "./ReferenceItem";
import { ReferenceFilters } from "./ReferenceFilters";
import { currentVersion as connectedFirmwareVersion } from "../../legacy/utils/upgradeCheck.ts";
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

/**
 * Show a transient notification toast that auto-dismisses after a delay.
 */
function showNotification(message: string, durationMs = 2500): void {
  const existing = document.querySelector(".useq-reference-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.className = "useq-reference-toast";
  toast.textContent = message;
  document.body.appendChild(toast);

  // Trigger reflow so the enter animation plays
  void toast.offsetWidth;
  toast.classList.add("useq-reference-toast--visible");

  setTimeout(() => {
    toast.classList.remove("useq-reference-toast--visible");
    toast.addEventListener("transitionend", () => toast.remove(), { once: true });
    // Fallback removal in case transitionend doesn't fire
    setTimeout(() => toast.remove(), 400);
  }, durationMs);
}

/**
 * Search reference data for an entry whose name or aliases match the given symbol.
 * Returns the matching ReferenceEntry or null.
 */
function findReferenceEntry(data: ReferenceEntry[], symbol: string): ReferenceEntry | null {
  const lower = symbol.toLowerCase();

  // Direct name match (case-insensitive)
  const direct = data.find(entry => entry.name.toLowerCase() === lower);
  if (direct) return direct;

  // Alias match (case-insensitive)
  const byAlias = data.find(entry =>
    entry.aliases.some(alias => alias.toLowerCase() === lower)
  );
  if (byAlias) return byAlias;

  return null;
}

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

  // Handle Alt-F symbol reference search events from the editor
  const handleReferenceSearch = (e: Event) => {
    const detail = (e as CustomEvent).detail;
    const symbol: string = detail?.symbol;
    if (!symbol) return;

    const entry = findReferenceEntry(referenceStore.data, symbol);

    if (!entry) {
      showNotification(`No reference found for "${symbol}"`);
      return;
    }

    // Show the help panel if hidden
    const helpPanel = document.getElementById("panel-help");
    if (helpPanel && helpPanel.style.display === "none") {
      helpPanel.style.display = "";
    }

    // Switch to the Reference tab by clicking its button
    const refTabButton = document.getElementById("panel-help-tab-reference-button");
    if (refTabButton) {
      refTabButton.click();
    }

    // Clear tag filters so the entry is visible
    setSelectedTags(new Set());

    // Expand the matching entry if not already expanded
    if (!referenceStore.expanded.has(entry.name)) {
      toggleExpanded(entry.name);
    }

    // Scroll the entry into view after a short delay to allow DOM updates
    setTimeout(() => {
      const el = document.querySelector(`[data-function="${entry.name}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 100);
  };

  onMount(() => {
    window.addEventListener("useq-reference-search", handleReferenceSearch);
  });

  onCleanup(() => {
    window.removeEventListener("useq-reference-search", handleReferenceSearch);
  });

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
