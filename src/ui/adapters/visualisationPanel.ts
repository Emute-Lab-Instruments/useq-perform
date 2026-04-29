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
  drawSerialVis,
  ensureCanvasGeometry,
  isVisPanelVisible,
} from "../visualisation/serialVis";
import {
  drawSerialVisGL,
  ensureGLCanvasGeometry,
} from "../visualisation/serialVisGL";
import { settings as settingsStore } from "../../utils/settingsStore";

/**
 * Read the renderer choice from settings on every paint so that toggling
 * the dev-mode setting takes effect on the next frame without needing a
 * reload.  Default to "canvas" if the field is missing or malformed —
 * keeps the canonical 2D renderer the safe fallback.
 */
function activeRenderer(): "canvas" | "webgl" {
  const r = settingsStore?.visualisation?.renderer;
  return r === "webgl" ? "webgl" : "canvas";
}

// Wire the canvas renderer into the visualisation runtime.  The runtime
// itself lives in `src/effects/` and is forbidden from importing `src/ui/`
// directly, so this adapter registers the hook at module load.  The hook
// dispatches to either renderer based on `visualisation.renderer`.
registerVisualisationRenderHook({
  paint: () => {
    if (activeRenderer() === "webgl") {
      ensureGLCanvasGeometry();
      drawSerialVisGL();
      return;
    }
    ensureCanvasGeometry();
    drawSerialVis();
  },
  isVisible: () => isVisPanelVisible(),
});

const PANEL_ID = "panel-vis";
const CANVAS_ID = "serialcanvas";

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

function getVisualisationCanvas(panel: HTMLElement | null): HTMLCanvasElement | null {
  if (!panel || typeof document === "undefined") {
    return null;
  }

  const canvas = panel.querySelector<HTMLCanvasElement>(`#${CANVAS_ID}`);
  if (canvas) {
    return canvas;
  }

  return document.getElementById(CANVAS_ID) as HTMLCanvasElement | null;
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

function getCanvasDimensions(): { width: number; height: number } {
  if (typeof window === "undefined") {
    return { width: 0, height: 0 };
  }

  return {
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

function getCanvasStyles(): JSX.CSSProperties {
  return {
    display: "block",
    width: "100%",
    height: "100%",
    "background-color": "transparent",
    position: "absolute",
    top: "0",
    left: "0",
    // Promote to own GPU compositing layer so repaints don't
    // trigger full-viewport recomposite through the opacity layer.
    "will-change": "contents",
  };
}

function applyVisibleVisualisationPanelState(
  panel: HTMLElement,
  canvas: HTMLCanvasElement | null
): void {
  Object.assign(panel.style, getVisualisationPanelStyles(true));
  panel.hidden = false;

  if (!canvas) {
    return;
  }

  const dimensions = getCanvasDimensions();
  canvas.setAttribute("width", String(dimensions.width));
  canvas.setAttribute("height", String(dimensions.height));
  Object.assign(canvas.style, getCanvasStyles());
  canvas.style.zIndex = "1000";

  if (!canvas.parentElement) {
    panel.appendChild(canvas);
  }

  // Only initialise the 2D context up front when the canvas renderer is
  // selected.  Calling getContext("2d") locks the canvas to that
  // surface, which would prevent the WebGL2 context from ever being
  // acquired.  When WebGL is active the GL renderer takes care of its
  // own clear/init.
  if (activeRenderer() === "canvas") {
    const context = canvas.getContext("2d");
    if (context) {
      context.clearRect(0, 0, dimensions.width, dimensions.height);
    }
  }
}

export function showVisualisationPanel(options?: { emitAutoOpenEvent?: boolean }): boolean {
  const panel = getVisualisationPanel();
  if (!panel) {
    return false;
  }

  const wasVisible = isVisualisationPanelVisible(panel);
  if (!wasVisible) {
    applyVisibleVisualisationPanelState(panel, getVisualisationCanvas(panel));
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
