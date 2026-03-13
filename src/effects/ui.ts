// src/effects/ui.ts
import { Effect } from "effect";
import { toggleRuntimeConnection } from "../runtime/runtimeService";
import { hideChromePanels, toggleChromePanel } from "../ui/adapters/panelControls";
import { toggleVisualisationPanel } from "../ui/adapters/visualisationPanel";

export const toggleConnection = () =>
  Effect.promise(() => toggleRuntimeConnection());

export const toggleGraph = () =>
  Effect.sync(() => toggleVisualisationPanel());

// ---- Panel visibility (delegated to adapter signals) ----

function hideAllAuxPanels() {
  hideChromePanels();
}

export { hideAllAuxPanels };

/**
 * Toggle panel by ID string. Chrome-managed panels use the "#panel-*" convention.
 */
export const togglePanel = (panelId: string) =>
  Effect.sync(() => {
    // Chrome-managed panels use short names
    const chromeId = panelId.replace(/^#panel-/, "");
    toggleChromePanel(chromeId);
  });
