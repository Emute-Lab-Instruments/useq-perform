// src/editors/extensions/liveEdit/rangeInference.ts
//
// Pure function for inferring :min, :max, and :precision defaults when a user
// marks a literal for live-editing (§3.4).
//
// Spec: docs/specs/live-edit.md §3.4 and §2.1

import type { InferredRange } from "../../../contracts/liveEdit.ts";

/** Count the number of decimal places in a number's string representation. */
function decimals(seed: number): number {
  const s = String(seed);
  const dot = s.indexOf(".");
  if (dot === -1) return 0;
  return s.length - dot - 1;
}

/**
 * Infer `:min`, `:max`, and `:precision` defaults for a live-edit literal.
 *
 * @param seed      - The original literal value frozen at mark-time.
 * @param parentHead - The head symbol of the parent list, e.g. `"slow"`.
 * @returns An `InferredRange`, or `null` for boolean/keyword seeds.
 */
export function inferRange(
  seed: number | boolean | string,
  parentHead?: string,
): InferredRange | null {
  // Boolean and keyword seeds do not have numeric ranges.
  if (typeof seed === "boolean" || typeof seed === "string") {
    return null;
  }

  const x = seed;
  const precision = decimals(x) + 1;

  // Integer X with parent slow/fast — checked before the unit-range rule so
  // that e.g. seed=1 with parent="slow" takes this path.
  if (
    Number.isInteger(x) &&
    (parentHead === "slow" || parentHead === "fast")
  ) {
    return { min: 1, max: Math.max(16, 2 * x), precision };
  }

  // Number X with parent osc/phasor — likewise checked before unit-range.
  if (parentHead === "osc" || parentHead === "phasor") {
    return { min: 20, max: Math.max(2000, 2 * x), precision };
  }

  // 0 ≤ X ≤ 1
  if (x >= 0 && x <= 1) {
    return { min: 0, max: 1, precision };
  }

  // -1 ≤ X < 0
  if (x >= -1 && x < 0) {
    return { min: -1, max: 0, precision };
  }

  // Other numeric X > 0
  if (x > 0) {
    return { min: 0, max: 2 * x, precision };
  }

  // Other numeric X < 0
  if (x < 0) {
    return { min: 2 * x, max: 0, precision };
  }

  // Other numeric X == 0
  return { min: 0, max: 1, precision };
}
