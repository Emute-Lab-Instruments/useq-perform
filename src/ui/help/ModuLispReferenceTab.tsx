import { Component, For, createSignal, createMemo, Show, onMount, onCleanup } from "solid-js";
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
import { currentVersion as connectedFirmwareVersion } from "../../transport/upgradeCheck.ts";
import { loadReferenceDataFromCandidates, normalizeEntry } from "../../lib/referenceDataLoader";
import { showChromePanel } from "../adapters/panels";
import { referenceSearchChannel, helpTabSwitchChannel } from "./helpChannels";

/**
 * Show a transient notification toast that auto-dismisses after a delay.
 */
let _toastTimer: ReturnType<typeof setTimeout> | undefined;

function showNotification(message: string, durationMs = 2500): void {
  const existing = document.querySelector(".useq-reference-toast");
  if (existing) {
    existing.remove();
    clearTimeout(_toastTimer);
  }

  const toast = document.createElement("div");
  toast.className = "useq-reference-toast";
  toast.textContent = message;
  document.body.appendChild(toast);

  // Trigger reflow so the enter animation plays
  void toast.offsetWidth;
  toast.classList.add("useq-reference-toast--visible");

  _toastTimer = setTimeout(() => {
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
  const [searchQuery, setSearchQuery] = createSignal("");

  // Fallback: if the preloader hasn't populated the store yet, load on mount.
  onMount(async () => {
    if (referenceStore.data.length > 0) {
      setReferenceStore("isLoading", false);
      return;
    }
    try {
      const data = await loadReferenceDataFromCandidates();
      const normalized = data
        .map(normalizeEntry)
        .filter((entry): entry is ReferenceEntry => Boolean(entry));
      setReferenceStore("data", normalized);
    } catch (err) {
      setReferenceStore("error", err instanceof Error ? err.message : String(err));
    } finally {
      setReferenceStore("isLoading", false);
    }
  });

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

    const query = searchQuery().toLowerCase().trim();
    if (query) {
      filtered = filtered.filter(entry => {
        return (
          entry.name.toLowerCase().includes(query) ||
          entry.aliases.some(a => a.toLowerCase().includes(query)) ||
          entry.parameters.some(p => p.name.toLowerCase().includes(query)) ||
          (typeof entry.description === "string" && entry.description.toLowerCase().includes(query)) ||
          entry.tags.some(t => t.toLowerCase().includes(query)) ||
          entry.examples.some(ex => ex.toLowerCase().includes(query))
        );
      });
    }

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

  // Handle Alt-F symbol reference search requests from the editor
  const handleReferenceSearch = ({ symbol }: { symbol: string }) => {
    if (!symbol) return;

    const entry = findReferenceEntry(referenceStore.data, symbol);

    if (!entry) {
      showNotification(`No reference found for "${symbol}"`);
      return;
    }

    // Show the help panel using adapter API
    showChromePanel("help");

    // Switch to the Reference tab via typed channel
    helpTabSwitchChannel.publish({ tabId: "panel-help-tab-reference" });

    // Clear filters so the entry is visible
    setSelectedTags(new Set<string>());
    setSearchQuery("");

    // Expand the matching entry if not already expanded
    if (!referenceStore.expanded.has(entry.name)) {
      toggleExpanded(entry.name);
    }

    // Scroll after Solid has flushed the DOM update.
    queueMicrotask(() => requestAnimationFrame(() => {
      const el = document.querySelector(`[data-function="${entry.name}"]`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    }));
  };

  onMount(() => {
    const unsub = referenceSearchChannel.subscribe(handleReferenceSearch);
    onCleanup(unsub);
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
        searchQuery={searchQuery()}
        onSearchChange={setSearchQuery}
      />

      <div class="doc-function-list">
        <Show when={!referenceStore.isLoading} fallback={<div>Loading reference...</div>}>
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
