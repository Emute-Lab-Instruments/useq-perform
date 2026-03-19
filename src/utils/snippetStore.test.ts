import { beforeEach, describe, expect, it, vi } from "vitest";

type SeedState = {
  snippets?: unknown;
  starred?: unknown;
  nextId?: string | null;
};

type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  clear: () => void;
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

  if (seed.snippets !== undefined) {
    initial["codeSnippets:snippets"] =
      typeof seed.snippets === "string" ? seed.snippets : JSON.stringify(seed.snippets);
  }

  if (seed.starred !== undefined) {
    initial["codeSnippets:starred"] =
      typeof seed.starred === "string" ? seed.starred : JSON.stringify(seed.starred);
  }

  if (seed.nextId !== undefined && seed.nextId !== null) {
    initial["codeSnippets:nextId"] = seed.nextId;
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

async function loadSnippetStore(seed: SeedState = {}) {
  vi.resetModules();
  const storage = installStorage(seed);
  const module = await import("./snippetStore");
  return { ...module, storage };
}

describe("snippetStore", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    installStorage();
  });

  it("addSnippet creates snippets with incrementing IDs and timestamp", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1700000000000);
    const { snippetStore, addSnippet } = await loadSnippetStore({ nextId: "7" });

    addSnippet({ title: "A", code: "(+ 1 2)", tags: ["math"] });
    addSnippet({ title: "B", code: "(* 2 3)", tags: ["math"] });

    expect(snippetStore.snippets).toHaveLength(2);
    expect(snippetStore.snippets[0]).toMatchObject({
      id: 7,
      title: "A",
      code: "(+ 1 2)",
      tags: ["math"],
      createdAt: 1700000000000,
    });
    expect(snippetStore.snippets[1].id).toBe(8);
    expect(snippetStore.nextId).toBe(9);

    nowSpy.mockRestore();
  });

  it("updateSnippet updates only mutable fields", async () => {
    const { snippetStore, updateSnippet } = await loadSnippetStore({
      snippets: [
        {
          id: 1,
          title: "Before",
          code: "(old)",
          tags: ["legacy"],
          createdAt: 111,
        },
      ],
      starred: [1],
      nextId: "2",
    });

    updateSnippet(1, {
      title: "After",
      code: "(new)",
      tags: ["updated"],
    });

    expect(snippetStore.snippets[0]).toEqual({
      id: 1,
      title: "After",
      code: "(new)",
      tags: ["updated"],
      createdAt: 111,
    });
  });

  it("deleteSnippet removes snippet and unstars it", async () => {
    const { snippetStore, deleteSnippet } = await loadSnippetStore({
      snippets: [
        { id: 1, title: "One", code: "1", tags: [], createdAt: 1 },
        { id: 2, title: "Two", code: "2", tags: [], createdAt: 2 },
      ],
      starred: [1, 2],
      nextId: "3",
    });

    deleteSnippet(1);

    expect(snippetStore.snippets).toHaveLength(1);
    expect(snippetStore.snippets[0].id).toBe(2);
    expect(snippetStore.starred.has(1)).toBe(false);
    expect(snippetStore.starred.has(2)).toBe(true);
  });

  it("toggleStar adds and removes ids", async () => {
    const { snippetStore, toggleStar } = await loadSnippetStore({ starred: [] });

    toggleStar(42);
    expect(snippetStore.starred.has(42)).toBe(true);

    toggleStar(42);
    expect(snippetStore.starred.has(42)).toBe(false);
  });

  it("persists snippets, starred ids, and nextId to localStorage", async () => {
    const { addSnippet, toggleStar, storage } = await loadSnippetStore();
    addSnippet({ title: "Persist me", code: "(ok)", tags: ["persist"] });
    toggleStar(1);

    expect(JSON.parse(storage.getItem("codeSnippets:snippets") || "[]")).toHaveLength(1);
    expect(JSON.parse(storage.getItem("codeSnippets:starred") || "[]")).toEqual([1]);
    expect(storage.getItem("codeSnippets:nextId")).toBe("2");
  });

  it("loads default state when localStorage is missing", async () => {
    const { snippetStore } = await loadSnippetStore();

    expect(snippetStore.snippets).toEqual([]);
    expect(Array.from(snippetStore.starred)).toEqual([]);
    expect(snippetStore.nextId).toBe(1);
  });

  it("falls back safely when localStorage is corrupt", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { snippetStore } = await loadSnippetStore({
      snippets: "{bad-json",
      starred: "not-json",
      nextId: "nan",
    });

    expect(snippetStore.snippets).toEqual([]);
    expect(Array.from(snippetStore.starred)).toEqual([]);
    expect(snippetStore.nextId).toBe(1);
    expect(warnSpy).toHaveBeenCalled();
  });
});
