import { describe, expect, it } from "vitest";

import {
  PRODUCER_LIVENESS_ADVANCE,
  PRODUCER_LIVENESS_ADVANCE_UNDERRUN,
  PRODUCER_LIVENESS_HOLD,
  PRODUCER_LIVENESS_RESET,
  planProducerLiveness,
  planWorkletGraph,
  shouldEnterProducerTimeout,
} from "./workletTransitionPlanning";

describe("worklet graph transition planning", () => {
  it("orders dependencies stably and marks only consumed sources non-terminal", () => {
    const plan = planWorkletGraph(4, [
      { source: 0, target: 2 },
      { source: 1, target: 2 },
      { source: 2, target: 3 },
    ]);
    expect(plan.order).toEqual([0, 1, 2, 3]);
    expect(plan.consumed).toEqual([true, true, true, false]);
  });

  it("keeps cyclic remainder in insertion order", () => {
    const plan = planWorkletGraph(3, [
      { source: 1, target: 2 },
      { source: 2, target: 1 },
    ]);
    expect(plan.order).toEqual([0, 1, 2]);
    expect(plan.consumed).toEqual([false, true, true]);
  });

  it("ignores invalid and self edges", () => {
    expect(planWorkletGraph(2, [
      { source: 0, target: 0 },
      { source: -1, target: 1 },
      { source: 0, target: 4 },
    ])).toEqual({ order: [0, 1], consumed: [false, false] });
  });
});

describe("producer liveness transition planning", () => {
  it("distinguishes fresh, underrun, detached, and bring-up observations", () => {
    expect(planProducerLiveness(true, true, false, true))
      .toBe(PRODUCER_LIVENESS_RESET);
    expect(planProducerLiveness(true, false, true, true))
      .toBe(PRODUCER_LIVENESS_ADVANCE_UNDERRUN);
    expect(planProducerLiveness(false, false, true, true))
      .toBe(PRODUCER_LIVENESS_ADVANCE);
    expect(planProducerLiveness(true, false, false, true))
      .toBe(PRODUCER_LIVENESS_HOLD);
    expect(planProducerLiveness(false, false, false, false))
      .toBe(PRODUCER_LIVENESS_HOLD);
  });

  it("enters timeout exactly once at the age or termination boundary", () => {
    expect(shouldEnterProducerTimeout(false, 7, 8, false)).toBe(false);
    expect(shouldEnterProducerTimeout(false, 8, 8, false)).toBe(true);
    expect(shouldEnterProducerTimeout(false, 0, 8, true)).toBe(true);
    expect(shouldEnterProducerTimeout(true, 8, 8, true)).toBe(false);
  });
});
