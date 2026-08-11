/**
 * Action Palette state API and application-owned component.
 */
import {
  ActionPalette,
  openPalette,
  closePalette,
} from "../keybindings/ActionPalette";

export function PaletteRoot() {
  return (
    <div style={{ "pointer-events": "auto" }}>
      <ActionPalette />
    </div>
  );
}

export { openPalette, closePalette };
