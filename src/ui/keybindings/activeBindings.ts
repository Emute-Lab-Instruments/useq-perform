/**
 * Active key bindings accessor — single source of truth for UI surfaces.
 *
 * Spec: keybindings.md §2 — the which-key hints, modifier hints, action
 * palette, keyboard visualiser and help reference must show the *active
 * resolved* bindings (profile defaults ⊕ user overrides, keybindings.md
 * §1.3), not the static defaults file. Importing `defaultKeyBindings`
 * directly makes a surface diverge from the live keymap as soon as the
 * simplified profile or any override is in effect.
 *
 * Delegates to the lib-layer provider (see `src/lib/keybindings/liveBindings.ts`)
 * that `src/editors/keymaps.ts` registers at boot — a direct resolver import
 * from here would create a module-init cycle with `actionHandlers.ts`.
 */

import type { KeyBinding } from "../../lib/keybindings/defaults.ts";
import { liveKeyBindings } from "../../lib/keybindings/liveBindings.ts";

/** Snapshot of the currently-active keyboard bindings (incl. chord alternatives). */
export function activeKeyBindings(): KeyBinding[] {
  return liveKeyBindings();
}
