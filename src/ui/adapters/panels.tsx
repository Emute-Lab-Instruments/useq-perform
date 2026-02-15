/**
 * Panel adapter - imperative panel API with PanelChrome wrapper.
 *
 * Manages panel visibility via Solid signals and renders each panel
 * inside a PanelChrome component that provides the active chrome design
 * (Pane, Drawer, or Tile).
 */
import { render } from "solid-js/web";
import { Show, createSignal } from "solid-js";
import { PanelChrome } from "../panel-chrome/PanelChrome";
import { DesignSelector } from "../panel-chrome/DesignSelector";
import { SettingsPanel } from "../settings/SettingsPanel";
import { HelpPanel } from "../help/HelpPanel";
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

// ---- Mount helpers ----

function isBrowser(): boolean {
  return typeof document !== "undefined" && typeof window !== "undefined";
}

let panelRootMounted = false;

function ensurePanelRoot(): HTMLElement {
  const existing = document.getElementById("solid-panel-root");
  if (existing) return existing;

  const el = document.createElement("div");
  el.id = "solid-panel-root";
  document.body.appendChild(el);
  return el;
}

function mountPanelRoot() {
  if (panelRootMounted) return;
  if (!isBrowser()) return;
  panelRootMounted = true;

  const root = ensurePanelRoot();
  render(
    () => (
      <>
        <Show when={settingsVisible()}>
          <PanelChrome
            panelId="settings"
            title="Settings"
            onClose={() => setSettingsVisible(false)}
          >
            <SettingsPanel />
          </PanelChrome>
        </Show>

        <Show when={helpVisible()}>
          <PanelChrome
            panelId="help"
            title="Help"
            onClose={() => setHelpVisible(false)}
          >
            <HelpPanel />
          </PanelChrome>
        </Show>
      </>
    ),
    root,
  );
}

/**
 * Mount the settings panel. Called from legacy solidBridge.
 * The elementId parameter is accepted for backward compat but the chrome
 * components create their own fixed-position root.
 */
export function mountSettingsPanel(_elementId?: string) {
  mountPanelRoot();
}

/**
 * Mount the help panel. Called from legacy solidBridge.
 */
export function mountHelpPanel(_elementId?: string) {
  mountPanelRoot();
}

// ---- Design selector ----

let designSelectorMounted = false;

/**
 * Mount the DesignSelector widget. Call once when devmode is determined.
 */
export function mountDesignSelector(devmode: boolean) {
  if (designSelectorMounted) return;
  if (!isBrowser()) return;
  designSelectorMounted = true;

  const el = document.createElement("div");
  el.id = "solid-design-selector-root";
  document.body.appendChild(el);
  render(() => <DesignSelector devmode={devmode} />, el);
}
