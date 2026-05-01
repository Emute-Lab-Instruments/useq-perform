import type { JSX } from "solid-js";

import {
  serialVisAutoOpenChannel,
} from "../../contracts/visualisationChannels";
import {
  pauseVisualisationRender,
  registerVisualisationRenderHook,
  requestVisualisationRender,
} from "../../effects/visualisationRuntime";
import {
  drawSerialVisGL,
  ensureGLCanvasGeometry,
  activateGLCanvas,
  isVisPanelVisible,
} from "../visualisation/serialVisGL";

registerVisualisationRenderHook({
  paint: () => {
    activateGLCanvas();
    ensureGLCanvasGeometry();
    drawSerialVisGL();
  },
  isVisible: () => isVisPanelVisible(),
});

const PANEL_ID = "panel-vis";

let registeredPanel: HTMLElement | null = null;

export function registerVisualisationPanel(panel: HTMLElement | null): void {
  registeredPanel = panel;
}

export function getVisualisationPanel(): HTMLElement | null {
  if (registeredPanel && registeredPanel.isConnected) {
    return registeredPanel;
  }

  if (typeof document === "undefined") {
    return null;
  }

  registeredPanel = document.getElementById(PANEL_ID);
  return registeredPanel;
}

export function isVisualisationPanelVisible(
  panel: HTMLElement | null = getVisualisationPanel()
): boolean {
  if (!panel || typeof window === "undefined") {
    return false;
  }

  const style = window.getComputedStyle(panel);
  return style.display !== "none" && style.visibility !== "hidden" && !panel.hidden;
}

export function getVisualisationPanelStyles(makeVisible: boolean): JSX.CSSProperties {
  if (!makeVisible) {
    return { display: "none" };
  }

  return {
    display: "block",
    position: "fixed",
    height: "100%",
    width: "100%",
    left: "0%",
    top: "0%",
    // Transparency is applied at the canvas drawing level (globalAlpha)
    // rather than via container opacity, which forces an expensive
    // offscreen compositing pass on every frame.
    "pointer-events": "none",
  };
}

function applyVisibleVisualisationPanelState(panel: HTMLElement): void {
  Object.assign(panel.style, getVisualisationPanelStyles(true));
  panel.hidden = false;
  // Canvas creation + sizing is handled lazily by the GL renderer on
  // first paint (see serialVisGL.getCanvas / ensureGLCanvasGeometry).
}

export function showVisualisationPanel(options?: { emitAutoOpenEvent?: boolean }): boolean {
  const panel = getVisualisationPanel();
  if (!panel) {
    return false;
  }

  const wasVisible = isVisualisationPanelVisible(panel);
  if (!wasVisible) {
    applyVisibleVisualisationPanelState(panel);
    requestVisualisationRender();
    if (options?.emitAutoOpenEvent) {
      serialVisAutoOpenChannel.publish(undefined);
    }
  }

  return true;
}

export function hideVisualisationPanel(): boolean {
  const panel = getVisualisationPanel();
  if (!panel) {
    return false;
  }

  const wasVisible = isVisualisationPanelVisible(panel);
  if (wasVisible) {
    pauseVisualisationRender();
    Object.assign(panel.style, getVisualisationPanelStyles(false));
    panel.hidden = true;
  }

  return wasVisible;
}

export function toggleVisualisationPanel(): boolean {
  const panel = getVisualisationPanel();
  if (!panel) {
    return false;
  }

  if (isVisualisationPanelVisible(panel)) {
    hideVisualisationPanel();
    return false;
  }

  showVisualisationPanel();
  return true;
}
