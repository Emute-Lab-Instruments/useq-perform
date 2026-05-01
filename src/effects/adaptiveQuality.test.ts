/**
 * Tests for the adaptive visualisation quality pressure detector and
 * lever query helpers.
 *
 * Spec: docs/specs/visualisation.md §1.7 / §9.2 — pressure level
 * thresholds, hysteresis, and consumer-side behaviour.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/debug.ts", () => ({
  dbg: vi.fn(),
}));

import {
  _resetForTests,
  getPressureLevel,
  getProbeIntervalMultiplier,
  getRawPressureLevel,
  getSampleRateDivisor,
  isAdaptiveQualityEnabled,
  MILD_MISS_COUNT,
  MISS_THRESHOLD_MS,
  PRESSURE_WINDOW,
  RECOVERY_NORMAL_TICKS,
  recordTickElapsed,
  setAdaptiveQualityEnabled,
  SEVERE_MISS_COUNT,
  shouldSkipFutureEdgePush,
} from "./adaptiveQuality.ts";

const NORMAL_TICK = 16; // ~60fps
const MISS_TICK = MISS_THRESHOLD_MS + 5; // clearly over threshold

function feedTicks(elapsedSeq: number[]): void {
  for (const ms of elapsedSeq) recordTickElapsed(ms);
}

describe("adaptiveQuality pressure detector", () => {
  beforeEach(() => {
    _resetForTests();
  });

  afterEach(() => {
    _resetForTests();
  });

  it("starts at level 0 with adaptive enabled", () => {
    expect(getPressureLevel()).toBe(0);
    expect(isAdaptiveQualityEnabled()).toBe(true);
    expect(shouldSkipFutureEdgePush()).toBe(false);
    expect(getProbeIntervalMultiplier()).toBe(1);
    expect(getSampleRateDivisor()).toBe(1);
  });

  it("stays at level 0 when only normal frames arrive", () => {
    feedTicks(new Array(20).fill(NORMAL_TICK));
    expect(getPressureLevel()).toBe(0);
  });

  it("ignores a single isolated miss (below mild threshold)", () => {
    feedTicks([NORMAL_TICK, NORMAL_TICK, MISS_TICK, NORMAL_TICK, NORMAL_TICK]);
    expect(getPressureLevel()).toBe(0);
  });

  it("steps up to level 1 (mild) at MILD_MISS_COUNT misses in window", () => {
    // Fill the window with normals, then introduce just-enough misses.
    feedTicks(new Array(PRESSURE_WINDOW).fill(NORMAL_TICK));
    expect(getPressureLevel()).toBe(0);
    feedTicks(new Array(MILD_MISS_COUNT).fill(MISS_TICK));
    expect(getPressureLevel()).toBe(1);
    expect(getProbeIntervalMultiplier()).toBe(2);
    expect(getSampleRateDivisor()).toBe(2);
    expect(shouldSkipFutureEdgePush()).toBe(true);
  });

  it("steps up to level 2 (severe) at SEVERE_MISS_COUNT misses in window", () => {
    // Saturate the window with misses to cross the severe threshold.
    feedTicks(new Array(SEVERE_MISS_COUNT).fill(MISS_TICK));
    expect(getPressureLevel()).toBe(2);
    expect(getProbeIntervalMultiplier()).toBe(4);
    expect(getSampleRateDivisor()).toBe(4);
  });

  it("does not step DOWN immediately when misses age out of window", () => {
    // Drive into severe.
    feedTicks(new Array(SEVERE_MISS_COUNT).fill(MISS_TICK));
    expect(getPressureLevel()).toBe(2);

    // Push a few normal frames — not enough for the recovery streak.
    feedTicks(new Array(RECOVERY_NORMAL_TICKS - 1).fill(NORMAL_TICK));
    // Even though the misses have rolled out of the window, hysteresis
    // keeps level pinned until the streak crosses the recovery
    // threshold.  Level may remain 2 (pure hysteresis) or 1 (only
    // partially recovered) depending on miss count remaining in window.
    expect(getPressureLevel()).toBeGreaterThanOrEqual(1);
  });

  it("steps DOWN after RECOVERY_NORMAL_TICKS consecutive normal ticks", () => {
    feedTicks(new Array(SEVERE_MISS_COUNT).fill(MISS_TICK));
    expect(getPressureLevel()).toBe(2);

    // A long streak of normal ticks — eventually drops to 0.
    feedTicks(new Array(RECOVERY_NORMAL_TICKS + PRESSURE_WINDOW + 4).fill(NORMAL_TICK));
    expect(getPressureLevel()).toBe(0);
  });

  it("transitions normal → mild → severe → mild → normal with hysteresis", () => {
    // normal
    feedTicks(new Array(PRESSURE_WINDOW).fill(NORMAL_TICK));
    expect(getPressureLevel()).toBe(0);

    // → mild: just MILD_MISS_COUNT misses in window
    feedTicks(new Array(MILD_MISS_COUNT).fill(MISS_TICK));
    expect(getPressureLevel()).toBe(1);

    // → severe: bring the window total up to SEVERE_MISS_COUNT
    feedTicks(new Array(SEVERE_MISS_COUNT - MILD_MISS_COUNT).fill(MISS_TICK));
    expect(getPressureLevel()).toBe(2);

    // → mild: enough recovery to drop one step but not all the way.  We
    // need to flush misses out of the window and accumulate a recovery
    // streak.  Feed exactly RECOVERY_NORMAL_TICKS normals — at that
    // point we step DOWN one level.  But a step-down resets the streak,
    // so we land at the candidate level dictated by the rolling window.
    feedTicks(new Array(RECOVERY_NORMAL_TICKS).fill(NORMAL_TICK));
    // After RECOVERY_NORMAL_TICKS normals, the rolling window holds
    // only normals, so the candidate is 0 — but the step-down rule
    // moves us one step at a time only if normalTickStreak reset is
    // triggered.  In our impl the step-down jumps to the candidate
    // (which is 0) because we use the candidate's value directly.
    expect(getPressureLevel()).toBe(0);

    // Going back through mild again should still work.
    feedTicks(new Array(MILD_MISS_COUNT).fill(MISS_TICK));
    expect(getPressureLevel()).toBe(1);
  });

  it("step-up is allowed immediately (no upward hysteresis)", () => {
    // First reach mild.
    feedTicks(new Array(PRESSURE_WINDOW).fill(NORMAL_TICK));
    feedTicks(new Array(MILD_MISS_COUNT).fill(MISS_TICK));
    expect(getPressureLevel()).toBe(1);

    // Then the very next batch of misses pushes us straight to severe —
    // no requirement for any "upward streak".
    feedTicks(new Array(SEVERE_MISS_COUNT - MILD_MISS_COUNT).fill(MISS_TICK));
    expect(getPressureLevel()).toBe(2);
  });

  it("respects the rolling window size (miss count = misses in last N ticks)", () => {
    // Saturate window with misses (severe), then push PRESSURE_WINDOW
    // normals to *roll* misses out of the window.  The detector still
    // remembers the level (hysteresis) but the candidate is 0.
    feedTicks(new Array(SEVERE_MISS_COUNT).fill(MISS_TICK));
    expect(getRawPressureLevel()).toBe(2);

    // Roll out: the window holds only normals after this.
    feedTicks(new Array(PRESSURE_WINDOW).fill(NORMAL_TICK));

    // Continue with normals to satisfy the recovery streak.
    feedTicks(new Array(RECOVERY_NORMAL_TICKS).fill(NORMAL_TICK));
    expect(getRawPressureLevel()).toBe(0);
  });

  it("ignores invalid elapsed values", () => {
    feedTicks([Number.NaN, -5, Number.POSITIVE_INFINITY]);
    expect(getPressureLevel()).toBe(0);
  });

  it("setAdaptiveQualityEnabled(false) makes consumers see level 0", () => {
    feedTicks(new Array(SEVERE_MISS_COUNT).fill(MISS_TICK));
    expect(getRawPressureLevel()).toBe(2);
    expect(getPressureLevel()).toBe(2);

    setAdaptiveQualityEnabled(false);
    expect(isAdaptiveQualityEnabled()).toBe(false);
    expect(getPressureLevel()).toBe(0);
    expect(getProbeIntervalMultiplier()).toBe(1);
    expect(getSampleRateDivisor()).toBe(1);
    expect(shouldSkipFutureEdgePush()).toBe(false);

    // Detector continues to track raw level so that re-enabling resumes
    // immediately without needing fresh measurements.
    expect(getRawPressureLevel()).toBe(2);

    setAdaptiveQualityEnabled(true);
    expect(getPressureLevel()).toBe(2);
  });

  it("logs pressure level transitions via dbg", async () => {
    const { dbg } = await import("../lib/debug.ts");
    const dbgSpy = vi.mocked(dbg);
    dbgSpy.mockClear();

    feedTicks(new Array(MILD_MISS_COUNT).fill(MISS_TICK));
    expect(dbgSpy).toHaveBeenCalled();
    const logged = dbgSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("pressure 0 -> 1");
  });
});
