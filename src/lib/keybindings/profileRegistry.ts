/**
 * Profile Registry — maps a profile ID (`keybindings.profile`) to its set of
 * default key bindings.
 *
 * A `profile` selects the base binding set; user `overrides` are layered on top
 * by the resolver (keybindings.md §1.3). Data-only — no runtime imports.
 */

import { defaultKeyBindings, type KeyBinding } from "./defaults.ts";
import { simplifiedBindings } from "./profiles/simplified.ts";

const PROFILES: Record<string, KeyBinding[]> = {
  default: defaultKeyBindings,
  simplified: simplifiedBindings,
};

/**
 * Resolve a profile ID to its base binding set. Unknown IDs fall back to the
 * `default` profile.
 */
export function bindingsForProfile(profile: string | undefined): KeyBinding[] {
  if (profile && profile in PROFILES) return PROFILES[profile];
  return PROFILES.default;
}

/** All registered profile IDs. */
export function profileIds(): string[] {
  return Object.keys(PROFILES);
}
