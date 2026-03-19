import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Dynamically import a fresh visualisationStore module.
 * vi.resetModules() ensures we get fresh module-level state
 * (a new createStore call) on each load.
 */
async function loadVisStore() {
  vi.resetModules();
  const storeModule = await import("./visualisationStore");
  return storeModule;
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
  // Direct mutation functions
  // -----------------------------------------------------------------------
  describe("updateTime", () => {
    it("sets currentTime and displayTime", async () => {
      const { visStore, updateTime } = await loadVisStore();

      updateTime(42.5);
      expect(visStore.currentTime).toBe(42.5);
      expect(visStore.displayTime).toBe(42.5);
    });
  });

  describe("updateBar", () => {
    it("sets bar value", async () => {
      const { visStore, updateBar } = await loadVisStore();

      updateBar(0.75);
      expect(visStore.bar).toBe(0.75);
    });
  });

  describe("setLastChangeKind", () => {
    it("sets lastChangeKind", async () => {
      const { visStore, setLastChangeKind } = await loadVisStore();

      setLastChangeKind("data");
      expect(visStore.lastChangeKind).toBe("data");
    });
  });

  describe("updateSettings", () => {
    it("replaces settings entirely", async () => {
      const { visStore, updateSettings } = await loadVisStore();

      updateSettings({
        windowDuration: 20,
        sampleCount: 200,
        lineWidth: 3,
        futureDashed: false,
        futureMaskOpacity: 0.5,
        futureMaskWidth: 16,
        circularOffset: 2,
        futureLeadSeconds: 3,
        digitalLaneGap: 8,
      });

      expect(visStore.settings.windowDuration).toBe(20);
      expect(visStore.settings.sampleCount).toBe(200);
      expect(visStore.settings.lineWidth).toBe(3);
      expect(visStore.settings.futureDashed).toBe(false);
    });
  });

  describe("updateExpressions", () => {
    it("sets expressions from a record", async () => {
      const { visStore, updateExpressions } = await loadVisStore();

      updateExpressions({
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

    it("replaces expressions fully (no stale keys accumulate)", async () => {
      const { visStore, updateExpressions } = await loadVisStore();

      updateExpressions({
        a1: { exprType: "a1", expressionText: "(sin t)", samples: [], color: "#f00" },
        a2: { exprType: "a2", expressionText: "(cos t)", samples: [], color: "#0f0" },
      });
      expect(Object.keys(visStore.expressions)).toEqual(["a1", "a2"]);

      // Second update only has a1 - a2 must be gone
      updateExpressions({
        a1: { exprType: "a1", expressionText: "(sin t)", samples: [], color: "#f00" },
      });
      expect(Object.keys(visStore.expressions)).toEqual(["a1"]);
      expect(visStore.expressions.a2).toBeUndefined();
    });

    it("expression samples array is replaced, not appended", async () => {
      const { visStore, updateExpressions } = await loadVisStore();

      updateExpressions({
        a1: {
          exprType: "a1",
          expressionText: "(sin t)",
          samples: [{ time: 0, value: 0 }, { time: 1, value: 1 }],
          color: null,
        },
      });
      expect(visStore.expressions.a1.samples).toHaveLength(2);

      updateExpressions({
        a1: {
          exprType: "a1",
          expressionText: "(sin t)",
          samples: [{ time: 2, value: 0.5 }],
          color: null,
        },
      });
      expect(visStore.expressions.a1.samples).toHaveLength(1);
      expect(visStore.expressions.a1.samples[0]).toEqual({ time: 2, value: 0.5 });
    });
  });

  describe("removeExpression", () => {
    it("removes a single expression by key", async () => {
      const { visStore, updateExpressions, removeExpression } = await loadVisStore();

      updateExpressions({
        a1: { exprType: "a1", expressionText: "(sin t)", samples: [], color: "#f00" },
        a2: { exprType: "a2", expressionText: "(cos t)", samples: [], color: "#0f0" },
      });
      expect(Object.keys(visStore.expressions).sort()).toEqual(["a1", "a2"]);

      removeExpression("a1");
      expect(Object.keys(visStore.expressions)).toEqual(["a2"]);
      expect(visStore.expressions.a1).toBeUndefined();
    });

    it("is a no-op for non-existent keys", async () => {
      const { visStore, updateExpressions, removeExpression } = await loadVisStore();

      updateExpressions({
        a1: { exprType: "a1", expressionText: "(sin t)", samples: [], color: "#f00" },
      });

      removeExpression("a99");
      expect(Object.keys(visStore.expressions)).toEqual(["a1"]);
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

    it("handles 9 channels (matching real hardware buffer count)", async () => {
      const { visStore, snapshotSerialBuffers } = await loadVisStore();

      const buffers = Array.from({ length: 9 }, (_, ch) =>
        createMockBuffer(Array.from({ length: 50 }, (_, i) => ch * 100 + i))
      );

      snapshotSerialBuffers(buffers);

      expect(visStore.serialBuffers.channels).toHaveLength(9);
      expect(visStore.serialBuffers.lengths).toHaveLength(9);
      expect(visStore.serialBuffers.channels[0][0]).toBe(0);
      expect(visStore.serialBuffers.channels[8][49]).toBe(849);
    });

    it("re-snapshot reflects buffer content changes", async () => {
      const { visStore, snapshotSerialBuffers } = await loadVisStore();

      const values = [1, 2, 3];
      const buf = {
        get length() { return values.length; },
        oldest: (i: number) => values[i],
        capacity: 10,
      };

      snapshotSerialBuffers([buf]);
      expect(visStore.serialBuffers.channels[0]).toEqual([1, 2, 3]);

      values.shift();
      values.push(4);

      snapshotSerialBuffers([buf]);
      expect(visStore.serialBuffers.channels[0]).toEqual([2, 3, 4]);
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

      original.push("#0000ff");

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
  // High-frequency ingestion
  // -----------------------------------------------------------------------
  describe("high-frequency ingestion", () => {
    it("handles rapid sequential updates without data corruption", async () => {
      const { visStore, updateTime, updateBar, updateExpressions, setLastChangeKind } = await loadVisStore();

      for (let i = 0; i < 100; i++) {
        updateTime(i * 0.01);
        updateBar((i % 100) / 100);
        updateExpressions({
          a1: {
            exprType: "a1",
            expressionText: "(sin t)",
            samples: [{ time: i * 0.01, value: Math.sin(i * 0.01) }],
            color: "#ff0000",
          },
        });
        setLastChangeKind("data");
      }

      expect(visStore.currentTime).toBeCloseTo(0.99);
      expect(visStore.lastChangeKind).toBe("data");
      expect(visStore.expressions.a1.samples).toHaveLength(1);
      expect(visStore.expressions.a1.samples[0].time).toBeCloseTo(0.99);
    });
  });

  // -----------------------------------------------------------------------
  // Palette and expression coexistence
  // -----------------------------------------------------------------------
  describe("palette and expression coexistence", () => {
    it("palette and expression colors are independent", async () => {
      const { visStore, updateExpressions, setVisPalette } = await loadVisStore();

      setVisPalette(["#aaa", "#bbb", "#ccc"]);

      updateExpressions({
        a1: { exprType: "a1", expressionText: "(sin t)", samples: [], color: "#ff0000" },
        a2: { exprType: "a2", expressionText: "(cos t)", samples: [], color: null },
      });

      expect(visStore.palette).toEqual(["#aaa", "#bbb", "#ccc"]);
      expect(visStore.expressions.a1.color).toBe("#ff0000");
      expect(visStore.expressions.a2.color).toBeNull();
    });

    it("clearing expressions does not affect palette", async () => {
      const { visStore, updateExpressions, setVisPalette } = await loadVisStore();

      setVisPalette(["#111", "#222"]);
      updateExpressions({
        a1: { exprType: "a1", expressionText: "(sin t)", samples: [], color: "#f00" },
      });

      updateExpressions({});

      expect(visStore.expressions).toEqual({});
      expect(visStore.palette).toEqual(["#111", "#222"]);
    });

    it("replacing palette does not affect expression state", async () => {
      const { visStore, updateTime, updateExpressions, setVisPalette } = await loadVisStore();

      updateTime(5);
      updateExpressions({
        a1: { exprType: "a1", expressionText: "(sin t)", samples: [{ time: 0, value: 1 }], color: "#f00" },
      });

      setVisPalette(["#new1", "#new2"]);

      expect(visStore.currentTime).toBe(5);
      expect(visStore.expressions.a1.color).toBe("#f00");
      expect(visStore.expressions.a1.samples).toHaveLength(1);
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
