import type { JSX } from "solid-js";

import {
  serialVisAutoOpenChannel,
} from "../../contracts/visualisationChannels";
import {
  refreshSerialVisLoop,
  stopSerialVisLoop,
} from "../visualisation/serialVis";

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
    opacity: "0.7",
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

  const context = canvas.getContext("2d");
  if (context) {
    context.clearRect(0, 0, dimensions.width, dimensions.height);
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
    refreshSerialVisLoop();
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
    stopSerialVisLoop();
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
