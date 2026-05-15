/**
 * Keybindings Settings Normalization
 *
 * Validation and normalization for keybinding-related settings.
 */

import type { KeybindingsSettings } from "./schema.ts";
import { defaultUserSettings } from "./schema.ts";
import { isRecord, coerceNumber, clampNumber } from "./normalizationHelpers.ts";

export function normalizeKeybindingsSettings(
  value: unknown,
  defaults: KeybindingsSettings = defaultUserSettings.keybindings!,
): KeybindingsSettings {
  const raw = isRecord(value) ? value : {};

  const result: KeybindingsSettings = {
    profile:
      typeof raw.profile === "string" && raw.profile.length > 0
        ? raw.profile
        : defaults.profile,
    layout:
      typeof raw.layout === "string" && raw.layout.length > 0
        ? raw.layout
        : defaults.layout,
  };

  if (isRecord(raw.overrides)) {
    result.overrides = Object.fromEntries(
      Object.entries(raw.overrides).filter(
        ([k, v]) => typeof k === "string" && typeof v === "string",
      ),
    ) as Record<string, string>;
  }

  if (isRecord(raw.gamepadOverrides)) {
    const cleaned: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(raw.gamepadOverrides)) {
      if (typeof k === "string" && Array.isArray(v)) {
        const filtered = v.filter((s): s is string => typeof s === "string");
        if (filtered.length > 0) cleaned[k] = filtered;
      }
    }
    if (Object.keys(cleaned).length > 0) result.gamepadOverrides = cleaned;
  }

  if (raw.chordTimeout != null) {
    result.chordTimeout = clampNumber(
      coerceNumber(raw.chordTimeout, 1500),
      200,
      5000,
    );
  }

  if (raw.modifierHintDelay != null) {
    result.modifierHintDelay = clampNumber(
      coerceNumber(raw.modifierHintDelay, 500),
      0,
      2000,
    );
  }

  if (raw.modifierHintStyle != null) {
    const valid = ["cursor", "bar", "modal"];
    result.modifierHintStyle = valid.includes(raw.modifierHintStyle as string)
      ? (raw.modifierHintStyle as "cursor" | "bar" | "modal")
      : undefined;
  }

  if (raw.stickyModifiers != null) {
    result.stickyModifiers = raw.stickyModifiers === true;
  }

  return result;
}
