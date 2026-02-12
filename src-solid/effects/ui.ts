// src-solid/effects/ui.ts
import { Effect } from "effect";
// @ts-ignore
import { toggleConnect } from "../../src/io/serialComms.mjs";
// @ts-ignore
import { toggleSerialVis } from "../../src/editors/editorConfig.mjs";

export const toggleConnection = () => 
  Effect.promise(() => toggleConnect());

export const toggleGraph = () =>
  Effect.sync(() => toggleSerialVis());

const rerenderLucideIcons = () => {
  const lucide = (window as any).lucide;
  lucide?.createIcons?.();
};

const togglePanelExpand = ($: any, panel: any) => {
  panel.toggleClass("panel-expanded");
  const isExpanded = panel.hasClass("panel-expanded");
  const toggleButton = panel.find(".panel-expand-toggle");
  toggleButton
    .find(".expand-icon")
    .remove();
  const iconName = isExpanded ? "chevron-right" : "chevron-left";
  toggleButton.append(
    $(`<i class="expand-icon" data-lucide="${iconName}"></i>`),
  );
  rerenderLucideIcons();
};

const ensurePanelHasExpandToggle = ($: any, panel: any) => {
  const panelId = panel.attr("id");
  if (panel.find(".panel-expand-toggle").length > 0) return;

  const toggleButton = $(
    `<div class="panel-expand-toggle" data-panel="${panelId}" title="Toggle expand panel"><i class="expand-icon" data-lucide="chevron-left"></i></div>`,
  );
  panel.append(toggleButton);
  toggleButton.on("click", (e: Event) => {
    e.stopPropagation();
    togglePanelExpand($, panel);
  });
  rerenderLucideIcons();
};

const ensurePanelHasCloseButton = ($: any, panel: any) => {
  const panelId = panel.attr("id");
  if (panel.find(".panel-close-button").length > 0) return;

  const closeButton = $(
    `<button class="panel-close-button" data-panel="${panelId}" title="Close panel"><i class="close-icon" data-lucide="x"></i></button>`,
  );
  panel.append(closeButton);
  closeButton.on("click", (e: Event) => {
    e.stopPropagation();
    $(".panel-aux").hide();
  });
  rerenderLucideIcons();
};

export const togglePanel = (panelId: string) =>
  Effect.sync(() => {
    const $ = (window as any).$;
    if (!$) return;
    
    const panel = $(panelId);
    if (panel.is(":visible")) { 
        $(`.panel-aux`).hide();
    } else {
        $(`.panel-aux`).hide();
        panel.show();
        ensurePanelHasExpandToggle($, panel);
        ensurePanelHasCloseButton($, panel);
    }
  });
