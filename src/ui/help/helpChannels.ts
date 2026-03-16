// src/ui/help/helpChannels.ts
//
// Typed channels for internal help-panel coordination.
// Replaces the "useq-reference-search" and "useq-help-panel-switch-tab"
// window CustomEvents with direct subscriptions.

import { createChannel } from "../../lib/typedChannel";

/** Payload published when the editor requests a reference lookup (Alt-F). */
export interface ReferenceSearchRequest {
  symbol: string;
}

/** Payload published when a component needs to switch the help panel tab. */
export interface HelpTabSwitchRequest {
  tabId: string;
}

/**
 * Channel: editor -> ModuLispReferenceTab.
 * Fired by editorConfig.ts when the user invokes Alt-F on a symbol.
 */
export const referenceSearchChannel = createChannel<ReferenceSearchRequest>();

/**
 * Channel: ModuLispReferenceTab -> Tabs.
 * Fired to programmatically switch the active help panel tab.
 */
export const helpTabSwitchChannel = createChannel<HelpTabSwitchRequest>();
