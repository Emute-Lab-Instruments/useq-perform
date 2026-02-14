// src/effects/ui.ts
import { Effect } from "effect";
// @ts-ignore
import { toggleConnect } from "../legacy/io/serialComms.ts";
// @ts-ignore
import { toggleSerialVis } from "../legacy/editors/editorConfig.ts";

export const toggleConnection = () =>
  Effect.promise(() => toggleConnect());

export const toggleGraph = () =>
  Effect.sync(() => toggleSerialVis());

const rerenderLucideIcons = () => {
  const lucide = (window as any).lucide;
  lucide?.createIcons?.();
};

function hideAllAuxPanels() {
  document.querySelectorAll(".panel-aux").forEach(el => (el as HTMLElement).style.display = "none");
}

const togglePanelExpand = (panel: HTMLElement) => {
  panel.classList.toggle("panel-expanded");
  const isExpanded = panel.classList.contains("panel-expanded");
  const toggleButton = panel.querySelector(".panel-expand-toggle");
  if (toggleButton) {
    const oldIcon = toggleButton.querySelector(".expand-icon");
    if (oldIcon) oldIcon.remove();
    const iconName = isExpanded ? "chevron-right" : "chevron-left";
    const newIcon = document.createElement("i");
    newIcon.className = "expand-icon";
    newIcon.setAttribute("data-lucide", iconName);
    toggleButton.appendChild(newIcon);
  }
  rerenderLucideIcons();
};

const ensurePanelHasExpandToggle = (panel: HTMLElement) => {
  const panelId = panel.getAttribute("id");
  if (panel.querySelector(".panel-expand-toggle")) return;

  const toggleButton = document.createElement("div");
  toggleButton.className = "panel-expand-toggle";
  toggleButton.setAttribute("data-panel", panelId || "");
  toggleButton.title = "Toggle expand panel";
  toggleButton.innerHTML = '<i class="expand-icon" data-lucide="chevron-left"></i>';
  panel.appendChild(toggleButton);
  toggleButton.addEventListener("click", (e: Event) => {
    e.stopPropagation();
    togglePanelExpand(panel);
  });
  rerenderLucideIcons();
};

const ensurePanelHasCloseButton = (panel: HTMLElement) => {
  const panelId = panel.getAttribute("id");
  if (panel.querySelector(".panel-close-button")) return;

  const closeButton = document.createElement("button");
  closeButton.className = "panel-close-button";
  closeButton.setAttribute("data-panel", panelId || "");
  closeButton.title = "Close panel";
  closeButton.innerHTML = '<i class="close-icon" data-lucide="x"></i>';
  panel.appendChild(closeButton);
  closeButton.addEventListener("click", (e: Event) => {
    e.stopPropagation();
    hideAllAuxPanels();
  });
  rerenderLucideIcons();
};

export const togglePanel = (panelId: string) =>
  Effect.sync(() => {
    const panel = document.querySelector(panelId) as HTMLElement | null;
    if (!panel) return;

    if (panel.offsetParent !== null) {
        hideAllAuxPanels();
    } else {
        hideAllAuxPanels();
        panel.style.display = "";
        ensurePanelHasExpandToggle(panel);
        ensurePanelHasCloseButton(panel);
    }
  });
