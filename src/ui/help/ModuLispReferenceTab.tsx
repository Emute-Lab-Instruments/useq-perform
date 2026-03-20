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
import { currentVersion as connectedFirmwareVersion } from "../../transport/upgradeCheck.ts";
import { loadReferenceDataFromCandidates } from "../../lib/referenceDataLoader";

/** Raw shape of a reference entry as loaded from JSON (before normalization). */
interface RawReferenceEntry {
  name?: unknown;
  aliases?: unknown;
  tags?: unknown;
  parameters?: unknown;
  examples?: unknown;
  introduced_in_version?: unknown;
  changed_in_version?: unknown;
  [key: string]: unknown;
}
import { showChromePanel } from "../adapters/panelControls";
import { referenceSearchChannel, helpTabSwitchChannel } from "./helpChannels";

const normalizeEntry = (raw: unknown): ReferenceEntry | null => {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as RawReferenceEntry;
  return {
    ...r,
    name: typeof r.name === "string" ? r.name : "",
    aliases: Array.isArray(r.aliases) ? (r.aliases as unknown[]).filter((a): a is string => typeof a === "string") : [],
    tags: Array.isArray(r.tags) ? (r.tags as unknown[]).filter((t): t is string => typeof t === "string") : [],
    parameters: Array.isArray(r.parameters) ? (r.parameters as unknown[]).map((p) =>
      typeof p === "string" ? { name: p, description: "" } : (p as { name: string; description: string })
    ) : [],
    examples: Array.isArray(r.examples) ? (r.examples as string[]) : [],
    meta: {
      introduced: parseVersionString(r.introduced_in_version),
      changed: parseVersionString(r.changed_in_version),
    },
  };
};

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

  const fetchReferenceData = async (): Promise<ReferenceEntry[]> => {
    if (referenceStore.data.length > 0) {
      return referenceStore.data;
    }
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

    // Clear tag filters so the entry is visible
    setSelectedTags(new Set());

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
