/**
 * Toolbar shortcut labels — adapter-side helpers that turn live action-registry
 * bindings into display strings for toolbar tooltips (transport.md §1.7).
 *
 * Pure view components never import the registry; the adapter resolves the
 * active binding per toolbar action here and passes plain strings as props.
 */

import type { ActionId } from "../../lib/keybindings/actions.ts";

/** Returns the active key (CodeMirror notation) for an action, if bound. */
export type BindingLookup = (action: ActionId) => string | undefined;

/**
 * Format CodeMirror key notation for display, following keybindings.md §1.5:
 * `Mod` is `Cmd` on macOS and `Ctrl` elsewhere; `Alt` is `Option` on macOS.
 * Chords (`Alt-s ]`) keep their space-separated strokes.
 */
export function formatShortcut(key: string, mac: boolean): string {
  return key
    .split(" ")
    .map((stroke) => {
      // Split on "-" separators but keep a literal trailing "-" key.
      const parts = stroke.match(/(?:[^-]+|-$)/g) ?? [stroke];
      return parts
        .map((part) => {
          if (part === "Mod") return mac ? "Cmd" : "Ctrl";
          if (part === "Alt" && mac) return "Option";
          if (part === "Space") return "Space";
          return part.length === 1 ? part.toUpperCase() : part;
        })
        .join("+");
    })
    .join(" ");
}

/**
 * Resolve a display shortcut for each toolbar action that maps onto a
 * registry action. Toolbar actions with no registry action, or whose action
 * is currently unbound, are omitted.
 */
export function resolveToolbarShortcuts<K extends string>(
  mapping: Partial<Record<K, ActionId>>,
  lookup: BindingLookup,
  mac: boolean,
): Partial<Record<K, string>> {
  const result: Partial<Record<K, string>> = {};
  for (const [toolbarAction, actionId] of Object.entries(mapping) as Array<[K, ActionId | undefined]>) {
    if (!actionId) continue;
    const key = lookup(actionId);
    if (key) result[toolbarAction] = formatShortcut(key, mac);
  }
  return result;
}

/** Tooltip text: `Label (Shortcut)` when a shortcut is known, else `Label`. */
export function withShortcut(label: string, shortcut: string | undefined): string {
  return shortcut ? `${label} (${shortcut})` : label;
}
