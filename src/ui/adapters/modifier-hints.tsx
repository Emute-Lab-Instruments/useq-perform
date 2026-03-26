/**
 * Modifier Hints adapter — imperative mount API.
 *
 * Uses createSolidAdapter for mount lifecycle. The container is fixed-position
 * with pointer-events: none so it never interferes with input.
 */
import { createSolidAdapter } from "./createSolidAdapter.ts";
import { ModifierHints } from "../keybindings/ModifierHints.tsx";

const adapter = createSolidAdapter({
  containerId: "solid-modifier-hints-root",
  containerStyle: {
    position: "fixed",
    inset: "0",
    zIndex: "2100",
    pointerEvents: "none",
  },
  Component: () => <ModifierHints />,
});

/**
 * Mount the modifier hints overlay. Safe to call multiple times.
 */
export function mountModifierHints(): void {
  adapter.mount();
}
