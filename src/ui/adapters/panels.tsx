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
import { WiredMachinePanel } from "../help/machine/MachinePanel";
import { ConsolePanel } from "../console/ConsolePanel";
// Side-effect import: registers the diagnostic → guide deep-link bridge
// (the-machine.md §5.1). panels.tsx is loaded from bootstrap, so the bridge
// is live before any diagnostic can be rendered.
import "../help/guideNavigation";
import { pushOverlay } from "../overlayManager";
import { createSolidAdapter } from "./createSolidAdapter";
import "../panel-chrome/panel-chrome.css";

// ---- Visibility signals ----

const [settingsVisible, setSettingsVisible] = createSignal(false);
const [helpVisible, setHelpVisible] = createSignal(false);
const [machineVisible, setMachineVisible] = createSignal(false);
const [consoleVisible, setConsoleVisible] = createSignal(true);

/** Map of panelId -> setter for extensibility. */
const visibilitySetters: Record<string, (v: boolean) => void> = {
  settings: (v) => setSettingsVisible(v),
  help: (v) => setHelpVisible(v),
  machine: (v) => setMachineVisible(v),
  console: (v) => setConsoleVisible(v),
};

const visibilityGetters: Record<string, () => boolean> = {
  settings: settingsVisible,
  help: helpVisible,
  machine: machineVisible,
  console: consoleVisible,
};

// ---- Public API ----

/** Panel IDs that don't participate in the "close others" mutual exclusion. */
const independentPanels = new Set(["console"]);

export function togglePanelVisibility(panelId: string) {
  const getter = visibilityGetters[panelId];
  const setter = visibilitySetters[panelId];
  if (getter && setter) {
    if (!getter() && !independentPanels.has(panelId)) {
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
  for (const [id, setter] of Object.entries(visibilitySetters)) {
    if (!independentPanels.has(id)) setter(false);
  }
}

// ---- Chrome-panel convenience aliases (previously in panelControls.ts) ----

export function hideChromePanels(): void {
  hideAllPanels();
}

export function toggleChromePanel(panelId: string): boolean {
  togglePanelVisibility(panelId);
  return true;
}

export function showChromePanel(panelId: string): void {
  showPanel(panelId);
}

export function hideChromePanel(panelId: string): void {
  hidePanel(panelId);
}

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

      {/* the-machine.md §2.4: the schematic's standalone surface. The
          lightest chrome consistent with overlays.md is an ordinary chrome
          panel — it joins the LIFO overlay stack via ManagedPanel, so it
          dismisses on Escape and participates in scroll-lock counting
          (overlays.md §1.1, §1.2) without inventing a new surface kind. */}
      <Show when={machineVisible()}>
        <ManagedPanel panelId="machine" onClose={() => setMachineVisible(false)}>
          <PanelChrome
            panelId="machine"
            title="How uSEQ thinks"
            onClose={() => setMachineVisible(false)}
          >
            <div class="panel machine-standalone">
              <WiredMachinePanel />
            </div>
          </PanelChrome>
        </ManagedPanel>
      </Show>

      <Show when={consoleVisible()}>
        <ConsolePanel />
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

/**
 * Toggle the standalone Machine schematic panel (the-machine.md §2.4).
 */
export function toggleMachinePanel(): void {
  panelRootAdapter.mount();
  togglePanelVisibility("machine");
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
