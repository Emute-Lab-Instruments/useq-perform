/**
 * Live-bindings provider — dependency inversion for UI binding readers.
 *
 * Spec: keybindings.md §2 — UI surfaces (which-key hints, modifier hints,
 * action palette, keyboard visualiser, help reference) must show the
 * *active resolved* bindings (profile defaults ⊕ overrides), not the static
 * defaults file.
 *
 * The singleton resolver lives in `src/editors/keymaps.ts`, which sits above
 * this module in the layer stack — lib code cannot import it (import
 * boundaries), and a static import from UI modules that are themselves in
 * `actionHandlers.ts`'s import graph would create a module-init cycle.
 * Instead, keymaps.ts registers a provider here at boot; readers call
 * `liveKeyBindings()`.
 *
 * Before the provider registers (isolated tests/stories that never load
 * keymaps.ts) there are no *active* bindings, so readers see an empty list
 * rather than stale defaults.
 */

import type { ActionId } from "./actions.ts";
import type { KeyBinding } from "./defaults.ts";

let provider: (() => KeyBinding[]) | null = null;

/** Register the active-bindings source. Called once from keymaps.ts boot. */
export function setLiveBindingsProvider(p: () => KeyBinding[]): void {
  provider = p;
}

/** Snapshot of the currently-active keyboard bindings (incl. chord alternatives). */
export function liveKeyBindings(): KeyBinding[] {
  return provider ? provider() : [];
}

/** Look up the primary active key for an action, or undefined when unbound. */
export function liveKeyFor(action: ActionId): string | undefined {
  return liveKeyBindings().find((b) => b.action === action)?.key;
}
