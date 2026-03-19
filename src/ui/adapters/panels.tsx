/**
 * Panel adapter - imperative panel API with PanelChrome wrapper.
 *
 * Manages panel visibility via Solid signals and renders each panel
 * inside a PanelChrome component that provides the active chrome design
 * (Pane, Drawer, or Tile).
 *
 * Uses createSolidAdapter for mount lifecycle.
 */
import { Show, createSignal, onCleanup, onMount, type JSX } from "solid-js";
import { PanelChrome } from "../panel-chrome/PanelChrome";
import { DesignSelector } from "../panel-chrome/DesignSelector";
import { SettingsPanel } from "../settings/SettingsPanel";
import { HelpPanel } from "../help/HelpPanel";
import { pushOverlay } from "../overlayManager";
import { registerPanelControls } from "./panelControls";
import { createSolidAdapter } from "./createSolidAdapter";
import "../panel-chrome/panel-chrome.css";

// ---- Visibility signals ----

const [settingsVisible, setSettingsVisible] = createSignal(false);
const [helpVisible, setHelpVisible] = createSignal(false);

/** Map of panelId -> setter for extensibility. */
const visibilitySetters: Record<string, (v: boolean) => void> = {
  settings: (v) => setSettingsVisible(v),
  help: (v) => setHelpVisible(v),
};

const visibilityGetters: Record<string, () => boolean> = {
  settings: settingsVisible,
  help: helpVisible,
};

// ---- Public API ----

/**
 * Toggle a panel's visibility by panelId (e.g. "settings", "help").
 */
export function togglePanelVisibility(panelId: string) {
  const getter = visibilityGetters[panelId];
  const setter = visibilitySetters[panelId];
  if (getter && setter) {
    // If opening a panel, close others first
    if (!getter()) {
      hideAllPanels();
    }
    setter(!getter());
  }
}

/**
 * Show a specific panel by panelId.
 */
export function showPanel(panelId: string) {
  const setter = visibilitySetters[panelId];
  if (setter) {
    hideAllPanels();
    setter(true);
  }
}

/**
 * Hide a specific panel by panelId.
 */
export function hidePanel(panelId: string) {
  const setter = visibilitySetters[panelId];
  if (setter) {
    setter(false);
  }
}

/**
 * Hide all chrome-managed panels.
 */
export function hideAllPanels() {
  for (const setter of Object.values(visibilitySetters)) {
    setter(false);
  }
}

registerPanelControls({
  hideAllPanels,
  togglePanelVisibility,
  showPanel,
  hidePanel,
});

// ---- Mount helpers ----

function ManagedPanel(props: {
  panelId: string;
  onClose: () => void;
  children: JSX.Element;
}) {
  let popOverlay: (() => void) | undefined;
  onMount(() => {
    popOverlay = pushOverlay(`panel:${props.panelId}`, props.onClose);
  });
  onCleanup(() => {
    popOverlay?.();
  });
  return <>{props.children}</>;
}

const panelRootAdapter = createSolidAdapter({
  containerId: "solid-panel-root",
  Component: () => (
    <>
      <Show when={settingsVisible()}>
        <ManagedPanel panelId="settings" onClose={() => setSettingsVisible(false)}>
          <PanelChrome
            panelId="settings"
            title="Settings"
            onClose={() => setSettingsVisible(false)}
          >
            <SettingsPanel />
          </PanelChrome>
        </ManagedPanel>
      </Show>

      <Show when={helpVisible()}>
        <ManagedPanel panelId="help" onClose={() => setHelpVisible(false)}>
          <PanelChrome
            panelId="help"
            title="Help"
            onClose={() => setHelpVisible(false)}
          >
            <HelpPanel />
          </PanelChrome>
        </ManagedPanel>
      </Show>
    </>
  ),
});

/**
 * Mount the settings panel. Called from legacy solidBridge.
 * The elementId parameter is accepted for backward compat but the chrome
 * components create their own fixed-position root.
 */
export function mountSettingsPanel(_elementId?: string) {
  panelRootAdapter.mount();
}

/**
 * Mount the help panel. Called from legacy solidBridge.
 */
export function mountHelpPanel(_elementId?: string) {
  panelRootAdapter.mount();
}

// ---- Design selector ----

const [devmodeSignal, setDevmodeSignal] = createSignal(false);

const designSelectorAdapter = createSolidAdapter({
  containerId: "solid-design-selector-root",
  Component: () => <DesignSelector devmode={devmodeSignal()} />,
});

/**
 * Mount the DesignSelector widget. Call once when devmode is determined.
 */
export function mountDesignSelector(devmode: boolean) {
  setDevmodeSignal(devmode);
  designSelectorAdapter.mount();
}
