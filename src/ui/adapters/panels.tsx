/**
 * Panel adapter - imperative panel API with PanelChrome wrapper.
 *
 * Manages panel visibility via Solid signals and renders each panel
 * inside a PanelChrome component that provides the active chrome design
 * (Pane, Drawer, or Tile).
 *
 * The application root owns rendering; this module owns panel state.
 */
import { Show, createSignal, onCleanup, onMount, type JSX } from "solid-js";
import { PanelChrome } from "../panel-chrome/PanelChrome";
import { isNarrowViewport } from "../panel-chrome/geometry";
import type { PanelSide } from "../panel-chrome/types";
import { SettingsPanel } from "../settings/SettingsPanel";
import { HelpPanel } from "../help/HelpPanel";
import { WiredMachinePanel } from "../help/machine/MachinePanel";
import { ConsolePanel } from "../console/ConsolePanel";
import { settings } from "../../utils/settingsStore";
// Side-effect import: registers the diagnostic → guide deep-link bridge
// (the-machine.md §5.1). panels.tsx is loaded from bootstrap, so the bridge
// is live before any diagnostic can be rendered.
import "../help/guideNavigation";
import { pushOverlay } from "../overlayManager";
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

// ---- Side-by-side docking ----
//
// Chrome panels dock to one of two viewport sides so that up to two can be
// open at once without overlapping. Each panel has a preferred side; when it
// is taken the panel uses the free side, and when both are taken the panel
// replaces the occupant of its preferred side. On narrow viewports panels are
// full width, so only one chrome panel is open at a time.

/** Panel IDs that don't participate in docking / mutual exclusion. */
const independentPanels = new Set(["console"]);

const preferredSide: Record<string, PanelSide> = {
  settings: "right",
  help: "left",
  machine: "right",
};

const [panelSides, setPanelSides] = createSignal<Record<string, PanelSide>>({});

/** Stacking order of open chrome panels; last = topmost. */
const [panelOrder, setPanelOrder] = createSignal<string[]>([]);

/** Per-mounted-panel hooks that move its overlay-stack entry to the top. */
const overlayRaisers = new Map<string, () => void>();

function otherSide(side: PanelSide): PanelSide {
  return side === "left" ? "right" : "left";
}

function openChromePanelIds(): string[] {
  return Object.keys(visibilityGetters).filter(
    (id) => !independentPanels.has(id) && visibilityGetters[id](),
  );
}

/** Pick a side for `panelId`, closing whichever panel must make room. */
function assignSide(panelId: string): PanelSide {
  const preferred = preferredSide[panelId] ?? "right";
  const others = openChromePanelIds().filter((id) => id !== panelId);

  if (isNarrowViewport()) {
    for (const id of others) visibilitySetters[id](false);
    return preferred;
  }

  const sides = panelSides();
  const occupant = (side: PanelSide) => others.find((id) => sides[id] === side);

  let side = preferred;
  if (occupant(preferred)) {
    if (!occupant(otherSide(preferred))) {
      side = otherSide(preferred);
    } else {
      visibilitySetters[occupant(preferred)!](false);
    }
  }
  // Panels without an assigned side (none expected) are closed defensively
  // so that at most two chrome panels are ever open.
  for (const id of others) {
    if (sides[id] == null) visibilitySetters[id](false);
  }
  return side;
}

function openPanel(panelId: string): void {
  const side = assignSide(panelId);
  setPanelSides((prev) => ({ ...prev, [panelId]: side }));
  visibilitySetters[panelId](true);
}

/**
 * Raise an open chrome panel to the top of the paint order and of the
 * overlay stack, so Escape dismisses it first (overlays.md §1.1).
 */
export function raisePanel(panelId: string): void {
  const order = panelOrder();
  if (!order.includes(panelId) || order[order.length - 1] === panelId) return;
  setPanelOrder([...order.filter((id) => id !== panelId), panelId]);
  overlayRaisers.get(panelId)?.();
}

// ---- Public API ----

export function togglePanelVisibility(panelId: string) {
  const getter = visibilityGetters[panelId];
  const setter = visibilitySetters[panelId];
  if (!getter || !setter) return;
  if (getter()) {
    setter(false);
  } else if (independentPanels.has(panelId)) {
    setter(true);
  } else {
    openPanel(panelId);
  }
}

/**
 * Show a specific panel by panelId. An already-open panel is raised.
 */
export function showPanel(panelId: string) {
  const getter = visibilityGetters[panelId];
  const setter = visibilitySetters[panelId];
  if (!getter || !setter) return;
  if (independentPanels.has(panelId)) {
    setter(true);
  } else if (getter()) {
    raisePanel(panelId);
  } else {
    openPanel(panelId);
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

// ---- Application-owned component tree ----

/**
 * Registers a visible chrome panel with the overlay stack (Escape + scroll
 * lock) and the paint order, and raises it on pointer-down / focus-in.
 * Renders a `display: contents` wrapper so it does not affect layout.
 */
function ManagedPanel(props: {
  panelId: string;
  onClose: () => void;
  children: (stackIndex: () => number) => JSX.Element;
}) {
  let popOverlay: (() => void) | undefined;
  let wrapper: HTMLDivElement | undefined;
  const panelId = props.panelId;
  const register = () => pushOverlay(`panel:${panelId}`, () => props.onClose());
  const onInteract = () => raisePanel(panelId);

  onMount(() => {
    popOverlay = register();
    setPanelOrder((order) => [...order.filter((id) => id !== panelId), panelId]);
    // Push the new entry before popping the old one so the scroll-lock
    // reference count never drops to zero during a raise.
    overlayRaisers.set(panelId, () => {
      const previous = popOverlay;
      popOverlay = register();
      previous?.();
    });
    wrapper?.addEventListener("pointerdown", onInteract, true);
    wrapper?.addEventListener("focusin", onInteract);
  });
  onCleanup(() => {
    wrapper?.removeEventListener("pointerdown", onInteract, true);
    wrapper?.removeEventListener("focusin", onInteract);
    overlayRaisers.delete(panelId);
    setPanelOrder((order) => order.filter((id) => id !== panelId));
    popOverlay?.();
  });

  const stackIndex = () => Math.max(0, panelOrder().indexOf(panelId));
  return (
    <div ref={wrapper} class="managed-panel" style={{ display: "contents" }}>
      {props.children(stackIndex)}
    </div>
  );
}

const chromeDesign = () => settings.ui?.panelChrome ?? "pane";
const sideOf = (panelId: string) => panelSides()[panelId] ?? preferredSide[panelId] ?? "right";

export function PanelRoot() {
  return (
    <>
      <Show when={settingsVisible()}>
        <ManagedPanel panelId="settings" onClose={() => setSettingsVisible(false)}>
          {(stackIndex) => (
            <PanelChrome
              panelId="settings"
              title="Settings"
              design={chromeDesign()}
              side={sideOf("settings")}
              stackIndex={stackIndex()}
              onClose={() => setSettingsVisible(false)}
            >
              <SettingsPanel />
            </PanelChrome>
          )}
        </ManagedPanel>
      </Show>

      <Show when={helpVisible()}>
        <ManagedPanel panelId="help" onClose={() => setHelpVisible(false)}>
          {(stackIndex) => (
            <PanelChrome
              panelId="help"
              title="Help"
              design={chromeDesign()}
              side={sideOf("help")}
              stackIndex={stackIndex()}
              onClose={() => setHelpVisible(false)}
            >
              <HelpPanel />
            </PanelChrome>
          )}
        </ManagedPanel>
      </Show>

      {/* the-machine.md §2.4: the schematic's standalone surface. The
          lightest chrome consistent with overlays.md is an ordinary chrome
          panel — it joins the LIFO overlay stack via ManagedPanel, so it
          dismisses on Escape and participates in scroll-lock counting
          (overlays.md §1.1, §1.2) without inventing a new surface kind. */}
      <Show when={machineVisible()}>
        <ManagedPanel panelId="machine" onClose={() => setMachineVisible(false)}>
          {(stackIndex) => (
            <PanelChrome
              panelId="machine"
              title="How uSEQ thinks"
              design={chromeDesign()}
              side={sideOf("machine")}
              stackIndex={stackIndex()}
              onClose={() => setMachineVisible(false)}
            >
              <div class="panel machine-standalone">
                <WiredMachinePanel />
              </div>
            </PanelChrome>
          )}
        </ManagedPanel>
      </Show>

      <Show when={consoleVisible()}>
        <ConsolePanel />
      </Show>
    </>
  );
}

/**
 * Toggle the standalone Machine schematic panel (the-machine.md §2.4).
 */
export function toggleMachinePanel(): void {
  togglePanelVisibility("machine");
}
