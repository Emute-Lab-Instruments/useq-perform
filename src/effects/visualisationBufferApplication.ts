import type { PastBuffer } from "../lib/PastBuffer";
import type { VisSample } from "../utils/visualisationStore";

export interface ProjectionBufferApplication {
  frontier: number;
  appliedCount: number;
}

/** Apply the finite prefix of a projection result to one future buffer. */
export function applyProjectionSamples(
  buffer: PastBuffer,
  samples: readonly VisSample[],
  options: { reset: boolean },
): ProjectionBufferApplication {
  const appendAfterTime = options.reset ? -Infinity : buffer.newestTime;
  if (options.reset) buffer.clear();

  let frontier = -Infinity;
  let appliedCount = 0;
  for (const sample of samples) {
    // Projection traces are valid only through their first non-finite sample.
    if (!Number.isFinite(sample.value)) break;
    if (options.reset || sample.time > appendAfterTime) {
      buffer.push(sample.time, sample.value);
      appliedCount++;
    }
    frontier = Math.max(frontier, sample.time);
  }
  return { frontier, appliedCount };
}
