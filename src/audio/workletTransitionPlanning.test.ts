import { describe, expect, it } from "vitest";

import {
  PRODUCER_LIVENESS_ADVANCE,
  PRODUCER_LIVENESS_ADVANCE_UNDERRUN,
  PRODUCER_LIVENESS_HOLD,
  PRODUCER_LIVENESS_RESET,
  planProducerLiveness,
  shouldEnterProducerTimeout,
} from "./workletTransitionPlanning";

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
