import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SERIAL_VIS_PALETTE_CHANGED_EVENT,
  VISUALISATION_SESSION_EVENT,
  dispatchVisualisationEvent,
} from "../contracts/visualisationEvents";

/**
 * Dynamically import a fresh visualisationStore module.
 * vi.resetModules() ensures we get fresh module-level state (a new
 * createStore call) on each load, which is critical because the store
 * is created at the module top-level.
 */
async function loadVisStore() {
  vi.resetModules();
  const module = await import("./visualisationStore");
  return module;
}

describe("visualisationStore", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  // -----------------------------------------------------------------------
  // Default initial state
  // -----------------------------------------------------------------------
  describe("default initial state", () => {
    it("starts with expected default values", async () => {
      const { visStore } = await loadVisStore();

      expect(visStore.currentTime).toBe(0);
      expect(visStore.displayTime).toBe(0);
      expect(visStore.bar).toBe(0);
      expect(visStore.lastChangeKind).toBe("");
      expect(visStore.expressions).toEqual({});
      expect(visStore.serialBuffers).toEqual({ channels: [], lengths: [] });
      expect(visStore.palette).toEqual([]);
    });

    it("starts with DEFAULT_SETTINGS values", async () => {
      const { visStore } = await loadVisStore();

      expect(visStore.settings).toEqual({
        windowDuration: 10,
        sampleCount: 100,
        lineWidth: 1.5,
        futureDashed: true,
        futureMaskOpacity: 0.35,
        futureMaskWidth: 12,
        circularOffset: 0,
        futureLeadSeconds: 1,
        digitalLaneGap: 4,
      });
    });
  });

  // -----------------------------------------------------------------------
  // applyVisualisationEvent
  // -----------------------------------------------------------------------
  describe("applyVisualisationEvent", () => {
    it("sets currentTime from currentTimeSeconds", async () => {
      const { visStore, applyVisualisationEvent } = await loadVisStore();

      applyVisualisationEvent({ currentTimeSeconds: 42.5 });
      expect(visStore.currentTime).toBe(42.5);
    });

    it("sets displayTime from displayTimeSeconds", async () => {
      const { visStore, applyVisualisationEvent } = await loadVisStore();

      applyVisualisationEvent({ displayTimeSeconds: 99.1 });
      expect(visStore.displayTime).toBe(99.1);
    });

    it("sets bar value", async () => {
      const { visStore, applyVisualisationEvent } = await loadVisStore();

      applyVisualisationEvent({ bar: 0.75 });
      expect(visStore.bar).toBe(0.75);
    });

    it("sets lastChangeKind from kind", async () => {
      const { visStore, applyVisualisationEvent } = await loadVisStore();

      applyVisualisationEvent({ kind: "data" });
      expect(visStore.lastChangeKind).toBe("data");
    });

    it("defaults lastChangeKind to empty string when kind is undefined", async () => {
      const { visStore, applyVisualisationEvent } = await loadVisStore();

      // First set it to something
      applyVisualisationEvent({ kind: "data" });
      expect(visStore.lastChangeKind).toBe("data");

      // Now apply without kind
      applyVisualisationEvent({});
      expect(visStore.lastChangeKind).toBe("");
    });

    it("accepts serializable expression records", async () => {
      const { visStore, applyVisualisationEvent } = await loadVisStore();

      const expressions = {
        a1: {
          exprType: "a1",
          expressionText: "(sin t)",
          samples: [{ time: 0, value: 1 }],
          color: "#ff0000",
        },
        d1: {
          exprType: "d1",
          expressionText: "(> t 0.5)",
          samples: [{ time: 0, value: 0 }],
          color: null,
        },
      };

      applyVisualisationEvent({ expressions });

      expect(visStore.expressions).toEqual({
        a1: {
          exprType: "a1",
          expressionText: "(sin t)",
          samples: [{ time: 0, value: 1 }],
          color: "#ff0000",
        },
        d1: {
          exprType: "d1",
          expressionText: "(> t 0.5)",
          samples: [{ time: 0, value: 0 }],
          color: null,
        },
      });
    });

    it("handles expression entries with missing optional fields", async () => {
      const { visStore, applyVisualisationEvent } = await loadVisStore();

      const expressions = {
        a1: {
        exprType: "a1",
        // expressionText missing -> defaults to ""
        // samples missing -> defaults to []
        // color missing -> defaults to null
        },
      };

      applyVisualisationEvent({ expressions });

      expect(visStore.expressions.a1).toEqual({
        exprType: "a1",
        expressionText: "",
        samples: [],
        color: null,
      });
    });

    it("handles empty expression records", async () => {
      const { visStore, applyVisualisationEvent } = await loadVisStore();

      applyVisualisationEvent({ expressions: {} });
      expect(visStore.expressions).toEqual({});
    });

    it("handles missing expressions (does not crash)", async () => {
      const { visStore, applyVisualisationEvent } = await loadVisStore();

      // First set some expressions
      const expressions = {
        a1: {
          exprType: "a1",
          expressionText: "(sin t)",
          samples: [],
          color: null,
        },
      };
      applyVisualisationEvent({ expressions });
      expect(Object.keys(visStore.expressions)).toHaveLength(1);

      // Apply event without expressions field - should clear expressions
      // because reconcile is called with the empty expressionsRecord
      applyVisualisationEvent({});
      expect(visStore.expressions).toEqual({});
    });

    it("updates settings when detail.settings is provided (merges with defaults)", async () => {
      const { visStore, applyVisualisationEvent } = await loadVisStore();

      applyVisualisationEvent({
        settings: { windowDuration: 20, lineWidth: 3 },
      });

      // Provided values should be applied
      expect(visStore.settings.windowDuration).toBe(20);
      expect(visStore.settings.lineWidth).toBe(3);
      // Other defaults should still be present
      expect(visStore.settings.sampleCount).toBe(100);
      expect(visStore.settings.futureDashed).toBe(true);
      expect(visStore.settings.futureMaskOpacity).toBe(0.35);
    });

    it("does not change settings when detail.settings is undefined", async () => {
      const { visStore, applyVisualisationEvent } = await loadVisStore();

      const settingsBefore = { ...visStore.settings };
      applyVisualisationEvent({ currentTimeSeconds: 10 });
      expect(visStore.settings).toEqual(settingsBefore);
    });

    it("falls back to existing values when fields are undefined", async () => {
      const { visStore, applyVisualisationEvent } = await loadVisStore();

      // Set initial values
      applyVisualisationEvent({
        currentTimeSeconds: 5.0,
        displayTimeSeconds: 6.0,
        bar: 0.5,
      });

      // Apply partial update
      applyVisualisationEvent({ currentTimeSeconds: 10.0 });

      expect(visStore.currentTime).toBe(10.0);
      expect(visStore.displayTime).toBe(6.0);
      expect(visStore.bar).toBe(0.5);
    });

    it("applies all fields together in a single call", async () => {
      const { visStore, applyVisualisationEvent } = await loadVisStore();

      const expressions = {
        a1: {
          exprType: "a1",
          expressionText: "(sin t)",
          samples: [{ time: 0, value: 0.5 }],
          color: "#00ff00",
        },
      };

      applyVisualisationEvent({
        kind: "register",
        currentTimeSeconds: 1.5,
        displayTimeSeconds: 2.5,
        bar: 0.25,
        settings: { sampleCount: 200 },
        expressions,
      });

      expect(visStore.currentTime).toBe(1.5);
      expect(visStore.displayTime).toBe(2.5);
      expect(visStore.bar).toBe(0.25);
      expect(visStore.lastChangeKind).toBe("register");
      expect(visStore.settings.sampleCount).toBe(200);
      expect(visStore.expressions.a1.expressionText).toBe("(sin t)");
    });
  });

  // -----------------------------------------------------------------------
  // snapshotSerialBuffers
  // -----------------------------------------------------------------------
  describe("snapshotSerialBuffers", () => {
    function createMockBuffer(values: number[]) {
      return {
        length: values.length,
        oldest: (i: number) => values[i],
        capacity: values.length + 10,
      };
    }

    it("converts buffer objects to plain arrays", async () => {
      const { visStore, snapshotSerialBuffers } = await loadVisStore();

      const buf1 = createMockBuffer([1.0, 2.0, 3.0]);
      const buf2 = createMockBuffer([4.0, 5.0]);

      snapshotSerialBuffers([buf1, buf2]);

      expect(visStore.serialBuffers.channels).toEqual([
        [1.0, 2.0, 3.0],
        [4.0, 5.0],
      ]);
    });

    it("sets lengths correctly", async () => {
      const { visStore, snapshotSerialBuffers } = await loadVisStore();

      const buf1 = createMockBuffer([1.0, 2.0, 3.0]);
      const buf2 = createMockBuffer([4.0, 5.0]);

      snapshotSerialBuffers([buf1, buf2]);

      expect(visStore.serialBuffers.lengths).toEqual([3, 2]);
    });

    it("handles empty buffer array", async () => {
      const { visStore, snapshotSerialBuffers } = await loadVisStore();

      snapshotSerialBuffers([]);

      expect(visStore.serialBuffers.channels).toEqual([]);
      expect(visStore.serialBuffers.lengths).toEqual([]);
    });

    it("handles buffers with zero length", async () => {
      const { visStore, snapshotSerialBuffers } = await loadVisStore();

      const emptyBuf = createMockBuffer([]);
      snapshotSerialBuffers([emptyBuf]);

      expect(visStore.serialBuffers.channels).toEqual([[]]);
      expect(visStore.serialBuffers.lengths).toEqual([0]);
    });

    it("reads values using oldest() in order", async () => {
      const { visStore, snapshotSerialBuffers } = await loadVisStore();

      const oldestSpy = vi.fn((i: number) => [10, 20, 30][i]);
      const buf = { length: 3, oldest: oldestSpy, capacity: 10 };

      snapshotSerialBuffers([buf]);

      expect(oldestSpy).toHaveBeenCalledTimes(3);
      expect(oldestSpy).toHaveBeenCalledWith(0);
      expect(oldestSpy).toHaveBeenCalledWith(1);
      expect(oldestSpy).toHaveBeenCalledWith(2);
      expect(visStore.serialBuffers.channels[0]).toEqual([10, 20, 30]);
    });
  });

  // -----------------------------------------------------------------------
  // setVisPalette
  // -----------------------------------------------------------------------
  describe("setVisPalette", () => {
    it("sets palette array correctly", async () => {
      const { visStore, setVisPalette } = await loadVisStore();

      setVisPalette(["#ff0000", "#00ff00", "#0000ff"]);
      expect(visStore.palette).toEqual(["#ff0000", "#00ff00", "#0000ff"]);
    });

    it("makes a copy (does not reference the original array)", async () => {
      const { visStore, setVisPalette } = await loadVisStore();

      const original = ["#ff0000", "#00ff00"];
      setVisPalette(original);

      // Mutate the original
      original.push("#0000ff");

      // Store should still have the original two values
      expect(visStore.palette).toEqual(["#ff0000", "#00ff00"]);
      expect(visStore.palette).toHaveLength(2);
    });

    it("can replace an existing palette", async () => {
      const { visStore, setVisPalette } = await loadVisStore();

      setVisPalette(["#aaa"]);
      expect(visStore.palette).toEqual(["#aaa"]);

      setVisPalette(["#bbb", "#ccc"]);
      expect(visStore.palette).toEqual(["#bbb", "#ccc"]);
    });

    it("can set an empty palette", async () => {
      const { visStore, setVisPalette } = await loadVisStore();

      setVisPalette(["#aaa"]);
      setVisPalette([]);
      expect(visStore.palette).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // Window event bridge
  // -----------------------------------------------------------------------
  describe("window event bridge", () => {
    it("visualisation session events trigger applyVisualisationEvent", async () => {
      const { visStore } = await loadVisStore();

      const expressions = {
        a2: {
          exprType: "a2",
          expressionText: "(cos t)",
          samples: [],
          color: "#123456",
        },
      };

      dispatchVisualisationEvent(VISUALISATION_SESSION_EVENT, {
        kind: "time",
        currentTimeSeconds: 33.3,
        displayTimeSeconds: 34.4,
        bar: 0.6,
        expressions,
      });

      expect(visStore.currentTime).toBe(33.3);
      expect(visStore.displayTime).toBe(34.4);
      expect(visStore.bar).toBe(0.6);
      expect(visStore.lastChangeKind).toBe("time");
      expect(visStore.expressions.a2).toEqual({
        exprType: "a2",
        expressionText: "(cos t)",
        samples: [],
        color: "#123456",
      });
    });

    it("palette events trigger setVisPalette", async () => {
      const { visStore } = await loadVisStore();

      dispatchVisualisationEvent(SERIAL_VIS_PALETTE_CHANGED_EVENT, {
        palette: ["#aaa", "#bbb"],
      });

      expect(visStore.palette).toEqual(["#aaa", "#bbb"]);
    });

    it("palette event validates Array.isArray(event.detail?.palette)", async () => {
      const { visStore } = await loadVisStore();

      // Non-array palette should be ignored
      window.dispatchEvent(
        new CustomEvent(SERIAL_VIS_PALETTE_CHANGED_EVENT, {
          detail: { palette: "not-an-array" },
        }),
      );
      expect(visStore.palette).toEqual([]);

      // Missing palette field should be ignored
      window.dispatchEvent(
        new CustomEvent(SERIAL_VIS_PALETTE_CHANGED_EVENT, {
          detail: {},
        }),
      );
      expect(visStore.palette).toEqual([]);

      // Null detail should be ignored (no crash)
      window.dispatchEvent(
        new CustomEvent(SERIAL_VIS_PALETTE_CHANGED_EVENT, {
          detail: null,
        }),
      );
      expect(visStore.palette).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // Partial updates
  // -----------------------------------------------------------------------
  describe("partial updates", () => {
    it("applying event with only some fields preserves others", async () => {
      const { visStore, applyVisualisationEvent } = await loadVisStore();

      // Set initial state
      const expressions = {
        a1: {
          exprType: "a1",
          expressionText: "(sin t)",
          samples: [{ time: 0, value: 1 }],
          color: "#ff0000",
        },
      };

      applyVisualisationEvent({
        kind: "register",
        currentTimeSeconds: 10,
        displayTimeSeconds: 11,
        bar: 0.8,
        settings: { windowDuration: 20 },
        expressions,
      });

      // Now apply partial update (only currentTimeSeconds and kind)
      applyVisualisationEvent({
        kind: "time",
        currentTimeSeconds: 15,
      });

      // Updated fields
      expect(visStore.currentTime).toBe(15);
      expect(visStore.lastChangeKind).toBe("time");

      // Preserved fields
      expect(visStore.displayTime).toBe(11);
      expect(visStore.bar).toBe(0.8);
      expect(visStore.settings.windowDuration).toBe(20);

      // Expressions are reconciled with empty record when not provided
      // This is the expected behavior based on the implementation
      expect(visStore.expressions).toEqual({});
    });

    it("settings partial update preserves unspecified settings fields", async () => {
      const { visStore, applyVisualisationEvent } = await loadVisStore();

      applyVisualisationEvent({
        settings: { windowDuration: 30, lineWidth: 5 },
      });
      expect(visStore.settings.windowDuration).toBe(30);
      expect(visStore.settings.lineWidth).toBe(5);

      // Second settings update - merges with defaults, not previous values
      applyVisualisationEvent({
        settings: { windowDuration: 40 },
      });
      expect(visStore.settings.windowDuration).toBe(40);
      // lineWidth reverts to default because settings merges with DEFAULT_SETTINGS
      expect(visStore.settings.lineWidth).toBe(1.5);
    });
  });

  // -----------------------------------------------------------------------
  // High-frequency ingestion
  // -----------------------------------------------------------------------
  describe("high-frequency ingestion", () => {
    it("handles rapid sequential event application without data corruption", async () => {
      const { visStore, applyVisualisationEvent } = await loadVisStore();

      // Simulate 100 rapid data-tick events (typical during live performance)
      for (let i = 0; i < 100; i++) {
        applyVisualisationEvent({
          kind: "data",
          currentTimeSeconds: i * 0.01,
          displayTimeSeconds: i * 0.01 + 0.001,
          bar: (i % 100) / 100,
          expressions: {
            a1: {
              exprType: "a1",
              expressionText: "(sin t)",
              samples: [{ time: i * 0.01, value: Math.sin(i * 0.01) }],
              color: "#ff0000",
            },
          },
        });
      }

      // Final state should reflect last event, not a blend
      expect(visStore.currentTime).toBeCloseTo(0.99);
      expect(visStore.displayTime).toBeCloseTo(0.991);
      expect(visStore.lastChangeKind).toBe("data");
      expect(visStore.expressions.a1.samples).toHaveLength(1);
      expect(visStore.expressions.a1.samples[0].time).toBeCloseTo(0.99);
    });

    it("expressions are fully replaced on each event (no stale keys accumulate)", async () => {
      const { visStore, applyVisualisationEvent } = await loadVisStore();

      // First event registers a1 and a2
      applyVisualisationEvent({
        expressions: {
          a1: { exprType: "a1", expressionText: "(sin t)", samples: [], color: "#f00" },
          a2: { exprType: "a2", expressionText: "(cos t)", samples: [], color: "#0f0" },
        },
      });
      expect(Object.keys(visStore.expressions)).toEqual(["a1", "a2"]);

      // Second event only has a1 — a2 must be gone
      applyVisualisationEvent({
        expressions: {
          a1: { exprType: "a1", expressionText: "(sin t)", samples: [], color: "#f00" },
        },
      });
      expect(Object.keys(visStore.expressions)).toEqual(["a1"]);
      expect(visStore.expressions.a2).toBeUndefined();

      // Third event adds d1, removes a1
      applyVisualisationEvent({
        expressions: {
          d1: { exprType: "d1", expressionText: "(> t 0)", samples: [], color: "#00f" },
        },
      });
      expect(Object.keys(visStore.expressions)).toEqual(["d1"]);
      expect(visStore.expressions.a1).toBeUndefined();
    });

    it("expression samples array is replaced, not appended", async () => {
      const { visStore, applyVisualisationEvent } = await loadVisStore();

      applyVisualisationEvent({
        expressions: {
          a1: {
            exprType: "a1",
            expressionText: "(sin t)",
            samples: [{ time: 0, value: 0 }, { time: 1, value: 1 }],
            color: null,
          },
        },
      });
      expect(visStore.expressions.a1.samples).toHaveLength(2);

      // New event with different samples
      applyVisualisationEvent({
        expressions: {
          a1: {
            exprType: "a1",
            expressionText: "(sin t)",
            samples: [{ time: 2, value: 0.5 }],
            color: null,
          },
        },
      });
      expect(visStore.expressions.a1.samples).toHaveLength(1);
      expect(visStore.expressions.a1.samples[0]).toEqual({ time: 2, value: 0.5 });
    });
  });

  // -----------------------------------------------------------------------
  // snapshotSerialBuffers — consistency and edge cases
  // -----------------------------------------------------------------------
  describe("snapshotSerialBuffers consistency", () => {
    function createMockBuffer(values: number[]) {
      return {
        length: values.length,
        oldest: (i: number) => values[i],
        capacity: values.length + 10,
      };
    }

    it("handles 9 channels (matching real hardware buffer count)", async () => {
      const { visStore, snapshotSerialBuffers } = await loadVisStore();

      const buffers = Array.from({ length: 9 }, (_, ch) =>
        createMockBuffer(Array.from({ length: 50 }, (_, i) => ch * 100 + i))
      );

      snapshotSerialBuffers(buffers);

      expect(visStore.serialBuffers.channels).toHaveLength(9);
      expect(visStore.serialBuffers.lengths).toHaveLength(9);
      // Spot-check: channel 0 first value, channel 8 last value
      expect(visStore.serialBuffers.channels[0][0]).toBe(0);
      expect(visStore.serialBuffers.channels[8][49]).toBe(849);
    });

    it("re-snapshot reflects buffer content changes (simulating circular buffer wrap)", async () => {
      const { visStore, snapshotSerialBuffers } = await loadVisStore();

      // First snapshot: buffer has [1, 2, 3]
      const values = [1, 2, 3];
      const buf = {
        get length() { return values.length; },
        oldest: (i: number) => values[i],
        capacity: 10,
      };

      snapshotSerialBuffers([buf]);
      expect(visStore.serialBuffers.channels[0]).toEqual([1, 2, 3]);

      // Simulate wrap: oldest value dropped, new value added
      values.shift();
      values.push(4);

      snapshotSerialBuffers([buf]);
      expect(visStore.serialBuffers.channels[0]).toEqual([2, 3, 4]);
    });

    it("previous snapshot data is independent from subsequent snapshots", async () => {
      const { visStore, snapshotSerialBuffers } = await loadVisStore();

      snapshotSerialBuffers([createMockBuffer([10, 20, 30])]);
      // Grab a reference to the current channels array
      const firstChannels = visStore.serialBuffers.channels[0];

      snapshotSerialBuffers([createMockBuffer([40, 50])]);

      // After reconcile, the store should reflect the new data
      expect(visStore.serialBuffers.channels[0]).toEqual([40, 50]);
      expect(visStore.serialBuffers.lengths[0]).toBe(2);
    });

    it("handles buffers with varying lengths across channels", async () => {
      const { visStore, snapshotSerialBuffers } = await loadVisStore();

      snapshotSerialBuffers([
        createMockBuffer([1, 2, 3, 4, 5]),  // 5 samples
        createMockBuffer([10]),               // 1 sample
        createMockBuffer([]),                 // 0 samples
        createMockBuffer([100, 200]),         // 2 samples
      ]);

      expect(visStore.serialBuffers.lengths).toEqual([5, 1, 0, 2]);
      expect(visStore.serialBuffers.channels[0]).toEqual([1, 2, 3, 4, 5]);
      expect(visStore.serialBuffers.channels[1]).toEqual([10]);
      expect(visStore.serialBuffers.channels[2]).toEqual([]);
      expect(visStore.serialBuffers.channels[3]).toEqual([100, 200]);
    });

    it("channel count can change between snapshots", async () => {
      const { visStore, snapshotSerialBuffers } = await loadVisStore();

      // Start with 2 channels
      snapshotSerialBuffers([
        createMockBuffer([1]),
        createMockBuffer([2]),
      ]);
      expect(visStore.serialBuffers.channels).toHaveLength(2);

      // Now snapshot with 4 channels
      snapshotSerialBuffers([
        createMockBuffer([10]),
        createMockBuffer([20]),
        createMockBuffer([30]),
        createMockBuffer([40]),
      ]);
      expect(visStore.serialBuffers.channels).toHaveLength(4);

      // Back to 1 channel — old channels must be gone
      snapshotSerialBuffers([createMockBuffer([99])]);
      expect(visStore.serialBuffers.channels).toHaveLength(1);
      expect(visStore.serialBuffers.channels[0]).toEqual([99]);
    });
  });

  // -----------------------------------------------------------------------
  // Palette and expression coexistence
  // -----------------------------------------------------------------------
  describe("palette and expression coexistence", () => {
    it("palette and expression colors are independent", async () => {
      const { visStore, applyVisualisationEvent, setVisPalette } = await loadVisStore();

      setVisPalette(["#aaa", "#bbb", "#ccc"]);

      applyVisualisationEvent({
        expressions: {
          a1: { exprType: "a1", expressionText: "(sin t)", samples: [], color: "#ff0000" },
          a2: { exprType: "a2", expressionText: "(cos t)", samples: [], color: null },
        },
      });

      // Both are present and independent
      expect(visStore.palette).toEqual(["#aaa", "#bbb", "#ccc"]);
      expect(visStore.expressions.a1.color).toBe("#ff0000");
      expect(visStore.expressions.a2.color).toBeNull();
    });

    it("clearing expressions does not affect palette", async () => {
      const { visStore, applyVisualisationEvent, setVisPalette } = await loadVisStore();

      setVisPalette(["#111", "#222"]);
      applyVisualisationEvent({
        expressions: {
          a1: { exprType: "a1", expressionText: "(sin t)", samples: [], color: "#f00" },
        },
      });

      // Clear expressions by sending empty
      applyVisualisationEvent({ expressions: {} });

      expect(visStore.expressions).toEqual({});
      expect(visStore.palette).toEqual(["#111", "#222"]);
    });

    it("replacing palette does not affect expression state", async () => {
      const { visStore, applyVisualisationEvent, setVisPalette } = await loadVisStore();

      applyVisualisationEvent({
        kind: "register",
        currentTimeSeconds: 5,
        expressions: {
          a1: { exprType: "a1", expressionText: "(sin t)", samples: [{ time: 0, value: 1 }], color: "#f00" },
        },
      });

      setVisPalette(["#new1", "#new2"]);

      // Expression state unchanged
      expect(visStore.currentTime).toBe(5);
      expect(visStore.expressions.a1.color).toBe("#f00");
      expect(visStore.expressions.a1.samples).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // Expression lifecycle across resets
  // -----------------------------------------------------------------------
  describe("expression lifecycle", () => {
    it("full register → data → clear → re-register cycle", async () => {
      const { visStore, applyVisualisationEvent } = await loadVisStore();

      // Register
      applyVisualisationEvent({
        kind: "register",
        expressions: {
          a1: { exprType: "a1", expressionText: "(sin t)", samples: [], color: "#f00" },
          d1: { exprType: "d1", expressionText: "(> t 0)", samples: [], color: "#0f0" },
        },
      });
      expect(Object.keys(visStore.expressions).sort()).toEqual(["a1", "d1"]);

      // Data updates with new samples
      applyVisualisationEvent({
        kind: "data",
        expressions: {
          a1: {
            exprType: "a1",
            expressionText: "(sin t)",
            samples: [{ time: 1, value: 0.84 }, { time: 2, value: 0.91 }],
            color: "#f00",
          },
          d1: {
            exprType: "d1",
            expressionText: "(> t 0)",
            samples: [{ time: 1, value: 1 }],
            color: "#0f0",
          },
        },
      });
      expect(visStore.expressions.a1.samples).toHaveLength(2);
      expect(visStore.expressions.d1.samples).toHaveLength(1);

      // Clear all expressions
      applyVisualisationEvent({ kind: "clear", expressions: {} });
      expect(visStore.expressions).toEqual({});
      expect(visStore.lastChangeKind).toBe("clear");

      // Re-register with different expressions
      applyVisualisationEvent({
        kind: "register",
        expressions: {
          a2: { exprType: "a2", expressionText: "(cos t)", samples: [], color: "#00f" },
        },
      });
      expect(Object.keys(visStore.expressions)).toEqual(["a2"]);
      // Old expressions are fully gone
      expect(visStore.expressions.a1).toBeUndefined();
      expect(visStore.expressions.d1).toBeUndefined();
    });

    it("expression with non-array samples is normalized to empty array", async () => {
      const { visStore, applyVisualisationEvent } = await loadVisStore();

      applyVisualisationEvent({
        expressions: {
          a1: {
            exprType: "a1",
            expressionText: "(sin t)",
            samples: "not an array" as any,
            color: null,
          },
        },
      });

      expect(Array.isArray(visStore.expressions.a1.samples)).toBe(true);
      expect(visStore.expressions.a1.samples).toEqual([]);
    });

    it("expression exprType falls back to the key name when missing", async () => {
      const { visStore, applyVisualisationEvent } = await loadVisStore();

      applyVisualisationEvent({
        expressions: {
          myChannel: {
            // exprType is undefined
            expressionText: "(sin t)",
            samples: [],
            color: null,
          },
        },
      });

      expect(visStore.expressions.myChannel.exprType).toBe("myChannel");
    });
  });

  // -----------------------------------------------------------------------
  // Exported constants
  // -----------------------------------------------------------------------
  describe("exported constants", () => {
    it("exports SERIAL_VIS_CHANNELS with correct values", async () => {
      const { SERIAL_VIS_CHANNELS } = await loadVisStore();

      expect(SERIAL_VIS_CHANNELS).toEqual(["a1", "a2", "a3", "a4", "d1", "d2", "d3"]);
    });

    it("exports DIGITAL_CHANNELS as subset", async () => {
      const { DIGITAL_CHANNELS } = await loadVisStore();

      expect(DIGITAL_CHANNELS).toEqual(["d1", "d2", "d3"]);
    });
  });
});
