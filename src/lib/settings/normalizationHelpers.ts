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

export function detectOsFamily(): "pc" | "mac" {
  const platformStr =
    (typeof navigator !== "undefined" &&
      (navigator.platform || navigator.userAgent || "")) ||
    "";
  return /Mac|iPhone|iPad|iPod/i.test(platformStr) ? "mac" : "pc";
}
