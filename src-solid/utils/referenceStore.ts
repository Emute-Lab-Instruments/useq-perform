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

// Version utilities
export const parseVersionString = (version: any): Version | null => {
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

export const compareVersions = (left: Version | null, right: Version | null): number => {
  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  return left.patch - right.patch;
};
