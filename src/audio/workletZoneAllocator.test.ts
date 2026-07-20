/**
 * Unit tests for the host-owned shared-memory zone allocator
 * (synthesis epic M2.1, ergo 9a9370af).
 *
 * Normative contract (`synthesis.md` §2.3, §3.5):
 *   - the host owns a single WASM linear memory with a zone allocator;
 *   - per-instance DSP state and audio I/O buffers are host-allocated
 *     zones;
 *   - the arena is bounded (`SYNTH_MEMORY_MAX_BYTES`); zone exhaustion
 *     is a diagnostic, never unbounded growth;
 *   - released zones are reclaimable (retire-sweep releases, the next
 *     instantiate reuses).
 *
 * The allocator is pure (no WebAssembly dependency) so it runs in
 * Vitest unchanged; the worklet shell wires it over the real
 * `WebAssembly.Memory`.
 */
import { describe, expect, it } from "vitest";

import {
  SYNTH_ARENA_NULL_GUARD_BYTES,
  SYNTH_MEMORY_MAX_BYTES,
} from "../contracts/synthesisControlAbi";
import { createZoneAllocator } from "./workletZoneAllocator";

describe("workletZoneAllocator — allocation basics", () => {
  it("never returns pointer 0 (null-sentinel guard)", () => {
    const alloc = createZoneAllocator({ limitBytes: 4096 });
    const ptr = alloc.allocate(8, 8);
    expect(ptr).toBeGreaterThan(0);
    expect(ptr).toBeGreaterThanOrEqual(SYNTH_ARENA_NULL_GUARD_BYTES);
  });

  it("respects the requested alignment", () => {
    const alloc = createZoneAllocator({ limitBytes: 65536 });
    // Mixed-size allocations with varying alignments must all come back
    // aligned.
    const p1 = alloc.allocate(3, 1);
    const p2 = alloc.allocate(24, 8);
    const p3 = alloc.allocate(100, 16);
    const p4 = alloc.allocate(8, 64);
    expect(p2 % 8).toBe(0);
    expect(p3 % 16).toBe(0);
    expect(p4 % 64).toBe(0);
    // All distinct and non-overlapping.
    const zones = [
      [p1, 3],
      [p2, 24],
      [p3, 100],
      [p4, 8],
    ] as const;
    for (let i = 0; i < zones.length; i++) {
      for (let j = i + 1; j < zones.length; j++) {
        const [a, aLen] = zones[i];
        const [b, bLen] = zones[j];
        const overlap = a < b + bLen && b < a + aLen;
        expect(overlap).toBe(false);
      }
    }
  });

  it("returns -1 on exhaustion instead of growing or throwing", () => {
    const alloc = createZoneAllocator({ limitBytes: 256 });
    // The null guard eats the low bytes; a request larger than the
    // remaining arena must fail with -1.
    const ptr = alloc.allocate(1024, 8);
    expect(ptr).toBe(-1);
  });

  it("bounds the arena by limitBytes even for many small allocations", () => {
    const alloc = createZoneAllocator({ limitBytes: 1024 });
    let count = 0;
    for (;;) {
      const ptr = alloc.allocate(64, 8);
      if (ptr === -1) break;
      expect(ptr + 64).toBeLessThanOrEqual(1024);
      count += 1;
      if (count > 64) throw new Error("allocator exceeded its bound");
    }
    expect(count).toBeGreaterThan(0);
  });
});

describe("workletZoneAllocator — release and reuse", () => {
  it("reuses a released zone for a subsequent allocation", () => {
    const alloc = createZoneAllocator({ limitBytes: 4096 });
    const a = alloc.allocate(512, 8);
    const b = alloc.allocate(512, 8);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(0);
    alloc.release(a);
    const c = alloc.allocate(512, 8);
    // The freed zone is reclaimed (first-fit returns the lowest fit).
    expect(c).toBe(a);
  });

  it("coalesces adjacent freed zones so a larger allocation fits", () => {
    // Arena sized so that two 512-byte zones plus the guard fill it.
    const limit = SYNTH_ARENA_NULL_GUARD_BYTES + 1024;
    const alloc = createZoneAllocator({ limitBytes: limit });
    const a = alloc.allocate(512, 8);
    const b = alloc.allocate(512, 8);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(0);
    // Nothing left for a 1024-byte zone.
    expect(alloc.allocate(1024, 8)).toBe(-1);
    // Release both; coalescing must make the full kilobyte available.
    alloc.release(a);
    alloc.release(b);
    const c = alloc.allocate(1024, 8);
    expect(c).toBe(a);
  });

  it("tolerates releasing an unknown pointer without corrupting state", () => {
    const alloc = createZoneAllocator({ limitBytes: 4096 });
    const a = alloc.allocate(256, 8);
    expect(() => alloc.release(123456)).not.toThrow();
    expect(() => alloc.release(-1)).not.toThrow();
    // Double release is also tolerated.
    alloc.release(a);
    expect(() => alloc.release(a)).not.toThrow();
    // The arena still functions.
    const b = alloc.allocate(256, 8);
    expect(b).toBeGreaterThan(0);
  });

  it("accounts allocated bytes across allocate/release cycles", () => {
    const alloc = createZoneAllocator({ limitBytes: 8192 });
    expect(alloc.allocatedBytes()).toBe(0);
    const a = alloc.allocate(1000, 8);
    expect(alloc.allocatedBytes()).toBe(1000);
    const b = alloc.allocate(500, 8);
    expect(alloc.allocatedBytes()).toBe(1500);
    alloc.release(a);
    expect(alloc.allocatedBytes()).toBe(500);
    alloc.release(b);
    expect(alloc.allocatedBytes()).toBe(0);
  });
});

describe("workletZoneAllocator — contract bounds", () => {
  it("defaults its base offset to the null guard", () => {
    const alloc = createZoneAllocator({ limitBytes: 4096 });
    expect(alloc.baseOffset).toBe(SYNTH_ARENA_NULL_GUARD_BYTES);
  });

  it("accepts the full SYNTH_MEMORY_MAX_BYTES bound", () => {
    const alloc = createZoneAllocator({ limitBytes: SYNTH_MEMORY_MAX_BYTES });
    const ptr = alloc.allocate(64 * 1024, 8);
    expect(ptr).toBeGreaterThan(0);
  });
});
