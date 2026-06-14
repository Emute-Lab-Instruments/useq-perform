/**
 * `?keymap` URL param application (url-params.md §2, §2.3; keybindings.md §1.13).
 *
 * The `?keymap=<base64>` param carries a Base64-encoded keybinding profile
 * `{ version, baseProfile, overrides, gamepadOverrides }`. It is decoded by
 * `profileFromUrl()` and applied to the keybindings settings independently of
 * the main `startupFlags` parser.
 *
 * This lives in `src/runtime/` (not `src/lib/keybindings/`) because applying a
 * profile mutates settings via `runtimeService`, which `lib/` may not import.
 */

import { profileFromUrl, profileToSettings } from "../lib/keybindings/profiles.ts";
import { updateSettings } from "./runtimeSettingsService.ts";
import { dbg } from "../lib/debug.ts";

/**
 * Decode and apply a `?keymap` profile from the given URL, if present.
 *
 * @returns `true` if a profile was found and applied, `false` otherwise.
 */
export function applyKeymapFromUrl(url: string): boolean {
  const result = profileFromUrl(url);
  if (!result.ok) {
    // No keymap param is the common case — only log genuine decode failures.
    if (result.error !== "No keymap parameter in URL") {
      dbg(`[keymap] ignoring ?keymap param: ${result.error}`);
    }
    return false;
  }

  // Apply ephemerally — a shareable ?keymap link must NOT silently mutate
  // persistent state (matches ?config/?txt/?gist). The keymap only becomes
  // persistent if the user explicitly saves settings. (url-params.md §2.3)
  updateSettings({ keybindings: profileToSettings(result.profile) }, { persist: false });
  dbg(`[keymap] applied profile from URL (base "${result.profile.baseProfile}")`);
  return true;
}
