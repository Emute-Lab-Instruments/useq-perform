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
        // Note: ensurePanelHasExpandToggle and ensurePanelHasCloseButton 
        // are in toolbar.mjs. We might need to migrate them or call them if exported.
    }
  });
