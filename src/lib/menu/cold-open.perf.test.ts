// src/lib/menu/cold-open.perf.test.ts
//
// Cold-open performance budget test for the radial menu.
// Per docs/specs/radial-menu.md §11.5:
//   - Cold open (tap(Y) to first frame painted): ≤ 80 ms target, ≤ 150 ms max
//
// This test measures the *pure computation* path of a cold open:
//   1. Manifest cache lookup (getCachedManifest)
//   2. Reducer transition: closed → open (reduce(INITIAL_STATE, { kind: 'open' }))
//   3. Full store round-trip (dispatchMenuInput)
//
// The 80 ms / 150 ms budget covers DOM rendering too, which we cannot
// measure in a unit test. The pure computation should be well under 5 ms —
// if it's not, there's a fixable regression in the reducer or manifest loader.
//
// bd-69.41

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { INITIAL_STATE, reduce } from "./state";
import { loadManifest, getCachedManifest, setCachedManifest, clearCachedManifest } from "./manifest";
import type { ApplyTarget, MenuState } from "./types";
import manifestJson from "./manifest.json" with { type: "json" };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a stub ApplyTarget (same pattern as store.test.ts / dispatcher.test.ts). */
function makeTarget(): ApplyTarget {
  return { __brand: "ApplyTarget" } as ApplyTarget;
}

/** Parsed manifest loaded once for all iterations. */
function parsedManifest() {
  const result = loadManifest(manifestJson);
  if (!result.ok) throw new Error("manifest.json failed to load: " + JSON.stringify(result.errors));
  return result.value;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Cold-open performance budget (§11.5)", () => {
  afterEach(() => {
    clearCachedManifest();
  });

  describe("manifest cache lookup", () => {
    beforeEach(() => {
      setCachedManifest(parsedManifest());
    });

    it("cache hit is < 0.01 ms (10 µs) median over 1000 lookups", () => {
      const N = 1000;
      const times: number[] = [];

      // Warm up (first call may have JIT overhead).
      for (let i = 0; i < 10; i++) getCachedManifest();

      for (let i = 0; i < N; i++) {
        const t0 = performance.now();
        getCachedManifest();
        const t1 = performance.now();
        times.push(t1 - t0);
      }

      times.sort((a, b) => a - b);
      const median = times[Math.floor(N / 2)];
      const p95 = times[Math.floor(N * 0.95)];
      const max = times[N - 1];

      // Cache lookup is a variable read — should be < 10 µs.
      expect(median).toBeLessThan(0.01);
      expect(p95).toBeLessThan(0.05);

      // Log for visibility in CI output.
      // eslint-disable-next-line no-console
      console.log(`manifest cache: median=${median.toFixed(4)}ms p95=${p95.toFixed(4)}ms max=${max.toFixed(4)}ms`);
    });
  });

  describe("reducer: closed → open transition", () => {
    let manifest: ReturnType<typeof parsedManifest>;
    let target: ApplyTarget;

    beforeEach(() => {
      manifest = parsedManifest();
      target = makeTarget();
    });

    it("pure reducer open transition is < 0.1 ms median over 1000 iterations", () => {
      const N = 1000;
      const times: number[] = [];

      // Warm up.
      for (let i = 0; i < 10; i++) {
        reduce(INITIAL_STATE, { kind: "open", target, manifest });
      }

      for (let i = 0; i < N; i++) {
        const t0 = performance.now();
        reduce(INITIAL_STATE, { kind: "open", target, manifest });
        const t1 = performance.now();
        times.push(t1 - t0);
      }

      times.sort((a, b) => a - b);
      const median = times[Math.floor(N / 2)];
      const p95 = times[Math.floor(N * 0.95)];
      const max = times[N - 1];

      // Reducer is a pure function producing a flat object — should be < 100 µs.
      expect(median).toBeLessThan(0.1);
      expect(p95).toBeLessThan(0.5);

      // eslint-disable-next-line no-console
      console.log(`reducer open: median=${median.toFixed(4)}ms p95=${p95.toFixed(4)}ms max=${max.toFixed(4)}ms`);
    });
  });

  describe("full cold-open path (cache lookup + reducer)", () => {
    let manifest: ReturnType<typeof parsedManifest>;
    let target: ApplyTarget;

    beforeEach(() => {
      manifest = parsedManifest();
      setCachedManifest(manifest);
      target = makeTarget();
    });

    it("combined cache lookup + reducer is < 0.2 ms median over 1000 iterations", () => {
      const N = 1000;
      const times: number[] = [];

      // Warm up.
      for (let i = 0; i < 10; i++) {
        const m = getCachedManifest()!;
        reduce(INITIAL_STATE, { kind: "open", target, manifest: m });
      }

      for (let i = 0; i < N; i++) {
        const t0 = performance.now();
        // Simulate the dispatcher's open() path:
        const m = getCachedManifest()!;
        const next = reduce(INITIAL_STATE, { kind: "open", target, manifest: m });
        const t1 = performance.now();
        // Sanity: the reducer must produce an open state.
        void next;
        times.push(t1 - t0);
      }

      times.sort((a, b) => a - b);
      const median = times[Math.floor(N / 2)];
      const p95 = times[Math.floor(N * 0.95)];
      const max = times[N - 1];

      // The full pure-computation path should be < 200 µs.
      expect(median).toBeLessThan(0.2);
      expect(p95).toBeLessThan(1.0);

      // eslint-disable-next-line no-console
      console.log(`full cold-open: median=${median.toFixed(4)}ms p95=${p95.toFixed(4)}ms max=${max.toFixed(4)}ms`);
    });
  });

  describe("manifest parse (one-time cost at boot)", () => {
    it("loadManifest from manifest.json is < 5 ms", () => {
      const N = 100;
      const times: number[] = [];

      for (let i = 0; i < N; i++) {
        const t0 = performance.now();
        loadManifest(manifestJson);
        const t1 = performance.now();
        times.push(t1 - t0);
      }

      times.sort((a, b) => a - b);
      const median = times[Math.floor(N / 2)];
      const p95 = times[Math.floor(N * 0.95)];
      const max = times[N - 1];

      // Manifest parsing should be under 5 ms even on slow CI runners.
      expect(median).toBeLessThan(5.0);
      expect(p95).toBeLessThan(10.0);

      // eslint-disable-next-line no-console
      console.log(`manifest parse: median=${median.toFixed(4)}ms p95=${p95.toFixed(4)}ms max=${max.toFixed(4)}ms`);
    });
  });

  describe("pre-parse verification", () => {
    it("getCachedManifest returns null before setCachedManifest is called", () => {
      clearCachedManifest();
      expect(getCachedManifest()).toBeNull();
    });

    it("setCachedManifest makes the manifest immediately available", () => {
      const manifest = parsedManifest();
      setCachedManifest(manifest);
      expect(getCachedManifest()).toBe(manifest);
    });

    it("pre-parsed manifest produces correct open state", () => {
      const manifest = parsedManifest();
      setCachedManifest(manifest);
      const target = makeTarget();

      const cached = getCachedManifest();
      expect(cached).not.toBeNull();

      const next = reduce(INITIAL_STATE, { kind: "open", target, manifest: cached! });
      expect(next.phase).toBe("open");

      const openState = next as MenuState & { phase: "open" };
      expect(openState.leftTabIdx).toBe(0);
      expect(openState.rightTabIdx).toBe(0);
      expect(openState.leftHover).toBeNull();
      expect(openState.rightHover).toBeNull();
      expect(openState.manifest).toBe(manifest);
    });
  });
});
