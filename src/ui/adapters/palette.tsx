/**
 * Action Palette adapter — imperative palette API.
 *
 * Uses createSolidAdapter for mount lifecycle.
 */
import { createSolidAdapter } from "./createSolidAdapter";
import {
  ActionPalette,
  openPalette,
  closePalette,
} from "../keybindings/ActionPalette";

const adapter = createSolidAdapter({
  containerId: "solid-palette-root",
  containerStyle: {
    position: "fixed",
    inset: "0",
    zIndex: "2000",
    pointerEvents: "none",
  },
  Component: () => (
    <div style={{ "pointer-events": "auto" }}>
      <ActionPalette />
    </div>
  ),
});

/**
 * Mount the action palette root. Safe to call multiple times.
 */
export function mountPalette(): void {
  adapter.mount();
}

export { openPalette, closePalette };
