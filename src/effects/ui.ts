// src/effects/ui.ts
import { Effect } from "effect";
// @ts-ignore - Importing from legacy untyped module
import { toggleConnect } from "../legacy/io/serialComms.ts";
// @ts-ignore - Importing from legacy untyped module
import { toggleSerialVis } from "../legacy/editors/editorConfig.ts";

export const toggleConnection = () =>
  Effect.promise(() => toggleConnect());

export const toggleGraph = () =>
  Effect.sync(() => toggleSerialVis());

// ---- Panel visibility (delegated to adapter signals) ----

let _togglePanelVisibility: ((panelId: string) => void) | null = null;
let _hideAllPanels: (() => void) | null = null;

// Lazy-load the adapter to avoid circular imports and keep Node.js compat.
import("../ui/adapters/panels.tsx")
  .then((m) => {
    _togglePanelVisibility = m.togglePanelVisibility;
    _hideAllPanels = m.hideAllPanels;
  })
  .catch(() => {});

function hideAllAuxPanels() {
  if (_hideAllPanels) {
    _hideAllPanels();
  }
  // Also hide any remaining legacy .panel-aux elements (e.g. devmode panel)
  document.querySelectorAll(".panel-aux").forEach(el => (el as HTMLElement).style.display = "none");
}

export { hideAllAuxPanels };

/**
 * Toggle panel by ID string. Supports both chrome-managed panels
 * ("settings", "help") and legacy DOM panels ("#panel-devmode").
 */
export const togglePanel = (panelId: string) =>
  Effect.sync(() => {
    // Chrome-managed panels use short names
    const chromeId = panelId.replace(/^#panel-/, "");
    if (_togglePanelVisibility && (chromeId === "settings" || chromeId === "help")) {
      _togglePanelVisibility(chromeId);
      return;
    }

    // Fallback: legacy DOM-based panel toggle (e.g. devmode)
    const panel = document.querySelector(panelId) as HTMLElement | null;
    if (!panel) return;

    if (panel.offsetParent !== null) {
      hideAllAuxPanels();
    } else {
      hideAllAuxPanels();
      panel.style.display = "";
    }
  });
