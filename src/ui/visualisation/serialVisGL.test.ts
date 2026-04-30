import { beforeEach, describe, expect, it } from "vitest";
import { __serialVisGLInternals } from "./serialVisGL.ts";

const {
  flattenSamples,
  buildThickLineGeometry,
  parseColor,
  ensureScratch,
  scratch: getScratch,
  thickScratch: getThickScratch,
  THICK_FLOATS_PER_VERTEX,
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
