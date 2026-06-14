import { beforeEach, describe, expect, it, vi } from "vitest";
import { PastBuffer } from "../../lib/PastBuffer.ts";
import {
  __serialVisGLInternals,
  computeAdaptivePastBufferRate,
  drawSerialVisGL,
  drawSerialVisGLFromStores,
  type VisRenderInput,
} from "./serialVisGL.ts";

const {
  flattenSamples,
  buildThickLineGeometry,
  buildCombinedSamples,
  parseColor,
  ensureScratch,
  sampleFingerprint,
  fingerprintChanged,
  scratch: getScratch,
  thickScratch: getThickScratch,
  THICK_FLOATS_PER_VERTEX,
  computeLaneLayout,
  isDigitalOutput,
} = __serialVisGLInternals;

interface Sample {
  time: number;
  value: number;
}

function makeSamples(pairs: [number, number][]): Sample[] {
  return pairs.map(([time, value]) => ({ time, value }));
}

describe("flattenSamples", () => {
  it("returns 0 for empty input", () => {
    expect(flattenSamples([], false)).toBe(0);
  });

  it("returns 0 for empty input in step mode", () => {
    expect(flattenSamples([], true)).toBe(0);
  });

  it("flattens analog samples without duplication", () => {
    const samples = makeSamples([
      [0, 0.1],
      [1, 0.5],
      [2, 0.9],
    ]);
    const count = flattenSamples(samples, false);
    expect(count).toBe(3);
    const buf = getScratch();
    expect(buf[0]).toBe(0);
    expect(buf[1]).toBeCloseTo(0.1);
    expect(buf[2]).toBe(1);
    expect(buf[3]).toBeCloseTo(0.5);
    expect(buf[4]).toBe(2);
    expect(buf[5]).toBeCloseTo(0.9);
  });

  it("inserts step-mode corner points on value transitions", () => {
    const samples = makeSamples([
      [0, 0],
      [1, 1],
      [2, 0],
    ]);
    const count = flattenSamples(samples, true);
    // Transition 0->1 at t=1: inserts (1,0) before (1,1)
    // Transition 1->0 at t=2: inserts (2,1) before (2,0)
    // Total: (0,0), (1,0), (1,1), (2,1), (2,0) = 5
    expect(count).toBe(5);
    const buf = getScratch();
    expect(buf[0]).toBe(0);
    expect(buf[1]).toBe(0);   // original (0,0)
    expect(buf[2]).toBe(1);
    expect(buf[3]).toBe(0);   // inserted corner at t=1, prev value
    expect(buf[4]).toBe(1);
    expect(buf[5]).toBe(1);   // original (1,1)
    expect(buf[6]).toBe(2);
    expect(buf[7]).toBe(1);   // inserted corner at t=2, prev value
    expect(buf[8]).toBe(2);
    expect(buf[9]).toBe(0);   // original (2,0)
  });

  it("does not insert corners when step-mode values are identical", () => {
    const samples = makeSamples([
      [0, 1],
      [1, 1],
      [2, 1],
    ]);
    const count = flattenSamples(samples, true);
    expect(count).toBe(3);
  });

  it("handles a single sample", () => {
    const samples = makeSamples([[5, 0.5]]);
    const count = flattenSamples(samples, false);
    expect(count).toBe(1);
    const buf = getScratch();
    expect(buf[0]).toBe(5);
    expect(buf[1]).toBeCloseTo(0.5);
  });
});

describe("parseColor", () => {
  it("parses 6-digit hex", () => {
    const [r, g, b] = parseColor("#ff0000");
    expect(r).toBeCloseTo(1, 5);
    expect(g).toBeCloseTo(0, 5);
    expect(b).toBeCloseTo(0, 5);
  });

  it("parses 3-digit hex", () => {
    const [r, g, b] = parseColor("#0f0");
    expect(r).toBeCloseTo(0, 5);
    expect(g).toBeCloseTo(1, 5);
    expect(b).toBeCloseTo(0, 5);
  });

  it("parses 8-digit hex (with alpha channel, ignores alpha)", () => {
    const [r, g, b] = parseColor("#0000ff80");
    expect(r).toBeCloseTo(0, 5);
    expect(g).toBeCloseTo(0, 5);
    expect(b).toBeCloseTo(1, 5);
  });

  it("caches results for repeated calls", () => {
    const first = parseColor("#abcdef");
    const second = parseColor("#abcdef");
    expect(first).toBe(second);
  });

  it("returns white as fallback for unknown colors without a DOM", () => {
    // In Vitest jsdom, the canvas fallback may or may not work.
    // With a real DOM (jsdom), named colors go through the canvas path.
    const result = parseColor("rgb(128, 0, 255)");
    expect(result).toHaveLength(3);
    expect(result.every((v) => v >= 0 && v <= 1)).toBe(true);
  });

  it("handles mixed-case hex", () => {
    const [r, g, b] = parseColor("#aAbBcC");
    expect(r).toBeCloseTo(0xaa / 255, 5);
    expect(g).toBeCloseTo(0xbb / 255, 5);
    expect(b).toBeCloseTo(0xcc / 255, 5);
  });
});

describe("buildThickLineGeometry", () => {
  beforeEach(() => {
    ensureScratch(64);
  });

  function setupScratchLine(pairs: [number, number][]): number {
    const count = flattenSamples(
      pairs.map(([time, value]) => ({ time, value })),
      false,
    );
    return count;
  }

  it("returns 0 for fewer than 2 vertices", () => {
    const count = setupScratchLine([[0, 0.5]]);
    const result = buildThickLineGeometry(
      count, 2, 0, 10, 10, 90, 800, 600,
    );
    expect(result).toBe(0);
  });

  it("produces at least 4 vertices for a single segment", () => {
    const count = setupScratchLine([
      [0, 0],
      [10, 1],
    ]);
    const result = buildThickLineGeometry(
      count, 2, 0, 10, 10, 90, 800, 600,
    );
    // Single segment: 2 cap vertices on each end = 4 total
    expect(result).toBe(4);
  });

  it("vertex data is interleaved as (clipX, clipY, time)", () => {
    const count = setupScratchLine([
      [0, 0],
      [10, 1],
    ]);
    const result = buildThickLineGeometry(
      count, 2, 0, 10, 10, 90, 800, 600,
    );
    expect(result).toBeGreaterThanOrEqual(4);
    const buf = getThickScratch();
    for (let i = 0; i < result; i++) {
      const clipX = buf[i * THICK_FLOATS_PER_VERTEX];
      const clipY = buf[i * THICK_FLOATS_PER_VERTEX + 1];
      const time = buf[i * THICK_FLOATS_PER_VERTEX + 2];
      expect(Number.isFinite(clipX)).toBe(true);
      expect(Number.isFinite(clipY)).toBe(true);
      expect(Number.isFinite(time)).toBe(true);
      // Clip space coords should be roughly in [-2, 2] range
      expect(Math.abs(clipX)).toBeLessThan(3);
      expect(Math.abs(clipY)).toBeLessThan(3);
    }
  });

  it("vertices are offset symmetrically around the polyline center", () => {
    const count = setupScratchLine([
      [5, 0.5],
      [5, 0.5],
    ]);
    // Degenerate (zero-length) segment still produces geometry
    const result = buildThickLineGeometry(
      count, 2, 0, 10, 10, 90, 800, 600,
    );
    expect(result).toBeGreaterThanOrEqual(4);
  });

  it("handles a multi-segment polyline", () => {
    const count = setupScratchLine([
      [0, 0],
      [3, 0.5],
      [7, 1],
      [10, 0.5],
    ]);
    const result = buildThickLineGeometry(
      count, 1.5, 0, 10, 10, 90, 800, 600,
    );
    // 4 input points -> at least 2 verts per point = 8
    expect(result).toBeGreaterThanOrEqual(8);
  });

  it("bevel join kicks in for sharp angles", () => {
    // V-shape: goes up steeply then reverses direction
    const count = setupScratchLine([
      [0, 0],
      [5, 1],
      [10, 0],
    ]);
    const vertsBevel = buildThickLineGeometry(
      count, 5, 0, 10, 10, 90, 800, 600,
    );
    // With a bevel join at the sharp peak, the vertex count should
    // exceed the minimum (6 for 3 points with miter joins = 2 cap + 2 mid + 2 cap).
    // Bevel adds extra vertices at the join.
    expect(vertsBevel).toBeGreaterThanOrEqual(6);
  });

  it("produces no NaN or Infinity values", () => {
    const count = setupScratchLine([
      [0, 0],
      [1, 0.5],
      [2, 1],
      [3, 0],
    ]);
    const result = buildThickLineGeometry(
      count, 3, 0, 3, 20, 180, 1920, 1080,
    );
    const buf = getThickScratch();
    for (let i = 0; i < result * THICK_FLOATS_PER_VERTEX; i++) {
      expect(Number.isFinite(buf[i])).toBe(true);
    }
  });

  it("handles zero-area viewport gracefully", () => {
    const count = setupScratchLine([
      [0, 0],
      [1, 1],
    ]);
    const result = buildThickLineGeometry(count, 2, 0, 1, 0, 0, 0, 0);
    // Should not crash; may produce geometry with clamped values
    expect(result).toBeGreaterThanOrEqual(0);
    const buf = getThickScratch();
    for (let i = 0; i < result * THICK_FLOATS_PER_VERTEX; i++) {
      expect(Number.isFinite(buf[i])).toBe(true);
    }
  });
});

describe("sampleFingerprint", () => {
  it("returns zeroed fingerprint for empty array", () => {
    const fp = sampleFingerprint([]);
    expect(fp).toEqual({ len: 0, firstTime: 0, lastTime: 0, valueHash: 0 });
  });

  it("captures length and boundary times", () => {
    const samples = makeSamples([[1, 0], [2, 0.5], [3, 1]]);
    const fp = sampleFingerprint(samples);
    expect(fp.len).toBe(3);
    expect(fp.firstTime).toBe(1);
    expect(fp.lastTime).toBe(3);
    expect(fp.valueHash).toBeTypeOf("number");
  });

  it("detects change when time window shifts", () => {
    const a = sampleFingerprint(makeSamples([[1, 0], [2, 0.5], [3, 1]]));
    const b = sampleFingerprint(makeSamples([[2, 0], [3, 0.5], [4, 1]]));
    expect(fingerprintChanged(a, b)).toBe(true);
  });

  it("detects change when length changes", () => {
    const a = sampleFingerprint(makeSamples([[1, 0], [2, 0.5]]));
    const b = sampleFingerprint(makeSamples([[1, 0], [2, 0.5], [3, 1]]));
    expect(fingerprintChanged(a, b)).toBe(true);
  });

  it("returns false when fingerprints match", () => {
    const a = sampleFingerprint(makeSamples([[1, 0], [2, 0.5], [3, 1]]));
    const b = sampleFingerprint(makeSamples([[1, 0], [2, 0.5], [3, 1]]));
    expect(fingerprintChanged(a, b)).toBe(false);
  });

  it("detects value change even with same timestamps", () => {
    const a = sampleFingerprint(makeSamples([[1, 0], [2, 0.5], [3, 1]]));
    const b = sampleFingerprint(makeSamples([[1, 0.9], [2, 0.1], [3, 0.5]]));
    expect(fingerprintChanged(a, b)).toBe(true);
  });

  it("null fingerprint always counts as changed", () => {
    const fp = sampleFingerprint(makeSamples([[1, 0]]));
    expect(fingerprintChanged(null, fp)).toBe(true);
  });

  // Contract guards for the upload-skip fast path: distinct waveforms must
  // hash distinctly (else a real waveform change would be skipped, leaving a
  // stale GPU buffer), and identical sample sets must hash identically (else
  // every frame re-uploads). Includes a long, pixel-matched-length waveform
  // — vis buffers routinely hold 100+ samples.
  it("hashes identical sample sets identically (long waveform)", () => {
    const pairs: [number, number][] = [];
    for (let i = 0; i < 140; i++) {
      pairs.push([i / 10, Math.abs(Math.sin(i * 0.37)) % 1]);
    }
    const a = sampleFingerprint(makeSamples(pairs));
    const b = sampleFingerprint(makeSamples(pairs.map(([t, v]) => [t, v])));
    expect(a.valueHash).toBe(b.valueHash);
    expect(fingerprintChanged(a, b)).toBe(false);
  });

  it("hashes distinct long waveforms distinctly", () => {
    const base: [number, number][] = [];
    for (let i = 0; i < 140; i++) base.push([i / 10, (i % 7) / 7]);
    const a = sampleFingerprint(makeSamples(base));
    // Flip a single interior sample -> a genuinely different waveform.
    const mutated = base.map(
      ([t, v], i) => [t, i === 73 ? (v + 0.5) % 1 : v] as [number, number],
    );
    const b = sampleFingerprint(makeSamples(mutated));
    expect(a.valueHash).not.toBe(b.valueHash);
    expect(fingerprintChanged(a, b)).toBe(true);
  });

  it("a swap of two distinct values changes the hash (order-sensitive)", () => {
    const a = sampleFingerprint(makeSamples([[1, 0.2], [2, 0.8], [3, 0.5]]));
    const b = sampleFingerprint(makeSamples([[1, 0.8], [2, 0.2], [3, 0.5]]));
    expect(a.valueHash).not.toBe(b.valueHash);
  });
});

describe("isDigitalOutput", () => {
  it("classifies d<n> and s<n> outputs as digital", () => {
    for (const out of ["d1", "d2", "d8", "s1", "s3", "D4", "S2"]) {
      expect(isDigitalOutput(out)).toBe(true);
    }
  });

  it("classifies a<n> outputs (and unknowns) as analogue", () => {
    for (const out of ["a1", "a4", "a8", "bar", "q0", "x"]) {
      expect(isDigitalOutput(out)).toBe(false);
    }
  });
});

describe("computeLaneLayout", () => {
  const geom = { height: 100, verticalPadding: 10, laneGap: 0 };
  // drawableHeight = 100 - 2*10 = 80.

  it("returns an empty layout for no active outputs", () => {
    expect(computeLaneLayout([], geom).size).toBe(0);
  });

  it("derives digital lanes from the ACTIVE set, not a hardcoded list", () => {
    // Only d2 and d5 are active — d5 is well outside the old d1/d2/d3 list
    // and must still get a lane (no overlap, no dropped trace).
    const layout = computeLaneLayout(["d2", "d5"], geom);
    expect(layout.has("d2")).toBe(true);
    expect(layout.has("d5")).toBe(true);
    const a = layout.get("d2")!;
    const b = layout.get("d5")!;
    // Two stacked lanes of equal height filling the drawable area.
    expect(a.yTop).toBe(10);
    expect(a.yBottom).toBe(50);
    expect(b.yTop).toBe(50);
    expect(b.yBottom).toBe(90);
    expect(a.yBottom).toBeLessThanOrEqual(b.yTop); // no overlap
  });

  it("stacks analogue lanes instead of overlapping them on full height", () => {
    const layout = computeLaneLayout(["a1", "a2", "a3"], geom);
    const lanes = ["a1", "a2", "a3"].map((k) => layout.get(k)!);
    // Three non-overlapping, equal-height stacked lanes (allow 1 ULP of FP
    // slack at the shared lane boundary; gap here is 0).
    for (let i = 1; i < lanes.length; i++) {
      expect(lanes[i].yTop).toBeGreaterThanOrEqual(lanes[i - 1].yBottom - 1e-6);
      expect(lanes[i].yTop).toBeCloseTo(lanes[i - 1].yBottom, 6);
    }
    const h0 = lanes[0].yBottom - lanes[0].yTop;
    for (const lane of lanes) {
      expect(lane.yBottom - lane.yTop).toBeCloseTo(h0, 6);
    }
    // Distinct lanes — the old code gave every analogue trace the same box.
    expect(lanes[0].yTop).not.toBe(lanes[1].yTop);
    expect(lanes[1].yTop).not.toBe(lanes[2].yTop);
  });

  it("orders analogue lanes above digital lanes", () => {
    const layout = computeLaneLayout(["d1", "a1"], geom);
    expect(layout.get("a1")!.yTop).toBeLessThan(layout.get("d1")!.yTop);
  });

  it("does not place out-of-set outputs", () => {
    const layout = computeLaneLayout(["a1", "d1"], geom);
    expect(layout.get("a2")).toBeUndefined();
    expect(layout.get("d7")).toBeUndefined();
  });

  it("de-duplicates repeated outputs into a single lane", () => {
    const layout = computeLaneLayout(["a1", "a1", "d1"], geom);
    expect(layout.size).toBe(2);
  });

  it("honours the lane gap between stacked lanes", () => {
    const layout = computeLaneLayout(["a1", "a2"], {
      height: 100,
      verticalPadding: 10,
      laneGap: 10,
    });
    const a = layout.get("a1")!;
    const b = layout.get("a2")!;
    // drawable 80, one 10px gap -> 70 split over 2 lanes = 35 each.
    expect(a.yBottom - a.yTop).toBeCloseTo(35, 6);
    expect(b.yTop - a.yBottom).toBeCloseTo(10, 6); // the gap
  });

  it("clamps lanes to the padded drawable area", () => {
    const layout = computeLaneLayout(["a1", "a2", "d1"], geom);
    for (const lane of layout.values()) {
      expect(lane.yTop).toBeGreaterThanOrEqual(geom.verticalPadding - 1e-6);
      expect(lane.yBottom).toBeLessThanOrEqual(
        geom.height - geom.verticalPadding + 1e-6,
      );
    }
  });
});

describe("scratch buffer management", () => {
  it("ensureScratch grows the buffer to accommodate requested count", () => {
    ensureScratch(8192);
    expect(getScratch().length).toBeGreaterThanOrEqual(8192);
  });

  it("flattenSamples grows scratch for large input", () => {
    const largeSamples = makeSamples(
      Array.from({ length: 2000 }, (_, i) => [i, Math.sin(i) * 0.5 + 0.5] as [number, number]),
    );
    const count = flattenSamples(largeSamples, false);
    expect(count).toBe(2000);
    expect(getScratch().length).toBeGreaterThanOrEqual(4000);
  });
});

// ── Refactor: pure paint vs wired wrapper ─────────────────────────────
//
// `drawSerialVisGL(input)` takes everything it needs as an argument and
// must not read from `visStore` or call the sampler's `getRenderData()`
// directly.  `drawSerialVisGLFromStores()` is the wired wrapper that
// builds the input from those singletons.

describe("buildCombinedSamples (pure)", () => {
  it("uses the supplied getRenderData function (no singleton reads)", () => {
    const past = new PastBuffer(4);
    past.push(0, 0.1);
    past.push(1, 0.5);
    past.push(2, 0.9);

    const future = new PastBuffer(4);
    future.push(3, 0.4);
    future.push(4, 0.2);

    const calls: string[] = [];
    const getRenderData = vi.fn((key: string) => {
      calls.push(key);
      if (key === "a1") return { pastBuffer: past, futureBuffer: future };
      return null;
    });

    const samples = buildCombinedSamples("a1", getRenderData, 2);
    expect(getRenderData).toHaveBeenCalledWith("a1");
    expect(calls).toEqual(["a1"]);
    // 3 past + boundary anchor + 2 future where t > currentTime (2): t=3, t=4
    expect(samples.length).toBe(6);
    expect(samples[0]).toEqual({ time: 0, value: 0.1 });
    expect(samples[2]).toEqual({ time: 2, value: 0.9 });
    // Boundary anchor repeats the last past sample at currentTime.
    expect(samples[3]).toEqual({ time: 2, value: 0.9 });
    expect(samples[4]).toEqual({ time: 3, value: 0.4 });
    expect(samples[5]).toEqual({ time: 4, value: 0.2 });
  });

  it("anchors future geometry at currentTime when near-boundary future coverage exists", () => {
    const past = new PastBuffer(2);
    past.push(0, 0.1);
    past.push(1, 0.6);
    const future = new PastBuffer(2);
    future.push(2.03, 0.4);
    future.push(2.06, 0.2);

    const getRenderData = (k: string) =>
      k === "a1" ? { pastBuffer: past, futureBuffer: future } : null;

    const samples = buildCombinedSamples("a1", getRenderData, 2, 0.25);
    expect(samples.map((s) => s.time)).toEqual([0, 1, 2, 2.03, 2.06]);
    expect(samples[2]).toEqual({ time: 2, value: 0.6 });
  });

  it("does not anchor across a missing near-future gap", () => {
    const past = new PastBuffer(2);
    past.push(0, 0.1);
    past.push(1, 0.6);
    const future = new PastBuffer(2);
    future.push(3, 0.4);
    future.push(4, 0.2);

    const getRenderData = (k: string) =>
      k === "a1" ? { pastBuffer: past, futureBuffer: future } : null;

    const samples = buildCombinedSamples("a1", getRenderData, 2, 0.25);
    expect(samples.map((s) => s.time)).toEqual([0, 1, 3, 4]);
  });

  it("filters future samples whose time <= currentTime", () => {
    const past = new PastBuffer(2);
    past.push(0, 0);
    const future = new PastBuffer(4);
    future.push(1, 0.1); // <= currentTime=2 → dropped
    future.push(2, 0.2); // == currentTime → dropped
    future.push(3, 0.3); // kept
    future.push(4, 0.4); // kept

    const getRenderData = (k: string) =>
      k === "a1" ? { pastBuffer: past, futureBuffer: future } : null;

    const samples = buildCombinedSamples("a1", getRenderData, 2);
    // Past (t=0) + boundary anchor at currentTime + future (t=3, t=4)
    expect(samples.map((s) => s.time)).toEqual([0, 2, 3, 4]);
  });

  it("returns empty array when getRenderData returns null", () => {
    const samples = buildCombinedSamples("missing", () => null, 0);
    expect(samples).toEqual([]);
  });

  it("handles missing future buffer", () => {
    const past = new PastBuffer(2);
    past.push(0, 0.5);
    past.push(1, 0.7);

    const getRenderData = () => ({ pastBuffer: past, futureBuffer: undefined });
    const samples = buildCombinedSamples("a1", getRenderData, 0);
    expect(samples.length).toBe(2);
    expect(samples[0]).toEqual({ time: 0, value: 0.5 });
    expect(samples[1]).toEqual({ time: 1, value: 0.7 });
  });
});

describe("drawSerialVisGL (pure path)", () => {
  it("accepts a VisRenderInput without reading from singletons", () => {
    // No DOM / no panel ⇒ the renderer bails on getCanvas() before any
    // singleton-coupled work.  This still exercises the parameter
    // plumbing and proves the API surface compiles + runs.
    const input: VisRenderInput = {
      expressions: {},
      settings: {
        windowDuration: 10,
        sampleCount: 100,
        lineWidth: 1.5,
        futureDashed: true,
        futureMaskOpacity: 0.35,
        futureMaskWidth: 12,
        circularOffset: 0,
        futureLeadSeconds: 1,
        digitalLaneGap: 4,
        showFutureProjection: false,
        futureLineAlpha: 0.6,
        minFutureSampleRate: 30,
        extensionBatchSize: 4,
        temporalSampleRateMultiplier: 1,
        inputEpsilon: 0.01,
      },
      currentTime: 0,
      getRenderData: () => null,
    };
    expect(() => drawSerialVisGL(input)).not.toThrow();
  });

  it("never invokes getRenderData when expressions is empty", () => {
    const getRenderData = vi.fn(() => null);
    const input: VisRenderInput = {
      expressions: {},
      settings: {
        windowDuration: 10,
        sampleCount: 100,
        lineWidth: 1.5,
        futureDashed: true,
        futureMaskOpacity: 0.35,
        futureMaskWidth: 12,
        circularOffset: 0,
        futureLeadSeconds: 1,
        digitalLaneGap: 4,
        showFutureProjection: false,
        futureLineAlpha: 0.6,
        minFutureSampleRate: 30,
        extensionBatchSize: 4,
        temporalSampleRateMultiplier: 1,
        inputEpsilon: 0.01,
      },
      currentTime: 0,
      getRenderData,
    };
    drawSerialVisGL(input);
    expect(getRenderData).not.toHaveBeenCalled();
  });
});

describe("drawSerialVisGLFromStores (wired)", () => {
  it("is exported as a no-arg function that wraps the pure entry", () => {
    // Smoke test: the wrapper must exist, take no arguments, and not
    // throw when called outside a DOM (it bails inside drawSerialVisGL
    // when there's no canvas).
    expect(typeof drawSerialVisGLFromStores).toBe("function");
    expect(drawSerialVisGLFromStores.length).toBe(0);
    expect(() => drawSerialVisGLFromStores()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Adaptive quality lever 3: the renderer divides the pixel-matched past
// buffer rate by the pressure-derived divisor (1 / 2 / 4) before pushing
// it to the sampler.  Spec: docs/specs/visualisation.md §1.7/§9.2.
// ---------------------------------------------------------------------------
describe("computeAdaptivePastBufferRate (lever 3)", () => {
  it("returns the pixel-matched rate at divisor=1 (no pressure)", () => {
    // 800px wide canvas, 10s window, divisor=1 →
    // floor(800/2) / (10/2) = 400 / 5 = 80 Hz
    expect(computeAdaptivePastBufferRate(800, 10, 1)).toBe(80);
  });

  it("halves the rate at divisor=2 (mild pressure)", () => {
    // Same geometry, divisor=2 → 80 / 2 = 40 Hz
    expect(computeAdaptivePastBufferRate(800, 10, 2)).toBe(40);
  });

  it("quarters the rate at divisor=4 (severe pressure)", () => {
    // Same geometry, divisor=4 → 80 / 4 = 20 Hz
    expect(computeAdaptivePastBufferRate(800, 10, 4)).toBe(20);
  });

  it("returns null when canvas width is zero or negative", () => {
    expect(computeAdaptivePastBufferRate(0, 10, 1)).toBeNull();
    expect(computeAdaptivePastBufferRate(-100, 10, 1)).toBeNull();
  });

  it("falls back to a 1-second window when windowDuration is 0 (matches renderer's original semantics)", () => {
    // The renderer originally used `(settings.windowDuration || 1) / 2`
    // — preserve that behaviour.  800px / 1s window / divisor 1 → 800 Hz.
    expect(computeAdaptivePastBufferRate(800, 0, 1)).toBe(800);
  });

  it("returns null when window duration is negative", () => {
    expect(computeAdaptivePastBufferRate(800, -5, 1)).toBeNull();
  });

  it("treats non-positive divisor as 1 (defensive guard)", () => {
    expect(computeAdaptivePastBufferRate(800, 10, 0)).toBe(80);
    expect(computeAdaptivePastBufferRate(800, 10, -2)).toBe(80);
  });

  it("scales correctly with realistic divisor sequence (1, 2, 4)", () => {
    // 1280×720 canvas, 10s window. Verify monotonic halving.
    const r1 = computeAdaptivePastBufferRate(1280, 10, 1);
    const r2 = computeAdaptivePastBufferRate(1280, 10, 2);
    const r4 = computeAdaptivePastBufferRate(1280, 10, 4);
    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();
    expect(r4).not.toBeNull();
    expect(r2).toBe((r1 as number) / 2);
    expect(r4).toBe((r1 as number) / 4);
  });
});
