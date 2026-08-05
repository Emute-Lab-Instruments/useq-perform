import { describe, expect, it } from "vitest";

import {
  planProjection,
  PROJECTION_MODE_EXTEND,
  PROJECTION_MODE_NONE,
  PROJECTION_MODE_RESET_FILL,
  type ProjectionPlanInput,
} from "./visualisationProjectionPlan";

const base: ProjectionPlanInput = {
  timeSeconds: 10,
  futureEdge: 12,
  halfWindow: 2,
  guardBandSeconds: 0.25,
  projectFuture: true,
  noUserOutputs: false,
  futureInvalidated: false,
  allOutputsCoverBoundary: true,
  adaptiveSkipRequested: false,
  projectionFrontier: 12.5,
  futureDensityHz: 20,
  extensionBatchSize: 4,
};

describe("visualisation projection planning", () => {
  it("plans reset-fill for invalidation or missing boundary coverage", () => {
    const invalidated = planProjection({ ...base, futureInvalidated: true });
    expect(invalidated.request.mode).toBe(PROJECTION_MODE_RESET_FILL);
    expect(invalidated.request.sampleCount).toBe(40);
    expect(invalidated.boundaryForcedReset).toBe(false);

    const uncovered = planProjection({
      ...base,
      allOutputsCoverBoundary: false,
    });
    expect(uncovered.request.mode).toBe(PROJECTION_MODE_RESET_FILL);
    expect(uncovered.boundaryForcedReset).toBe(true);
  });

  it("extends only when the frontier misses the guarded edge", () => {
    const extension = planProjection({ ...base, projectionFrontier: 11.5 });
    expect(extension.request).toMatchObject({
      mode: PROJECTION_MODE_EXTEND,
      modeLabel: "extend",
      origin: 11.5,
      projectEnd: 12.25,
      sampleCount: 15,
    });

    const adequate = planProjection(base);
    expect(adequate.request.mode).toBe(PROJECTION_MODE_NONE);
    expect(adequate.request.modeLabel).toBe("frontier-adequate");
  });

  it("honours adaptive skipping only when visible coverage is safe", () => {
    const safeSkip = planProjection({
      ...base,
      adaptiveSkipRequested: true,
      projectionFrontier: 12.5,
    });
    expect(safeSkip.skipProjection).toBe(true);
    expect(safeSkip.request.modeLabel).toBe("skip");

    const urgent = planProjection({
      ...base,
      adaptiveSkipRequested: true,
      projectionFrontier: 12.1,
    });
    expect(urgent.skipProjection).toBe(false);
    expect(urgent.request.mode).toBe(PROJECTION_MODE_EXTEND);
  });
});
