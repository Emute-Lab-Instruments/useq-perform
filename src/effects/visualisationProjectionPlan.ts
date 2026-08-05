import type { ProjectionMode } from "../contracts/runtimePorts";

export const PROJECTION_MODE_NONE: ProjectionMode = 0;
export const PROJECTION_MODE_RESET_FILL: ProjectionMode = 1;
export const PROJECTION_MODE_EXTEND: ProjectionMode = 2;

export type ProjectionModeLabel =
  | "no-outputs"
  | "skip"
  | "reset-fill"
  | "extend"
  | "frontier-adequate";

export interface ProjectionRequest {
  mode: ProjectionMode;
  modeLabel: ProjectionModeLabel;
  projectEnd: number;
  origin: number;
  sampleCount: number;
}

export interface ProjectionPlan {
  needsResetFill: boolean;
  boundaryForcedReset: boolean;
  skipProjection: boolean;
  needsExtension: boolean;
  futureEdgeWithGuard: number;
  visibleFutureEdgeWithGuard: number;
  request: ProjectionRequest;
}

export interface ProjectionPlanInput {
  timeSeconds: number;
  futureEdge: number;
  halfWindow: number;
  guardBandSeconds: number;
  projectFuture: boolean;
  noUserOutputs: boolean;
  futureInvalidated: boolean;
  allOutputsCoverBoundary: boolean;
  adaptiveSkipRequested: boolean;
  projectionFrontier: number;
  futureDensityHz: number;
  extensionBatchSize: number;
}

function extensionSampleCount(
  origin: number,
  projectEnd: number,
  densityHz: number,
  minimumBatchSize: number,
): number {
  return Math.max(
    minimumBatchSize,
    Math.ceil(Math.max(0, projectEnd - origin) * Math.max(1, densityHz)),
  );
}

/**
 * Pure projection decision table. Runtime calls and buffer mutations happen in
 * visualisationSampler; this function only decides which work is required.
 */
export function planProjection(input: ProjectionPlanInput): ProjectionPlan {
  const boundaryForcedReset =
    input.projectFuture &&
    !input.futureInvalidated &&
    !input.noUserOutputs &&
    !input.allOutputsCoverBoundary;
  const needsResetFill =
    input.projectFuture &&
    (input.futureInvalidated || boundaryForcedReset);
  const visibleFutureEdgeWithGuard =
    input.timeSeconds + input.halfWindow + input.guardBandSeconds;
  const skipProjection =
    !input.projectFuture ||
    (
      !needsResetFill &&
      !input.noUserOutputs &&
      input.adaptiveSkipRequested &&
      input.projectionFrontier >= visibleFutureEdgeWithGuard
    );
  const futureEdgeWithGuard = input.futureEdge + input.guardBandSeconds;
  const needsExtension =
    !needsResetFill &&
    !input.noUserOutputs &&
    !skipProjection &&
    input.projectionFrontier < futureEdgeWithGuard;

  let request: ProjectionRequest;
  if (input.noUserOutputs || skipProjection) {
    request = {
      mode: PROJECTION_MODE_NONE,
      modeLabel: input.noUserOutputs ? "no-outputs" : "skip",
      projectEnd: input.timeSeconds,
      origin: input.timeSeconds,
      sampleCount: 0,
    };
  } else if (needsResetFill) {
    request = {
      mode: PROJECTION_MODE_RESET_FILL,
      modeLabel: "reset-fill",
      projectEnd: input.futureEdge,
      origin: input.timeSeconds,
      sampleCount: Math.max(
        2,
        Math.ceil(
          (input.futureEdge - input.timeSeconds) * input.futureDensityHz,
        ),
      ),
    };
  } else if (needsExtension) {
    request = {
      mode: PROJECTION_MODE_EXTEND,
      modeLabel: "extend",
      projectEnd: futureEdgeWithGuard,
      origin: input.projectionFrontier,
      sampleCount: extensionSampleCount(
        input.projectionFrontier,
        futureEdgeWithGuard,
        input.futureDensityHz,
        input.extensionBatchSize,
      ),
    };
  } else {
    request = {
      mode: PROJECTION_MODE_NONE,
      modeLabel: "frontier-adequate",
      projectEnd: input.timeSeconds,
      origin: input.timeSeconds,
      sampleCount: 0,
    };
  }

  return {
    needsResetFill,
    boundaryForcedReset,
    skipProjection,
    needsExtension,
    futureEdgeWithGuard,
    visibleFutureEdgeWithGuard,
    request,
  };
}
