/**
 * Normalization Helpers
 *
 * Shared utility functions used across domain-specific normalizer modules.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function coerceNumber(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Coerce to a finite number (falling back when non-finite) and clamp the
 * result into [min, max]. Used to enforce settings.md §1.7's promise that
 * out-of-range numerics are clamped, not just non-finite ones.
 */
export function coerceClampedNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  return clampNumber(coerceNumber(value, fallback), min, max);
}

export function detectOsFamily(): "pc" | "mac" {
  const platformStr =
    (typeof navigator !== "undefined" &&
      (navigator.platform || navigator.userAgent || "")) ||
    "";
  return /Mac|iPhone|iPad|iPod/i.test(platformStr) ? "mac" : "pc";
}
