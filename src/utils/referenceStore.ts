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

// Version utilities are re-exported from src/lib/versionUtils.ts above.
