import { createStore } from "solid-js/store";
import { createEffect } from "solid-js";

export interface Version {
  major: number;
  minor: number;
  patch: number;
  raw: string;
}

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

const STORAGE_KEYS = {
  starred: "moduLispReference:starredFunctions",
  expanded: "moduLispReference:expandedFunctions",
  version: "moduLispReference:targetVersion",
};

const loadSet = (key: string) => {
  try {
    const raw = localStorage.getItem(key);
    return new Set<string>(JSON.parse(raw || "[]"));
  } catch (e) {
    return new Set<string>();
  }
};

export const [referenceStore, setReferenceStore] = createStore({
  data: [] as ReferenceEntry[],
  starred: loadSet(STORAGE_KEYS.starred),
  expanded: loadSet(STORAGE_KEYS.expanded),
  targetVersion: localStorage.getItem(STORAGE_KEYS.version) || null,
  isLoading: true,
  error: null as string | null,
});

// Persistence
createEffect(() => {
  localStorage.setItem(STORAGE_KEYS.starred, JSON.stringify(Array.from(referenceStore.starred)));
});

createEffect(() => {
  localStorage.setItem(STORAGE_KEYS.expanded, JSON.stringify(Array.from(referenceStore.expanded)));
});

createEffect(() => {
  if (referenceStore.targetVersion) {
    localStorage.setItem(STORAGE_KEYS.version, referenceStore.targetVersion);
  } else {
    localStorage.removeItem(STORAGE_KEYS.version);
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
