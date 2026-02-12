import { beforeEach, describe, expect, it, vi } from "vitest";

type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  clear: () => void;
};

type SeedState = {
  starred?: unknown;
  expanded?: unknown;
  targetVersion?: string | null;
};

function createLocalStorageMock(initial: Record<string, string> = {}): StorageLike {
  const store = new Map(Object.entries(initial));

  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
}

function installStorage(seed: SeedState = {}) {
  const initial: Record<string, string> = {};

  if (seed.starred !== undefined) {
    initial["moduLispReference:starredFunctions"] =
      typeof seed.starred === "string" ? seed.starred : JSON.stringify(seed.starred);
  }

  if (seed.expanded !== undefined) {
    initial["moduLispReference:expandedFunctions"] =
      typeof seed.expanded === "string" ? seed.expanded : JSON.stringify(seed.expanded);
  }

  if (seed.targetVersion !== undefined && seed.targetVersion !== null) {
    initial["moduLispReference:targetVersion"] = seed.targetVersion;
  }

  const mock = createLocalStorageMock(initial);
  Object.defineProperty(globalThis, "localStorage", {
    value: mock,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(window, "localStorage", {
    value: mock,
    configurable: true,
    writable: true,
  });

  return mock;
}

async function loadReferenceStore(seed: SeedState = {}) {
  vi.resetModules();
  const storage = installStorage(seed);
  const module = await import("./referenceStore");
  return { ...module, storage };
}

// ── Pure function tests (no SolidJS runtime needed) ──

describe("parseVersionString", () => {
  let parseVersionString: typeof import("./referenceStore").parseVersionString;

  beforeEach(async () => {
    vi.resetModules();
    installStorage();
    const mod = await import("./referenceStore");
    parseVersionString = mod.parseVersionString;
  });

  it("returns null for null input", () => {
    expect(parseVersionString(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(parseVersionString(undefined)).toBeNull();
  });

  it("returns null for non-string input", () => {
    expect(parseVersionString(123)).toBeNull();
    expect(parseVersionString({})).toBeNull();
    expect(parseVersionString(true)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseVersionString("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(parseVersionString("   ")).toBeNull();
  });

  it("parses full semver string", () => {
    const result = parseVersionString("1.2.3");
    expect(result).toEqual({ major: 1, minor: 2, patch: 3, raw: "1.2.3" });
  });

  it("strips 'v' prefix (lowercase)", () => {
    const result = parseVersionString("v1.2.3");
    expect(result).toEqual({ major: 1, minor: 2, patch: 3, raw: "1.2.3" });
  });

  it("strips 'V' prefix (uppercase)", () => {
    const result = parseVersionString("V1.2.3");
    expect(result).toEqual({ major: 1, minor: 2, patch: 3, raw: "1.2.3" });
  });

  it("defaults patch to 0 when only major.minor provided", () => {
    const result = parseVersionString("1.2");
    expect(result).toEqual({ major: 1, minor: 2, patch: 0, raw: "1.2.0" });
  });

  it("defaults minor and patch to 0 when only major provided", () => {
    const result = parseVersionString("1");
    expect(result).toEqual({ major: 1, minor: 0, patch: 0, raw: "1.0.0" });
  });

  it("returns null when major is NaN", () => {
    expect(parseVersionString("abc")).toBeNull();
  });

  it("returns null when minor is NaN", () => {
    expect(parseVersionString("1.abc")).toBeNull();
  });

  it("handles version with NaN patch gracefully (defaults to 0)", () => {
    const result = parseVersionString("1.2.abc");
    expect(result).toEqual({ major: 1, minor: 2, patch: 0, raw: "1.2.0" });
  });
});

describe("compareVersions", () => {
  let compareVersions: typeof import("./referenceStore").compareVersions;
  let parseVersionString: typeof import("./referenceStore").parseVersionString;

  beforeEach(async () => {
    vi.resetModules();
    installStorage();
    const mod = await import("./referenceStore");
    compareVersions = mod.compareVersions;
    parseVersionString = mod.parseVersionString;
  });

  it("returns 0 when both are null", () => {
    expect(compareVersions(null, null)).toBe(0);
  });

  it("returns -1 when left is null", () => {
    const right = parseVersionString("1.0.0")!;
    expect(compareVersions(null, right)).toBe(-1);
  });

  it("returns 1 when right is null", () => {
    const left = parseVersionString("1.0.0")!;
    expect(compareVersions(left, null)).toBe(1);
  });

  it("returns 0 for identical versions", () => {
    const left = parseVersionString("2.3.4")!;
    const right = parseVersionString("2.3.4")!;
    expect(compareVersions(left, right)).toBe(0);
  });

  it("returns positive when left has greater major", () => {
    const left = parseVersionString("3.0.0")!;
    const right = parseVersionString("1.0.0")!;
    expect(compareVersions(left, right)).toBeGreaterThan(0);
  });

  it("returns negative when left has lesser major", () => {
    const left = parseVersionString("1.0.0")!;
    const right = parseVersionString("3.0.0")!;
    expect(compareVersions(left, right)).toBeLessThan(0);
  });

  it("compares minor when major is equal", () => {
    const left = parseVersionString("2.5.0")!;
    const right = parseVersionString("2.3.0")!;
    expect(compareVersions(left, right)).toBeGreaterThan(0);
  });

  it("returns negative when left has lesser minor", () => {
    const left = parseVersionString("2.1.0")!;
    const right = parseVersionString("2.3.0")!;
    expect(compareVersions(left, right)).toBeLessThan(0);
  });

  it("compares patch when major and minor are equal", () => {
    const left = parseVersionString("2.3.7")!;
    const right = parseVersionString("2.3.4")!;
    expect(compareVersions(left, right)).toBeGreaterThan(0);
  });

  it("returns negative when left has lesser patch", () => {
    const left = parseVersionString("2.3.1")!;
    const right = parseVersionString("2.3.4")!;
    expect(compareVersions(left, right)).toBeLessThan(0);
  });
});

// ── Store tests (SolidJS reactive runtime) ──

describe("referenceStore", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    installStorage();
  });

  describe("toggleStarred", () => {
    it("adds a name when not present", async () => {
      const { referenceStore, toggleStarred } = await loadReferenceStore({ starred: [] });

      toggleStarred("sin");
      expect(referenceStore.starred.has("sin")).toBe(true);
    });

    it("removes a name when already present", async () => {
      const { referenceStore, toggleStarred } = await loadReferenceStore({ starred: ["sin"] });

      toggleStarred("sin");
      expect(referenceStore.starred.has("sin")).toBe(false);
    });

    it("handles multiple toggles correctly", async () => {
      const { referenceStore, toggleStarred } = await loadReferenceStore({ starred: [] });

      toggleStarred("sin");
      toggleStarred("cos");
      expect(referenceStore.starred.has("sin")).toBe(true);
      expect(referenceStore.starred.has("cos")).toBe(true);

      toggleStarred("sin");
      expect(referenceStore.starred.has("sin")).toBe(false);
      expect(referenceStore.starred.has("cos")).toBe(true);
    });
  });

  describe("toggleExpanded", () => {
    it("adds a name when not present", async () => {
      const { referenceStore, toggleExpanded } = await loadReferenceStore({ expanded: [] });

      toggleExpanded("map");
      expect(referenceStore.expanded.has("map")).toBe(true);
    });

    it("removes a name when already present", async () => {
      const { referenceStore, toggleExpanded } = await loadReferenceStore({ expanded: ["map"] });

      toggleExpanded("map");
      expect(referenceStore.expanded.has("map")).toBe(false);
    });
  });

  describe("setTargetVersion", () => {
    it("sets a string version", async () => {
      const { referenceStore, setTargetVersion } = await loadReferenceStore();

      setTargetVersion("1.2.0");
      expect(referenceStore.targetVersion).toBe("1.2.0");
    });

    it("sets version to null", async () => {
      const { referenceStore, setTargetVersion } = await loadReferenceStore({
        targetVersion: "1.2.0",
      });

      setTargetVersion(null);
      expect(referenceStore.targetVersion).toBeNull();
    });
  });

  describe("localStorage persistence", () => {
    it("persists starred functions to localStorage", async () => {
      const { toggleStarred, storage } = await loadReferenceStore({ starred: [] });

      toggleStarred("sin");
      const stored = JSON.parse(storage.getItem("moduLispReference:starredFunctions") || "[]");
      expect(stored).toEqual(["sin"]);
    });

    it("persists expanded functions to localStorage", async () => {
      const { toggleExpanded, storage } = await loadReferenceStore({ expanded: [] });

      toggleExpanded("map");
      const stored = JSON.parse(storage.getItem("moduLispReference:expandedFunctions") || "[]");
      expect(stored).toEqual(["map"]);
    });

    it("persists targetVersion to localStorage when set", async () => {
      const { setTargetVersion, storage } = await loadReferenceStore();

      setTargetVersion("1.3.0");
      expect(storage.getItem("moduLispReference:targetVersion")).toBe("1.3.0");
    });

    it("removes targetVersion from localStorage when set to null", async () => {
      const { setTargetVersion, storage } = await loadReferenceStore({
        targetVersion: "1.2.0",
      });

      setTargetVersion(null);
      expect(storage.getItem("moduLispReference:targetVersion")).toBeNull();
    });
  });

  describe("loadSet error handling", () => {
    it("falls back to empty Set when localStorage has corrupt JSON for starred", async () => {
      const { referenceStore } = await loadReferenceStore({
        starred: "{bad-json",
      });

      expect(referenceStore.starred).toBeInstanceOf(Set);
      expect(Array.from(referenceStore.starred)).toEqual([]);
    });

    it("falls back to empty Set when localStorage has corrupt JSON for expanded", async () => {
      const { referenceStore } = await loadReferenceStore({
        expanded: "not-json-at-all",
      });

      expect(referenceStore.expanded).toBeInstanceOf(Set);
      expect(Array.from(referenceStore.expanded)).toEqual([]);
    });
  });

  describe("initial state from localStorage", () => {
    it("loads default empty state when localStorage is missing", async () => {
      const { referenceStore } = await loadReferenceStore();

      expect(Array.from(referenceStore.starred)).toEqual([]);
      expect(Array.from(referenceStore.expanded)).toEqual([]);
      expect(referenceStore.targetVersion).toBeNull();
      expect(referenceStore.isLoading).toBe(true);
      expect(referenceStore.error).toBeNull();
      expect(referenceStore.data).toEqual([]);
    });

    it("loads starred from localStorage on init", async () => {
      const { referenceStore } = await loadReferenceStore({
        starred: ["sin", "cos"],
      });

      expect(referenceStore.starred.has("sin")).toBe(true);
      expect(referenceStore.starred.has("cos")).toBe(true);
    });

    it("loads expanded from localStorage on init", async () => {
      const { referenceStore } = await loadReferenceStore({
        expanded: ["map", "filter"],
      });

      expect(referenceStore.expanded.has("map")).toBe(true);
      expect(referenceStore.expanded.has("filter")).toBe(true);
    });

    it("loads targetVersion from localStorage on init", async () => {
      const { referenceStore } = await loadReferenceStore({
        targetVersion: "1.5.0",
      });

      expect(referenceStore.targetVersion).toBe("1.5.0");
    });
  });
});
