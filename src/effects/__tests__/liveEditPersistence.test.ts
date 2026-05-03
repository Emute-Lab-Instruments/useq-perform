/**
 * Tests for liveEditPersistence module.
 * Spec: docs/specs/live-edit.md §7
 */

import {
  beforeEach,
  afterEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import type { LiveEditPersistedData } from "../liveEditPersistence.ts";

// ---------------------------------------------------------------------------
// Mock the persistence service so tests don't hit real localStorage
// ---------------------------------------------------------------------------

const mockStore: Map<string, unknown> = new Map();

vi.mock("../../lib/persistence.ts", () => ({
  PERSISTENCE_KEYS: {
    liveEdits: "uSEQ-Perform-Editor-LiveEdits",
  },
  load: vi.fn((_key: string, fallback: unknown) => {
    const stored = mockStore.get("uSEQ-Perform-Editor-LiveEdits");
    return stored !== undefined ? stored : fallback;
  }),
  save: vi.fn((key: string, value: unknown) => {
    mockStore.set(key, value);
  }),
}));

// Import after vi.mock hoisting completes (top-level await is fine in ESM).
import * as persistenceMock from "../../lib/persistence.ts";
import { createLiveEditPersistence } from "../liveEditPersistence.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getStored(): LiveEditPersistedData | undefined {
  return mockStore.get("uSEQ-Perform-Editor-LiveEdits") as
    | LiveEditPersistedData
    | undefined;
}

function makeSavedData(
  overrides: Partial<LiveEditPersistedData> = {},
): LiveEditPersistedData {
  return {
    values: {},
    orphans: {},
    midiBindings: {},
    panelOrder: { mode: "document" },
    panelDock: "right",
    panelOpen: false,
    schemaVersion: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockStore.clear();
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("load", () => {
  it("returns defaults when no data is stored", () => {
    const p = createLiveEditPersistence();
    const data = p.load();

    expect(data.values).toEqual({});
    expect(data.orphans).toEqual({});
    expect(data.midiBindings).toEqual({});
    expect(data.panelOrder).toEqual({ mode: "document" });
    expect(data.panelDock).toBe("right");
    expect(data.panelOpen).toBe(false);
    expect(data.schemaVersion).toBe(1);

    p.dispose();
  });

  it("returns stored data when present", () => {
    mockStore.set(
      "uSEQ-Perform-Editor-LiveEdits",
      makeSavedData({ values: { abc: 42 }, panelDock: "bottom", panelOpen: true }),
    );

    const p = createLiveEditPersistence();
    const data = p.load();

    expect(data.values).toEqual({ abc: 42 });
    expect(data.panelDock).toBe("bottom");
    expect(data.panelOpen).toBe(true);

    p.dispose();
  });
});

describe("flushValues", () => {
  it("saves all current values immediately", () => {
    const p = createLiveEditPersistence();
    p.flushValues({ a: 1, b: true, c: "hello" });

    const stored = getStored();
    expect(stored?.values).toEqual({ a: 1, b: true, c: "hello" });

    p.dispose();
  });

  it("round-trips values correctly", () => {
    const p = createLiveEditPersistence();
    p.flushValues({ x: 3.14, y: false, z: "keyword" });

    // Create a fresh instance to simulate reload
    const p2 = createLiveEditPersistence();
    const data = p2.load();

    expect(data.values.x).toBeCloseTo(3.14);
    expect(data.values.y).toBe(false);
    expect(data.values.z).toBe("keyword");

    p.dispose();
    p2.dispose();
  });
});

describe("saveValue (debounced)", () => {
  it("does not save immediately", () => {
    const saveMock = vi.mocked(persistenceMock.save);
    saveMock.mockClear();

    const p = createLiveEditPersistence();
    p.saveValue("a", 10);

    expect(saveMock).not.toHaveBeenCalled();

    p.dispose();
  });

  it("saves after the 200ms debounce window", () => {
    const p = createLiveEditPersistence();
    p.saveValue("a", 10);

    vi.advanceTimersByTime(200);

    const stored = getStored();
    expect(stored?.values?.a).toBe(10);

    p.dispose();
  });

  it("coalesces multiple calls within 200ms into one save", () => {
    const saveMock = vi.mocked(persistenceMock.save);
    saveMock.mockClear();

    const p = createLiveEditPersistence();
    p.saveValue("a", 1);
    p.saveValue("a", 2);
    p.saveValue("a", 3);

    vi.advanceTimersByTime(200);

    // Only one call to save
    expect(saveMock).toHaveBeenCalledTimes(1);
    const stored = getStored();
    expect(stored?.values?.a).toBe(3);

    p.dispose();
  });

  it("flushValues cancels a pending debounced save", () => {
    const saveMock = vi.mocked(persistenceMock.save);
    saveMock.mockClear();

    const p = createLiveEditPersistence();
    p.saveValue("a", 99);
    p.flushValues({ a: 100 });

    // Timer fires but no additional save should happen
    vi.advanceTimersByTime(200);

    expect(saveMock).toHaveBeenCalledTimes(1);
    const stored = getStored();
    expect(stored?.values?.a).toBe(100);

    p.dispose();
  });
});

describe("saveBinding / removeBinding", () => {
  it("saves a MIDI binding immediately", () => {
    const p = createLiveEditPersistence();
    p.saveBinding("slot1", { kind: "cc", channel: 1, controller: 7 });

    const stored = getStored();
    expect(stored?.midiBindings?.slot1).toEqual({
      kind: "cc",
      channel: 1,
      controller: 7,
    });

    p.dispose();
  });

  it("removes a MIDI binding immediately", () => {
    mockStore.set(
      "uSEQ-Perform-Editor-LiveEdits",
      makeSavedData({
        midiBindings: { slot1: { kind: "cc", channel: 1, controller: 7 } },
      }),
    );

    const p = createLiveEditPersistence();
    p.removeBinding("slot1");

    const stored = getStored();
    expect(stored?.midiBindings?.slot1).toBeUndefined();

    p.dispose();
  });
});

describe("savePanelState", () => {
  it("saves dock position immediately", () => {
    const p = createLiveEditPersistence();
    p.savePanelState({ dock: "bottom" });

    expect(getStored()?.panelDock).toBe("bottom");
    p.dispose();
  });

  it("saves open state immediately", () => {
    const p = createLiveEditPersistence();
    p.savePanelState({ open: true });

    expect(getStored()?.panelOpen).toBe(true);
    p.dispose();
  });

  it("saves custom panel order", () => {
    const p = createLiveEditPersistence();
    p.savePanelState({ order: { mode: "custom", custom: ["id2", "id1"] } });

    const stored = getStored();
    expect(stored?.panelOrder.mode).toBe("custom");
    expect(stored?.panelOrder.custom).toEqual({ default: ["id2", "id1"] });
    p.dispose();
  });

  it("saves document panel order", () => {
    const p = createLiveEditPersistence();
    p.savePanelState({ order: { mode: "document" } });

    const stored = getStored();
    expect(stored?.panelOrder.mode).toBe("document");
    expect(stored?.panelOrder.custom).toBeUndefined();
    p.dispose();
  });
});

describe("reconcile", () => {
  it("retains values for IDs present in the document", () => {
    mockStore.set(
      "uSEQ-Perform-Editor-LiveEdits",
      makeSavedData({ values: { id1: 42, id2: true } }),
    );

    const p = createLiveEditPersistence();
    const result = p.reconcile(new Set(["id1", "id2"]));

    expect(result.values).toEqual({ id1: 42, id2: true });
    expect(result.orphans).toEqual({});
    p.dispose();
  });

  it("does not create entries for IDs in doc but absent from values", () => {
    mockStore.set("uSEQ-Perform-Editor-LiveEdits", makeSavedData());

    const p = createLiveEditPersistence();
    const result = p.reconcile(new Set(["id1"]));

    expect(result.values).toEqual({});
    expect(result.orphans).toEqual({});
    p.dispose();
  });

  it("moves IDs in values but not in doc to orphans", () => {
    mockStore.set(
      "uSEQ-Perform-Editor-LiveEdits",
      makeSavedData({ values: { id1: 10, id2: 20 } }),
    );

    const p = createLiveEditPersistence();
    const result = p.reconcile(new Set(["id1"]));

    expect(result.values).toEqual({ id1: 10 });
    expect(result.orphans.id2).toBeDefined();
    expect(result.orphans.id2.value).toBe(20);
    expect(typeof result.orphans.id2.orphanedAt).toBe("number");
    p.dispose();
  });

  it("restores orphan IDs that reappear in the document", () => {
    const orphanedAt = Date.now() - 1000; // 1 second ago, well within GC
    mockStore.set(
      "uSEQ-Perform-Editor-LiveEdits",
      makeSavedData({ orphans: { id1: { value: 99, orphanedAt } } }),
    );

    const p = createLiveEditPersistence();
    const result = p.reconcile(new Set(["id1"]));

    expect(result.values.id1).toBe(99);
    expect(result.orphans.id1).toBeUndefined();
    p.dispose();
  });

  it("GC-deletes orphans older than the threshold", () => {
    const orphanGcHours = 24;
    const tooOld = Date.now() - orphanGcHours * 60 * 60 * 1000 - 1;
    mockStore.set(
      "uSEQ-Perform-Editor-LiveEdits",
      makeSavedData({
        orphans: { id1: { value: 5, orphanedAt: tooOld } },
        midiBindings: { id1: { kind: "cc", channel: 1, controller: 7 } },
      }),
    );

    const p = createLiveEditPersistence();
    const result = p.reconcile(new Set(), orphanGcHours);

    expect(result.orphans.id1).toBeUndefined();
    // MIDI binding for the GC'd orphan should also be removed
    expect(result.midiBindings.id1).toBeUndefined();
    p.dispose();
  });

  it("does not GC orphans within the threshold", () => {
    const orphanGcHours = 24;
    const recent = Date.now() - 1000; // 1 second old
    mockStore.set(
      "uSEQ-Perform-Editor-LiveEdits",
      makeSavedData({ orphans: { id1: { value: 5, orphanedAt: recent } } }),
    );

    const p = createLiveEditPersistence();
    const result = p.reconcile(new Set(), orphanGcHours);

    expect(result.orphans.id1).toBeDefined();
    p.dispose();
  });

  it("persists the reconciled result", () => {
    const saveMock = vi.mocked(persistenceMock.save);
    saveMock.mockClear();

    mockStore.set(
      "uSEQ-Perform-Editor-LiveEdits",
      makeSavedData({ values: { id1: 1, id2: 2 } }),
    );

    const p = createLiveEditPersistence();
    p.reconcile(new Set(["id1"]));

    expect(saveMock).toHaveBeenCalledTimes(1);
    const stored = getStored();
    expect(stored?.values).toEqual({ id1: 1 });
    expect(stored?.orphans.id2).toBeDefined();
    p.dispose();
  });

  it("MIDI binding GC follows orphan GC at custom threshold", () => {
    const orphanGcHours = 1;
    const tooOld = Date.now() - orphanGcHours * 60 * 60 * 1000 - 1;
    mockStore.set(
      "uSEQ-Perform-Editor-LiveEdits",
      makeSavedData({
        orphans: { old1: { value: 7, orphanedAt: tooOld } },
        midiBindings: {
          old1: { kind: "note", channel: "any", note: 60, mode: "toggle" },
        },
      }),
    );

    const p = createLiveEditPersistence();
    const result = p.reconcile(new Set(), orphanGcHours);

    expect(result.orphans.old1).toBeUndefined();
    expect(result.midiBindings.old1).toBeUndefined();
    p.dispose();
  });
});
