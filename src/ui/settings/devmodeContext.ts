/**
 * Devmode gate for the settings panel.
 *
 * Settings fields are tagged `basic` or `advanced` (default: `basic`).
 * When devmode is **off** (no `?devmode=true` URL flag), only `basic`
 * controls render. When devmode is **on**, everything renders — same as
 * before this split.
 *
 * The devmode flag is captured once from `startupContext` (it is frozen at
 * bootstrap), but exposed here as an overridable signal so tests and the
 * Inspector can toggle it without touching the global startup context.
 */

import { createSignal } from "solid-js";
import { getStartupFlagsSnapshot } from "../../runtime/startupContext.ts";

export type SettingsLevel = "basic" | "advanced";

/**
 * Lazy default: read devmode from startup context the first time it's
 * needed. Stored in a signal so tests/Inspector can override it.
 */
const [devmodeSignal, setDevmodeSignal] = createSignal<boolean | null>(null);

function readStartupDevmode(): boolean {
  try {
    return !!getStartupFlagsSnapshot().devmode;
  } catch {
    return false;
  }
}

/** Reactive accessor — `true` when advanced controls should be rendered. */
export function isDevmode(): boolean {
  const override = devmodeSignal();
  if (override !== null) return override;
  return readStartupDevmode();
}

/**
 * Test/Inspector override. Pass `null` to fall back to the startup flag.
 */
export function setDevmodeOverride(value: boolean | null): void {
  setDevmodeSignal(value);
}

/**
 * Visibility helper used by FormControls. A control with no level is
 * treated as `basic` (always visible).
 */
export function isLevelVisible(level: SettingsLevel | undefined): boolean {
  if (!level || level === "basic") return true;
  return isDevmode();
}
