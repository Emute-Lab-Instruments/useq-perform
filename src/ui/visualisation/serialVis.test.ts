import { beforeEach, describe, expect, it, vi } from "vitest";
import { timeToX, xToTime } from "./serialVis.ts";

// Bridge old-style samples on the store to the new getRenderData() API.
// The mock reads from __testVisStore which tests set after each dynamic import.
vi.mock("../../effects/visualisationSampler.ts", () => ({
  getRenderData: (exprType: string) => {
    const store = (globalThis as any).__testVisStore;
    if (!store) return null;
    const expr = store.expressions?.[exprType];
    if (!expr?.samples || expr.samples.length === 0) return null;
    const samples = expr.samples;
    const currentTime = store.currentTime ?? 0;

    const pastSamples = samples.filter((s: any) => s.time <= currentTime);
    const futureSamples = samples.filter((s: any) => s.time > currentTime);

    function makeMockBuffer(sampleList: any[]) {
      const times = sampleList.map((s: any) => s.time);
      const values = sampleList.map((s: any) => s.value);
      return {
        length: sampleList.length,
        capacity: sampleList.length,
        newestTime: sampleList.length > 0 ? sampleList[sampleList.length - 1].time : -Infinity,
        oldestTime: sampleList.length > 0 ? sampleList[0].time : Infinity,
        valueAt(i: number) { return i >= 0 && i < values.length ? values[i] : NaN; },
        timeAt(i: number) { return i >= 0 && i < times.length ? times[i] : NaN; },
      };
    }

    return {
      pastBuffer: makeMockBuffer(pastSamples),
      futureBuffer: futureSamples.length > 0
        ? makeMockBuffer(futureSamples)
        : undefined,
    };
  },
}));


function makeContext(): CanvasRenderingContext2D {
  return {
    clearRect: vi.fn(),
    fillText: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    setLineDash: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

interface RecordedCall {
  kind: "set" | "call";
  prop: string;
  value?: unknown;
  args?: unknown[];
}

interface RecordingContext {
  ctx: CanvasRenderingContext2D;
  calls: RecordedCall[];
  /** Most recent stroke() call's preceding strokeStyle / globalAlpha / dash. */
  strokeStates: Array<{
    strokeStyle: unknown;
    globalAlpha: unknown;
    lineDash: unknown[];
    moveTos: Array<[number, number]>;
    lineTos: Array<[number, number]>;
  }>;
}

/**
 * A context recorder built around a Proxy. Captures every property write
 * and method call in order, plus a per-stroke() snapshot of the
 * style state and the moveTo/lineTo coordinates that fed it. This lets
 * tests assert what was rendered and with which style — including
 * properties like strokeStyle, globalAlpha, and lineDash that the simple
 * vi.fn() mock can't distinguish across multiple writes.
 */
function makeRecordingContext(): RecordingContext {
  const calls: RecordedCall[] = [];
  const strokeStates: RecordingContext["strokeStates"] = [];
  const state: Record<string, unknown> = {
    strokeStyle: undefined,
    globalAlpha: 1,
    lineDash: [] as number[],
    fillStyle: undefined,
    lineWidth: undefined,
    lineJoin: undefined,
    lineCap: undefined,
    font: undefined,
    textAlign: undefined,
    imageSmoothingEnabled: undefined,
    imageSmoothingQuality: undefined,
  };

  // Per-path coordinate buffers that get flushed on stroke().
  let pendingMoveTos: Array<[number, number]> = [];
  let pendingLineTos: Array<[number, number]> = [];

  const target: Record<string, unknown> = {
    clearRect: (...args: unknown[]) => {
      calls.push({ kind: "call", prop: "clearRect", args });
    },
    fillText: (...args: unknown[]) => {
      calls.push({ kind: "call", prop: "fillText", args });
    },
    beginPath: () => {
      calls.push({ kind: "call", prop: "beginPath" });
      pendingMoveTos = [];
      pendingLineTos = [];
    },
    moveTo: (x: number, y: number) => {
      calls.push({ kind: "call", prop: "moveTo", args: [x, y] });
      pendingMoveTos.push([x, y]);
    },
    lineTo: (x: number, y: number) => {
      calls.push({ kind: "call", prop: "lineTo", args: [x, y] });
      pendingLineTos.push([x, y]);
    },
    stroke: () => {
      calls.push({ kind: "call", prop: "stroke" });
      strokeStates.push({
        strokeStyle: state.strokeStyle,
        globalAlpha: state.globalAlpha,
        lineDash: [...(state.lineDash as number[])],
        moveTos: [...pendingMoveTos],
        lineTos: [...pendingLineTos],
      });
    },
    setLineDash: (dash: number[]) => {
      calls.push({ kind: "call", prop: "setLineDash", args: [dash] });
      state.lineDash = Array.isArray(dash) ? [...dash] : [];
    },
    save: () => {
      calls.push({ kind: "call", prop: "save" });
    },
    restore: () => {
      calls.push({ kind: "call", prop: "restore" });
    },
  };

  const ctx = new Proxy(target, {
    get(t, prop: string) {
      if (prop in t) return t[prop];
      return state[prop];
    },
    set(_t, prop: string, value: unknown) {
      calls.push({ kind: "set", prop, value });
      state[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;

  return { ctx, calls, strokeStates };
}

describe("drawSerialVis (pure renderer)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    document.body.innerHTML = `
      <div id="panel-vis"></div>
      <canvas id="serialcanvas" width="320" height="180"></canvas>
    `;
    const panel = document.getElementById("panel-vis") as HTMLDivElement;
    panel.hidden = false;
    panel.style.display = "block";
  });

  it("draws the empty-state message when no expressions are registered", async () => {
    const context = makeContext();
    const canvas = document.getElementById("serialcanvas") as HTMLCanvasElement;
    canvas.getContext = vi.fn(() => context);

    const { drawSerialVis } = await import("./serialVis.ts");
    drawSerialVis();

    expect(context.clearRect).toHaveBeenCalledWith(0, 0, canvas.width, canvas.height);
    expect(context.fillText).toHaveBeenCalledWith(
      "No expressions selected for visualisation",
      canvas.width / 2,
      canvas.height / 2,
    );
  });

  it("renders nothing when the panel is hidden", async () => {
    const panel = document.getElementById("panel-vis") as HTMLDivElement;
    panel.hidden = true;
    panel.style.display = "none";

    const context = makeContext();
    const canvas = document.getElementById("serialcanvas") as HTMLCanvasElement;
    canvas.getContext = vi.fn(() => context);

    const { drawSerialVis } = await import("./serialVis.ts");
    drawSerialVis();

    expect(context.clearRect).not.toHaveBeenCalled();
    expect(context.fillText).not.toHaveBeenCalled();
  });

  it("does not throw when the canvas is missing", async () => {
    document.getElementById("serialcanvas")?.remove();
    const { drawSerialVis } = await import("./serialVis.ts");
    expect(() => drawSerialVis()).not.toThrow();
  });
});

describe("time-axis mapping: centre column = now", () => {
  const WIDTH = 800;
  const NOW = 1000;
  const WINDOW = 10;
  const HALF = WINDOW / 2;

  it("xToTime at centre pixel equals now", () => {
    expect(xToTime(WIDTH / 2, NOW, HALF, WINDOW, WIDTH)).toBeCloseTo(NOW, 10);
  });

  it("xToTime at left edge equals now minus half-window", () => {
    expect(xToTime(0, NOW, HALF, WINDOW, WIDTH)).toBeCloseTo(NOW - HALF, 10);
  });

  it("xToTime at right edge equals now plus half-window", () => {
    expect(xToTime(WIDTH, NOW, HALF, WINDOW, WIDTH)).toBeCloseTo(NOW + HALF, 10);
  });

  it("timeToX at now equals centre pixel", () => {
    expect(timeToX(NOW, NOW, HALF, WINDOW, WIDTH)).toBeCloseTo(WIDTH / 2, 10);
  });

  it("timeToX at now minus half-window equals 0", () => {
    expect(timeToX(NOW - HALF, NOW, HALF, WINDOW, WIDTH)).toBeCloseTo(0, 10);
  });

  it("timeToX at now plus half-window equals canvasWidth", () => {
    expect(timeToX(NOW + HALF, NOW, HALF, WINDOW, WIDTH)).toBeCloseTo(WIDTH, 10);
  });

  it("round-trip: timeToX(xToTime(x)) ≈ x for several values", () => {
    for (const x of [0, WIDTH * 0.25, WIDTH / 2, WIDTH * 0.75, WIDTH]) {
      expect(timeToX(xToTime(x, NOW, HALF, WINDOW, WIDTH), NOW, HALF, WINDOW, WIDTH)).toBeCloseTo(x, 10);
    }
  });

  it("tiny windowDuration produces no NaN or Infinity", () => {
    const tiny = 1e-10;
    const halfTiny = tiny / 2;
    const x = timeToX(NOW, NOW, halfTiny, tiny, WIDTH);
    const t = xToTime(WIDTH / 2, NOW, halfTiny, tiny, WIDTH);
    expect(Number.isFinite(x)).toBe(true);
    expect(Number.isFinite(t)).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────
// Lane layout, future segments, palette swap (visualisation.md §1.4–§1.10)
// ───────────────────────────────────────────────────────────────────────

interface SamplePoint {
  time: number;
  value: number;
}

/** Generate a linear ramp of samples spanning [t0, t1]. */
function ramp(t0: number, t1: number, n: number, v0: number, v1: number): SamplePoint[] {
  const out: SamplePoint[] = [];
  for (let i = 0; i < n; i++) {
    const f = n > 1 ? i / (n - 1) : 0;
    out.push({ time: t0 + (t1 - t0) * f, value: v0 + (v1 - v0) * f });
  }
  return out;
}

/** Generate a digital sample stream: alternates 0/1. */
function digitalSamples(t0: number, t1: number, n: number): SamplePoint[] {
  const out: SamplePoint[] = [];
  for (let i = 0; i < n; i++) {
    const f = n > 1 ? i / (n - 1) : 0;
    out.push({ time: t0 + (t1 - t0) * f, value: i % 2 });
  }
  return out;
}

/** Build a fully-visible panel + canvas in the DOM. */
function setupDom(width = 320, height = 180): HTMLCanvasElement {
  document.body.innerHTML = `
    <div id="panel-vis"></div>
    <canvas id="serialcanvas" width="${width}" height="${height}"></canvas>
  `;
  const panel = document.getElementById("panel-vis") as HTMLDivElement;
  panel.hidden = false;
  panel.style.display = "block";
  return document.getElementById("serialcanvas") as HTMLCanvasElement;
}

describe("drawSerialVis: lane layout (visualisation.md §1.5)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    setupDom();
  });

  it("digital outputs render as step-mode binary (extra horizontal points at value transitions)", async () => {
    const canvas = document.getElementById("serialcanvas") as HTMLCanvasElement;
    const recorder = makeRecordingContext();
    canvas.getContext = vi.fn(() => recorder.ctx);

    const { drawSerialVis } = await import("./serialVis.ts");
    const { setVisStore, visStore } = await import("../../utils/visualisationStore.ts");
    (globalThis as any).__testVisStore = visStore;

    const NOW = 100;
    const WINDOW = 10;
    const samples = digitalSamples(NOW - 4, NOW - 0.5, 6); // all in past, alternates 0/1
    setVisStore("currentTime", NOW);
    setVisStore("displayTime", NOW);
    setVisStore("settings", {
      windowDuration: WINDOW,
      sampleCount: 100,
      lineWidth: 1.5,
      futureDashed: true,
      futureMaskOpacity: 0.35,
      futureMaskWidth: 12,
      circularOffset: 0,
      futureLeadSeconds: 1,
      digitalLaneGap: 4,
    });
    setVisStore("expressions", {
      d1: { exprType: "d1", expressionText: "(d1 ...)", samples, color: "#ff0000" },
    });

    drawSerialVis();

    // Find the trace stroke for d1 (red, alpha = 1 because all samples are past).
    const traceStrokes = recorder.strokeStates.filter(
      (s) => s.strokeStyle === "#ff0000",
    );
    expect(traceStrokes.length).toBeGreaterThan(0);

    const trace = traceStrokes[0];
    // Step mode emits a corner point whenever Y changes — so total points
    // exceed the input sample count when values alternate.
    const totalPoints = trace.moveTos.length + trace.lineTos.length;
    expect(totalPoints).toBeGreaterThan(samples.length);

    // Step-mode also picks miter join + butt cap (set on the saved state
    // for the trace stroke). The renderer applies these inside save/restore.
    const lineJoinSets = recorder.calls.filter(
      (c) => c.kind === "set" && c.prop === "lineJoin" && c.value === "miter",
    );
    const lineCapSets = recorder.calls.filter(
      (c) => c.kind === "set" && c.prop === "lineCap" && c.value === "butt",
    );
    expect(lineJoinSets.length).toBeGreaterThan(0);
    expect(lineCapSets.length).toBeGreaterThan(0);
  });

  it("analog outputs render as continuous curves (no step-mode duplication, no miter/butt)", async () => {
    const canvas = document.getElementById("serialcanvas") as HTMLCanvasElement;
    const recorder = makeRecordingContext();
    canvas.getContext = vi.fn(() => recorder.ctx);

    const { drawSerialVis } = await import("./serialVis.ts");
    const { setVisStore, visStore } = await import("../../utils/visualisationStore.ts");
    (globalThis as any).__testVisStore = visStore;

    const NOW = 100;
    const WINDOW = 10;
    // 6 distinct values, all in past — analog should produce exactly 6 points.
    const samples = ramp(NOW - 4, NOW - 0.5, 6, 0.1, 0.9);
    setVisStore("currentTime", NOW);
    setVisStore("displayTime", NOW);
    setVisStore("settings", {
      windowDuration: WINDOW,
      sampleCount: 100,
      lineWidth: 1.5,
      futureDashed: true,
      futureMaskOpacity: 0.35,
      futureMaskWidth: 12,
      circularOffset: 0,
      futureLeadSeconds: 1,
      digitalLaneGap: 4,
    });
    setVisStore("expressions", {
      a1: { exprType: "a1", expressionText: "(a1 ...)", samples, color: "#00ff00" },
    });

    drawSerialVis();

    const traceStrokes = recorder.strokeStates.filter(
      (s) => s.strokeStyle === "#00ff00",
    );
    expect(traceStrokes.length).toBeGreaterThan(0);

    const trace = traceStrokes[0];
    const totalPoints = trace.moveTos.length + trace.lineTos.length;
    // Continuous mode: one point per sample, no step duplicates.
    expect(totalPoints).toBe(samples.length);

    // Analog path doesn't override lineJoin/lineCap to miter/butt.
    const miterSets = recorder.calls.filter(
      (c) => c.kind === "set" && c.prop === "lineJoin" && c.value === "miter",
    );
    const buttSets = recorder.calls.filter(
      (c) => c.kind === "set" && c.prop === "lineCap" && c.value === "butt",
    );
    expect(miterSets.length).toBe(0);
    expect(buttSets.length).toBe(0);
  });

  it("digital lane Y positions are bounded to per-lane height (drawable / lane count)", async () => {
    const WIDTH = 320;
    const HEIGHT = 200;
    setupDom(WIDTH, HEIGHT);
    const canvas = document.getElementById("serialcanvas") as HTMLCanvasElement;
    const recorder = makeRecordingContext();
    canvas.getContext = vi.fn(() => recorder.ctx);

    const { drawSerialVis } = await import("./serialVis.ts");
    const { setVisStore, visStore } = await import("../../utils/visualisationStore.ts");
    (globalThis as any).__testVisStore = visStore;

    const NOW = 100;
    const WINDOW = 10;
    // Three digital lanes — d1 (top), d2 (mid), d3 (bottom).
    // Use constant value=1 so each lane stroke sits at its laneTop.
    const constHigh = (t0: number, t1: number, n: number): SamplePoint[] => {
      const out: SamplePoint[] = [];
      for (let i = 0; i < n; i++) {
        const f = n > 1 ? i / (n - 1) : 0;
        out.push({ time: t0 + (t1 - t0) * f, value: 1 });
      }
      return out;
    };

    setVisStore("currentTime", NOW);
    setVisStore("displayTime", NOW);
    setVisStore("settings", {
      windowDuration: WINDOW,
      sampleCount: 100,
      lineWidth: 1.5,
      futureDashed: true,
      futureMaskOpacity: 0.35,
      futureMaskWidth: 12,
      circularOffset: 0,
      futureLeadSeconds: 1,
      digitalLaneGap: 0, // disable gap to keep arithmetic clean
    });
    setVisStore("expressions", {
      d1: { exprType: "d1", expressionText: "", samples: constHigh(NOW - 4, NOW - 0.5, 4), color: "#aa0001" },
      d2: { exprType: "d2", expressionText: "", samples: constHigh(NOW - 4, NOW - 0.5, 4), color: "#aa0002" },
      d3: { exprType: "d3", expressionText: "", samples: constHigh(NOW - 4, NOW - 0.5, 4), color: "#aa0003" },
    });

    drawSerialVis();

    // Renderer uses verticalPadding = 10% of canvas height.
    const verticalPadding = HEIGHT * 0.1;
    const drawableHeight = HEIGHT - verticalPadding * 2;
    const laneCount = 3;
    const laneHeight = drawableHeight / laneCount;

    function avgY(strokeStyle: string): number {
      const strokes = recorder.strokeStates.filter((s) => s.strokeStyle === strokeStyle);
      expect(strokes.length).toBeGreaterThan(0);
      const ys: number[] = [];
      for (const s of strokes) {
        for (const [, y] of s.moveTos) ys.push(y);
        for (const [, y] of s.lineTos) ys.push(y);
      }
      return ys.reduce((a, b) => a + b, 0) / ys.length;
    }

    // value=1 → y = laneBottom - laneHeight = laneTop.
    const d1Y = avgY("#aa0001");
    const d2Y = avgY("#aa0002");
    const d3Y = avgY("#aa0003");

    expect(d1Y).toBeCloseTo(verticalPadding + 0 * laneHeight, 5);
    expect(d2Y).toBeCloseTo(verticalPadding + 1 * laneHeight, 5);
    expect(d3Y).toBeCloseTo(verticalPadding + 2 * laneHeight, 5);

    // And lane spacing equals laneHeight.
    expect(d2Y - d1Y).toBeCloseTo(laneHeight, 5);
    expect(d3Y - d2Y).toBeCloseTo(laneHeight, 5);
  });
});

describe("drawSerialVis: future segments (visualisation.md §1.4)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    setupDom();
  });

  it("future segments render with lower alpha than past segments", async () => {
    const canvas = document.getElementById("serialcanvas") as HTMLCanvasElement;
    const recorder = makeRecordingContext();
    canvas.getContext = vi.fn(() => recorder.ctx);

    const { drawSerialVis } = await import("./serialVis.ts");
    const { setVisStore, visStore } = await import("../../utils/visualisationStore.ts");
    (globalThis as any).__testVisStore = visStore;

    const NOW = 100;
    const WINDOW = 10;
    // Samples spanning past + future.
    const samples = ramp(NOW - 4, NOW + 4, 16, 0.1, 0.9);
    setVisStore("currentTime", NOW);
    setVisStore("displayTime", NOW);
    setVisStore("settings", {
      windowDuration: WINDOW,
      sampleCount: 100,
      lineWidth: 1.5,
      futureDashed: true, // default
      futureMaskOpacity: 0.35,
      futureMaskWidth: 12,
      circularOffset: 0,
      futureLeadSeconds: 1,
      digitalLaneGap: 4,
    });
    setVisStore("expressions", {
      a1: { exprType: "a1", expressionText: "", samples, color: "#0000ff" },
    });

    drawSerialVis();

    const traceStrokes = recorder.strokeStates.filter((s) => s.strokeStyle === "#0000ff");
    // Renderer emits two strokes per expression: past, then future.
    expect(traceStrokes.length).toBe(2);

    const [pastStroke, futureStroke] = traceStrokes;
    expect(typeof pastStroke.globalAlpha).toBe("number");
    expect(typeof futureStroke.globalAlpha).toBe("number");
    expect(futureStroke.globalAlpha as number).toBeLessThan(pastStroke.globalAlpha as number);
    // With futureDashed=true, future alpha = 0.6 (per current implementation).
    expect(futureStroke.globalAlpha as number).toBeCloseTo(0.6, 5);
    expect(pastStroke.globalAlpha as number).toBeCloseTo(1, 5);
  });

  it("futureDashed=false yields higher future alpha than futureDashed=true", async () => {
    // The implementation uses alpha=0.85 when futureDashed===false,
    // and alpha=0.6 otherwise. Verify the swap takes effect.
    async function runWith(futureDashed: boolean): Promise<number> {
      vi.resetModules();
      setupDom();
      const canvas = document.getElementById("serialcanvas") as HTMLCanvasElement;
      const recorder = makeRecordingContext();
      canvas.getContext = vi.fn(() => recorder.ctx);

      const { drawSerialVis } = await import("./serialVis.ts");
      const { setVisStore, visStore } = await import("../../utils/visualisationStore.ts");
    (globalThis as any).__testVisStore = visStore;

      const NOW = 100;
      const samples = ramp(NOW - 4, NOW + 4, 16, 0.1, 0.9);
      setVisStore("currentTime", NOW);
      setVisStore("displayTime", NOW);
      setVisStore("settings", {
        windowDuration: 10,
        sampleCount: 100,
        lineWidth: 1.5,
        futureDashed,
        futureMaskOpacity: 0.35,
        futureMaskWidth: 12,
        circularOffset: 0,
        futureLeadSeconds: 1,
        digitalLaneGap: 4,
      });
      setVisStore("expressions", {
        a1: { exprType: "a1", expressionText: "", samples, color: "#abcdef" },
      });

      drawSerialVis();
      const strokes = recorder.strokeStates.filter((s) => s.strokeStyle === "#abcdef");
      // Last stroke is the future segment.
      return strokes[strokes.length - 1].globalAlpha as number;
    }

    const dashedAlpha = await runWith(true);
    const solidAlpha = await runWith(false);
    expect(solidAlpha).toBeGreaterThan(dashedAlpha);
    expect(dashedAlpha).toBeCloseTo(0.6, 5);
    expect(solidAlpha).toBeCloseTo(0.85, 5);
  });
});

describe("drawSerialVis: palette swap (visualisation.md §1.10)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    setupDom();
  });

  it("changing expression colors causes the next render to use the new colours", async () => {
    const canvas = document.getElementById("serialcanvas") as HTMLCanvasElement;
    const recorder = makeRecordingContext();
    canvas.getContext = vi.fn(() => recorder.ctx);

    const { drawSerialVis } = await import("./serialVis.ts");
    const { setVisStore, visStore } = await import("../../utils/visualisationStore.ts");
    (globalThis as any).__testVisStore = visStore;

    const NOW = 100;
    const samples = ramp(NOW - 4, NOW - 0.5, 6, 0.2, 0.8);
    setVisStore("currentTime", NOW);
    setVisStore("displayTime", NOW);
    setVisStore("settings", {
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

    // First palette (e.g. dark theme).
    setVisStore("expressions", {
      a1: { exprType: "a1", expressionText: "", samples, color: "#11aa11" },
    });
    drawSerialVis();
    const darkStrokes = recorder.strokeStates.filter((s) => s.strokeStyle === "#11aa11");
    expect(darkStrokes.length).toBeGreaterThan(0);

    // Swap palette: same expression, new colour (e.g. light theme).
    setVisStore("expressions", {
      a1: { exprType: "a1", expressionText: "", samples, color: "#aa11aa" },
    });
    drawSerialVis();

    // After the swap, the most recent stroke for this trace uses the new colour.
    const allTraceStrokes = recorder.strokeStates.filter(
      (s) => s.strokeStyle === "#11aa11" || s.strokeStyle === "#aa11aa",
    );
    const last = allTraceStrokes[allTraceStrokes.length - 1];
    expect(last.strokeStyle).toBe("#aa11aa");

    // And the new colour did appear in the render after the swap.
    const lightStrokes = recorder.strokeStates.filter((s) => s.strokeStyle === "#aa11aa");
    expect(lightStrokes.length).toBeGreaterThan(0);
  });

  it("renderer does not blank/no-op on palette swap — traces continue rendering", async () => {
    const canvas = document.getElementById("serialcanvas") as HTMLCanvasElement;
    const recorder = makeRecordingContext();
    canvas.getContext = vi.fn(() => recorder.ctx);

    const { drawSerialVis } = await import("./serialVis.ts");
    const { setVisStore, visStore } = await import("../../utils/visualisationStore.ts");
    (globalThis as any).__testVisStore = visStore;

    const NOW = 100;
    const samples = ramp(NOW - 4, NOW - 0.5, 6, 0.2, 0.8);
    setVisStore("currentTime", NOW);
    setVisStore("displayTime", NOW);
    setVisStore("settings", {
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
    setVisStore("expressions", {
      a1: { exprType: "a1", expressionText: "", samples, color: "#111111" },
    });
    drawSerialVis();

    const beforeStrokes = recorder.strokeStates.filter((s) => s.strokeStyle === "#111111").length;
    expect(beforeStrokes).toBeGreaterThan(0);

    // Palette swap mid-session: change colour. There must be no exception
    // and no "empty state" message — the trace continues rendering.
    setVisStore("expressions", {
      a1: { exprType: "a1", expressionText: "", samples, color: "#222222" },
    });
    expect(() => drawSerialVis()).not.toThrow();

    const afterStrokes = recorder.strokeStates.filter((s) => s.strokeStyle === "#222222").length;
    expect(afterStrokes).toBeGreaterThan(0);

    // The "No expressions selected" empty-state message must NOT have been
    // drawn at any point — the trace registry was non-empty throughout.
    const fillTextCalls = recorder.calls.filter(
      (c) => c.kind === "call" && c.prop === "fillText",
    );
    const emptyStateDrawn = fillTextCalls.some(
      (c) => Array.isArray(c.args) && c.args[0] === "No expressions selected for visualisation",
    );
    expect(emptyStateDrawn).toBe(false);
  });
});
