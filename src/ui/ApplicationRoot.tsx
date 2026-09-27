/**
 * The single Solid owner for the main application route.
 *
 * The editor and visualisation canvases remain imperative surfaces, but every
 * Solid component is a descendant of this root. Portals preserve the static
 * toolbar mount-point contract without creating independent reactive owners.
 */
import { Portal, render } from "solid-js/web";
import { onCleanup, onMount } from "solid-js";
import { ConnectedTransportToolbar, WiredMainToolbar, WiredOnboardingBanner } from "./adapters/toolbars";
import { PanelRoot } from "./adapters/panels";
import { ModalRoot } from "./adapters/modal";
import { ToastRoot } from "./adapters/toast";
import { RadialMenuRoot } from "./adapters/radialMenu";
import { MainMenuRoot } from "./adapters/mainMenu";
import { PaletteRoot } from "./adapters/palette";
import { ModifierHintsRoot } from "./adapters/modifier-hints";
import { CalibrationRoot } from "./adapters/calibration";
import { VirtualGamepadRoot } from "./adapters/virtualGamepad";
import { LiveAnnouncer } from "./LiveAnnouncer";
import { WiredLiveEditPanel } from "./adapters/liveEditPanel.tsx";
import { liveEditPersistence, liveEditStore } from "../effects/liveEditRuntime.ts";
import { midiInput, midiLearnController, startLiveEditMidiRuntime } from "../effects/liveEditMidiRuntime.ts";
import { getStartupFlagsSnapshot } from "../runtime/startupContext.ts";
import { connectionChanged } from "../contracts/runtimeChannels.ts";
import { beginCalibration, handleCalibrationDisconnect } from "./adapters/calibrationRuntime.ts";
import { isConnectedToModule, isJsonProtocolActive } from "../transport/index.ts";

export interface ApplicationRootOptions {
  devmode: boolean;
  virtualGamepad: boolean;
}

function claimToolbarSlot(componentId: string, slotId: string): HTMLElement {
  const claimed = document.getElementById(slotId);
  if (claimed) return claimed;

  const placeholder = document.getElementById(componentId);
  if (placeholder) {
    placeholder.id = slotId;
    placeholder.replaceChildren();
    return placeholder;
  }

  const slot = document.createElement("div");
  slot.id = slotId;
  document.body.appendChild(slot);
  return slot;
}

function ApplicationRoot(props: ApplicationRootOptions & {
  transportSlot: HTMLElement;
  mainToolbarSlot: HTMLElement;
}) {
  function CalibrationUrlEntry() {
    onMount(() => {
      if (getStartupFlagsSnapshot().params.calibrate !== "1") return;
      let opened = false;
      const maybeOpen = (connected: boolean) => {
        if (connected && !opened) opened = beginCalibration();
        else if (!connected && opened) {
          opened = false;
          handleCalibrationDisconnect();
        }
      };
      const unsubscribe = connectionChanged.subscribe(({ connected, protocolMode }) => {
        maybeOpen(connected && protocolMode === "json");
      });
      onCleanup(unsubscribe);
      maybeOpen(isConnectedToModule() && isJsonProtocolActive());
    });
    return null;
  }

  return (
    <>
      <Portal mount={props.transportSlot}>
        <ConnectedTransportToolbar />
      </Portal>
      <Portal mount={props.mainToolbarSlot}>
        <WiredMainToolbar />
      </Portal>

      <div id="onboarding-banner-root"><WiredOnboardingBanner /></div>
      <div id="live-announcer-root"><LiveAnnouncer /></div>
      <div id="live-edit-panel-root"><WiredLiveEditPanel store={liveEditStore} persistence={liveEditPersistence} learnController={midiLearnController} midiInput={midiInput} /></div>
      <CalibrationUrlEntry />
      <div id="solid-panel-root"><PanelRoot /></div>
      <div id="solid-modal-root" style={{ position: "fixed", inset: "0", "z-index": "var(--z-modal-backdrop, 1000)", "pointer-events": "none" }}><ModalRoot /></div>
      <div id="solid-toast-root"><ToastRoot /></div>
      <div id="radial-menu-root" style={{ position: "fixed", inset: "0", "z-index": "var(--z-toast, 1100)", "pointer-events": "none" }}><RadialMenuRoot /></div>
      <div id="main-menu-root" style={{ position: "fixed", inset: "0", "z-index": "calc(var(--z-toast, 1100) + 100)", "pointer-events": "none" }}><MainMenuRoot /></div>
      <div id="solid-palette-root" style={{ position: "fixed", inset: "0", "z-index": "var(--z-takeover, 2000)", "pointer-events": "none" }}><PaletteRoot /></div>
      <div id="solid-modifier-hints-root" style={{ position: "fixed", inset: "0", "z-index": "calc(var(--z-takeover, 2000) + 100)", "pointer-events": "none" }}><ModifierHintsRoot /></div>
      <div id="solid-calibration-root" style={{ position: "fixed", inset: "0", width: "100vw", height: "100vh", "z-index": "calc(var(--z-takeover, 2000) + 7999)", "pointer-events": "none" }}><CalibrationRoot /></div>
      {props.virtualGamepad ? (
        <div id="virtual-gamepad-root" style={{ position: "fixed", bottom: "16px", right: "16px", width: "400px", "z-index": "calc(var(--z-takeover, 2000) + 7999)", opacity: 0.85, "pointer-events": "auto" }}>
          <VirtualGamepadRoot />
        </div>
      ) : null}
    </>
  );
}

export interface ApplicationRootHandle {
  dispose(): void;
}

/** Mount exactly one Solid reactive owner for the main application route. */
export function mountApplicationRoot(options: ApplicationRootOptions): ApplicationRootHandle {
  const host = document.createElement("div");
  host.id = "useq-application-root";
  document.body.appendChild(host);
  const stopMidiRuntime = startLiveEditMidiRuntime();

  const disposeSolid = render(
    () => (
      <ApplicationRoot
        {...options}
        transportSlot={claimToolbarSlot("panel-top-toolbar", "panel-top-toolbar-root")}
        mainToolbarSlot={claimToolbarSlot("panel-toolbar", "panel-toolbar-root")}
      />
    ),
    host,
  );

  let disposed = false;
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      disposeSolid();
      stopMidiRuntime();
      host.remove();
    },
  };
}
