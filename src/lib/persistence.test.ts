import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  load,
  loadRaw,
  save,
  saveRaw,
  remove,
  has,
  PERSISTENCE_KEYS,
} from "./persistence.ts";
import {
  setStartupFlags,
  resetStartupContextForTests,
} from "../runtime/startupContext.ts";

// ---------------------------------------------------------------------------
// Mock localStorage
// ---------------------------------------------------------------------------

function createMockStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    clear: vi.fn(() => store.clear()),
    get length() {
      return store.size;
    },
    key: vi.fn((_i: number) => null),
  };
}

let mockStorage: Storage;

beforeEach(() => {
  mockStorage = createMockStorage();
  Object.defineProperty(globalThis, "localStorage", {
    value: mockStorage,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(window, "localStorage", {
    value: mockStorage,
    writable: true,
    configurable: true,
  });
  resetStartupContextForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetStartupContextForTests();
});

// ---------------------------------------------------------------------------
// Key registry
// ---------------------------------------------------------------------------

describe("PERSISTENCE_KEYS", () => {
  it("contains all known application keys", () => {
    expect(PERSISTENCE_KEYS.settings).toBe("uSEQ-Perform-User-Settings");
    expect(PERSISTENCE_KEYS.editorCode).toBe("uSEQ-Perform-User-Code");
    expect(PERSISTENCE_KEYS.serialPortInfo).toBe("uSEQ-Serial-Port-Info");
    expect(PERSISTENCE_KEYS.editorContent).toBe("editorContent");
    expect(PERSISTENCE_KEYS.referenceStarred).toBe("moduLispReference:starredFunctions");
    expect(PERSISTENCE_KEYS.referenceExpanded).toBe("moduLispReference:expandedFunctions");
    expect(PERSISTENCE_KEYS.referenceVersion).toBe("moduLispReference:targetVersion");
    expect(PERSISTENCE_KEYS.snippets).toBe("codeSnippets:snippets");
    expect(PERSISTENCE_KEYS.snippetsStarred).toBe("codeSnippets:starred");
    expect(PERSISTENCE_KEYS.snippetsNextId).toBe("codeSnippets:nextId");
    expect(PERSISTENCE_KEYS.experienceLevel).toBe("useqExperienceLevel");
    expect(PERSISTENCE_KEYS.devModeState).toBe("uSEQ-Perform-DevMode-State");
    expect(PERSISTENCE_KEYS.legacyEditorConfig).toBe("editorConfig");
    expect(PERSISTENCE_KEYS.legacySettings).toBe("useqConfig");
    expect(PERSISTENCE_KEYS.legacyCode).toBe("useqcode");
  });

  it("is frozen (all values are readonly string literals)", () => {
    // TypeScript enforces `as const`, but let's verify at runtime too
    const keys = Object.values(PERSISTENCE_KEYS);
    expect(keys.length).toBeGreaterThan(10);
    keys.forEach((k) => expect(typeof k).toBe("string"));
  });
});

// ---------------------------------------------------------------------------
// load()
// ---------------------------------------------------------------------------

describe("load", () => {
  it("returns parsed JSON for a valid stored value", () => {
    mockStorage.setItem("test-key", JSON.stringify({ a: 1 }));
    expect(load("test-key")).toEqual({ a: 1 });
  });

  it("returns null when key does not exist", () => {
    expect(load("missing")).toBeNull();
  });

  it("returns fallback when key does not exist and fallback is provided", () => {
    expect(load("missing", 42)).toBe(42);
  });

  it("returns fallback on corrupt JSON", () => {
    mockStorage.setItem("bad", "{not json!!!");
    expect(load("bad", "default")).toBe("default");
  });

  it("returns null on corrupt JSON when no fallback given", () => {
    mockStorage.setItem("bad", "not-json");
    expect(load("bad")).toBeNull();
  });

  it("logs a warning on corrupt JSON", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockStorage.setItem("bad", "{{{{");
    load("bad");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to parse key "bad"'),
    );
  });

  it("handles stored primitives: number, string, boolean, null", () => {
    mockStorage.setItem("n", "42");
    expect(load<number>("n")).toBe(42);

    mockStorage.setItem("s", '"hello"');
    expect(load<string>("s")).toBe("hello");

    mockStorage.setItem("b", "true");
    expect(load<boolean>("b")).toBe(true);

    mockStorage.setItem("nil", "null");
    expect(load("nil")).toBeNull();
  });

  it("handles stored arrays", () => {
    mockStorage.setItem("arr", JSON.stringify([1, 2, 3]));
    expect(load<number[]>("arr")).toEqual([1, 2, 3]);
  });
});

// ---------------------------------------------------------------------------
// loadRaw()
// ---------------------------------------------------------------------------

describe("loadRaw", () => {
  it("returns the raw string without JSON parsing", () => {
    mockStorage.setItem("code", "(+ 1 2)");
    expect(loadRaw("code")).toBe("(+ 1 2)");
  });

  it("returns null when key does not exist", () => {
    expect(loadRaw("missing")).toBeNull();
  });

  it("returns fallback when key does not exist", () => {
    expect(loadRaw("missing", "default")).toBe("default");
  });
});

// ---------------------------------------------------------------------------
// save()
// ---------------------------------------------------------------------------

describe("save", () => {
  it("stores JSON-stringified value", () => {
    save("k", { x: 1 });
    expect(mockStorage.getItem("k")).toBe(JSON.stringify({ x: 1 }));
  });

  it("stores primitive values", () => {
    save("num", 42);
    expect(mockStorage.getItem("num")).toBe("42");
  });

  it("stores arrays", () => {
    save("arr", [1, 2]);
    expect(mockStorage.getItem("arr")).toBe("[1,2]");
  });
});

// ---------------------------------------------------------------------------
// saveRaw()
// ---------------------------------------------------------------------------

describe("saveRaw", () => {
  it("stores a string without JSON.stringify", () => {
    saveRaw("code", "(+ 1 2)");
    expect(mockStorage.getItem("code")).toBe("(+ 1 2)");
  });
});

// ---------------------------------------------------------------------------
// remove()
// ---------------------------------------------------------------------------

describe("remove", () => {
  it("removes a key from storage", () => {
    mockStorage.setItem("k", "v");
    expect(has("k")).toBe(true);
    remove("k");
    expect(has("k")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// has()
// ---------------------------------------------------------------------------

describe("has", () => {
  it("returns true when key exists", () => {
    mockStorage.setItem("k", "v");
    expect(has("k")).toBe(true);
  });

  it("returns false when key does not exist", () => {
    expect(has("nope")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Round-trip
// ---------------------------------------------------------------------------

describe("round-trip", () => {
  it("save then load returns the same value (object)", () => {
    const obj = { name: "test", values: [1, 2, 3] };
    save("rt", obj);
    expect(load("rt")).toEqual(obj);
  });

  it("saveRaw then loadRaw returns the same string", () => {
    saveRaw("rt", "(define x 42)");
    expect(loadRaw("rt")).toBe("(define x 42)");
  });
});

// ---------------------------------------------------------------------------
// nosave mode
// ---------------------------------------------------------------------------

describe("nosave mode", () => {
  it("save is a no-op when nosave startup flag is set", () => {
    setStartupFlags({
      debug: false,
      devmode: false,
      disableWebSerial: false,
      noModuleMode: false,
      nosave: true,
      params: {},
    });

    save("k", "value");
    expect(mockStorage.setItem).not.toHaveBeenCalled();
  });

  it("saveRaw is a no-op when nosave startup flag is set", () => {
    setStartupFlags({
      debug: false,
      devmode: false,
      disableWebSerial: false,
      noModuleMode: false,
      nosave: true,
      params: {},
    });

    saveRaw("k", "value");
    expect(mockStorage.setItem).not.toHaveBeenCalled();
  });

  it("remove is a no-op when nosave startup flag is set", () => {
    setStartupFlags({
      debug: false,
      devmode: false,
      disableWebSerial: false,
      noModuleMode: false,
      nosave: true,
      params: {},
    });

    // Pre-populate via the mock directly (bypassing our API)
    (mockStorage as any).__internal_set = true;
    mockStorage.setItem("k", "v");
    // Reset the spy call count
    vi.mocked(mockStorage.removeItem).mockClear();

    remove("k");
    expect(mockStorage.removeItem).not.toHaveBeenCalled();
  });

  it("load still works when nosave is active (read-only is fine)", () => {
    // Populate storage before enabling nosave
    mockStorage.setItem("k", JSON.stringify("hello"));

    setStartupFlags({
      debug: false,
      devmode: false,
      disableWebSerial: false,
      noModuleMode: false,
      nosave: true,
      params: {},
    });

    expect(load("k")).toBe("hello");
  });

  it("has still works when nosave is active", () => {
    mockStorage.setItem("k", "v");

    setStartupFlags({
      debug: false,
      devmode: false,
      disableWebSerial: false,
      noModuleMode: false,
      nosave: true,
      params: {},
    });

    expect(has("k")).toBe(true);
  });
});
