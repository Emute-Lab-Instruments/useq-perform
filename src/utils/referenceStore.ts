import { createStore } from "solid-js/store";
import { createEffect } from "solid-js";
import { load, save, loadRaw, saveRaw, remove, PERSISTENCE_KEYS } from "../lib/persistence.ts";
export { type Version, parseVersionString, compareVersions } from "../lib/versionUtils.ts";
import type { Version } from "../lib/versionUtils.ts";

export interface Parameter {
  name: string;
  description: string;
  range?: string;
}

export interface ReferenceEntry {
  name: string;
  description: string;
  aliases: string[];
  tags: string[];
  parameters: Parameter[];
  examples: string[];
  meta: {
    introduced: Version | null;
    changed: Version | null;
  };
}

const loadSet = (key: string) => {
  const arr = load<string[]>(key, []);
  return new Set<string>(Array.isArray(arr) ? arr : []);
};

export const [referenceStore, setReferenceStore] = createStore({
  data: [] as ReferenceEntry[],
  starred: loadSet(PERSISTENCE_KEYS.referenceStarred),
  expanded: loadSet(PERSISTENCE_KEYS.referenceExpanded),
  targetVersion: loadRaw(PERSISTENCE_KEYS.referenceVersion) as string | null,
  isLoading: true,
  error: null as string | null,
});

// Persistence
createEffect(() => {
  save(PERSISTENCE_KEYS.referenceStarred, Array.from(referenceStore.starred));
});

createEffect(() => {
  save(PERSISTENCE_KEYS.referenceExpanded, Array.from(referenceStore.expanded));
});

createEffect(() => {
  if (referenceStore.targetVersion) {
    saveRaw(PERSISTENCE_KEYS.referenceVersion, referenceStore.targetVersion);
  } else {
    remove(PERSISTENCE_KEYS.referenceVersion);
  }
});

export const toggleStarred = (name: string) => {
  setReferenceStore("starred", (s) => {
    const next = new Set(s);
    if (next.has(name)) {
      next.delete(name);
    } else {
      next.add(name);
    }
    return next;
  });
};

export const toggleExpanded = (name: string) => {
  setReferenceStore("expanded", (s) => {
    const next = new Set(s);
    if (next.has(name)) {
      next.delete(name);
    } else {
      next.add(name);
    }
    return next;
  });
};

export const setTargetVersion = (version: string | null) => {
  setReferenceStore("targetVersion", version);
};

// ── Deduplicated loading guard ─────────────────────────────────────
// Ensures only one load runs at a time. If data is already loaded or a
// load is in flight, subsequent calls no-op or await the existing load.

let _loadPromise: Promise<void> | null = null;

/**
 * Load reference data into the store exactly once.
 *
 * If data is already loaded, returns immediately. If a load is already in
 * flight, returns the existing promise so the caller awaits the same work.
 */
export function ensureReferenceDataLoaded(): Promise<void> {
  // Already loaded — nothing to do.
  if (referenceStore.data.length > 0) {
    setReferenceStore("isLoading", false);
    return Promise.resolve();
  }

  // Load already in flight — piggyback on it.
  if (_loadPromise) return _loadPromise;

  _loadPromise = (async () => {
    try {
      const { loadReferenceDataFromCandidates, normalizeEntry } = await import(
        "../lib/referenceDataLoader.ts"
      );
      const raw = await loadReferenceDataFromCandidates();
      const normalized = raw
        .map(normalizeEntry)
        .filter(
          (entry): entry is NonNullable<ReturnType<typeof normalizeEntry>> =>
            Boolean(entry),
        );
      setReferenceStore("data", normalized);
    } catch (err) {
      setReferenceStore(
        "error",
        err instanceof Error ? err.message : String(err),
      );
      // Reset so a future call can retry after a transient failure.
      _loadPromise = null;
    } finally {
      setReferenceStore("isLoading", false);
    }
  })();

  return _loadPromise;
}

// Version utilities are re-exported from src/lib/versionUtils.ts above.
