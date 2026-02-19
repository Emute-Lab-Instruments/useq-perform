// src/ui/TransportToolbar.tsx
import { createActor } from "xstate";
import { createEffect, on, onCleanup, onMount } from "solid-js";
import { transportMachine } from "../machines/transport.machine";
import type { TransportState } from "../machines/transport.machine";
import { useActorSignal } from "../lib/useActorSignal";
import { Effect } from "effect";
import {
  play, pause, stop, rewind, clear,
  queryHardwareTransportState,
  extractTransportStateFromMeta,
  syncWasmTransportState,
  resolveTransportMode,
  isRealHardwareConnection,
  isWasmEnabled,
} from "../effects/transport";
// @ts-ignore - Importing from legacy .mjs
import {
  startMockTimeGenerator,
  stopMockTimeGenerator,
  resumeMockTimeGenerator,
  resetMockTimeGenerator,
} from "../legacy/io/mockTimeGenerator.ts";
import { ProgressBar } from "./ProgressBar";
import { Play, Pause, Square, Rewind, X } from "lucide-solid";

/**
 * Determine whether the mock time generator should drive visualizations.
 * True when not connected to real hardware but WASM is enabled.
 */
function shouldUseMockTime(): boolean {
  return !isRealHardwareConnection() && isWasmEnabled();
}

const TOP_TOOLBAR_HEIGHT_VAR = "--top-toolbar-height";

/**
 * Measure an element's height using multiple fallback strategies
 * and publish it as a CSS custom property on :root.
 */
function updateToolbarHeightVar(el: HTMLElement) {
  const rect = el.getBoundingClientRect();
  const candidates = [rect?.height, el.offsetHeight, el.scrollHeight];
  let height = 0;
  for (const c of candidates) {
    if (typeof c === "number" && c > height) height = c;
  }
  if (height <= 0 && typeof window !== "undefined" && window.getComputedStyle) {
    const parsed = parseFloat(window.getComputedStyle(el).height || "0");
    if (!Number.isNaN(parsed) && parsed > 0) height = parsed;
  }
  const resolved = Number.isFinite(height) ? Math.ceil(height) : 0;
  document.documentElement.style.setProperty(
    TOP_TOOLBAR_HEIGHT_VAR,
    `${Math.max(0, resolved)}px`
  );
}

export function TransportToolbar() {
  let toolbarRef: HTMLDivElement | undefined;

  const machine = transportMachine.provide({
    actions: {
      emitPlay: () => { Effect.runPromise(play()); },
      emitPause: () => { Effect.runPromise(pause()); },
      emitStop: () => { Effect.runPromise(stop()); },
      emitRewind: () => { Effect.runPromise(rewind()); },
      emitClear: () => { Effect.runPromise(clear()); },
      syncWasmPlay: () => { Effect.runPromise(syncWasmTransportState("playing")).catch(() => undefined); },
      syncWasmPause: () => { Effect.runPromise(syncWasmTransportState("paused")).catch(() => undefined); },
      syncWasmStop: () => { Effect.runPromise(syncWasmTransportState("stopped")).catch(() => undefined); },
    }
  });
  const actor = createActor(machine);

  const { state, send } = useActorSignal(actor);

  actor.start();
  onCleanup(() => actor.stop());

  // --- Mock time generator management ---
  // Track the previous transport state so we can distinguish resume vs fresh start
  let prevTransportState: TransportState = "playing";

  // React to transport state changes and manage mock time generator accordingly
  createEffect(
    on(
      () => state().value as TransportState,
      (current) => {
        const prev = prevTransportState;
        prevTransportState = current;

        if (!shouldUseMockTime()) return;

        if (current === "playing") {
          if (prev === "paused") {
            resumeMockTimeGenerator();
          } else {
            startMockTimeGenerator();
          }
        } else if (current === "paused") {
          stopMockTimeGenerator();
        } else if (current === "stopped") {
          stopMockTimeGenerator();
          resetMockTimeGenerator();
        }
      },
      { defer: true } // Skip initial value -- hardware boots playing, no mock needed at init
    )
  );

  // --- Runtime sync helpers ---

  /** Push a SYNC event into the machine if the state is valid. */
  const syncState = (transportState: TransportState | null) => {
    if (transportState) {
      send({ type: "SYNC", state: transportState });
    }
  };

  /** Refresh the mode context on the machine. */
  const refreshMode = () => {
    send({ type: "UPDATE_MODE", mode: resolveTransportMode() });
  };

  // --- Event handlers ---

  const handleConnectionChanged = (e: Event) => {
    const connected = !!(e as CustomEvent).detail?.connected;

    // Stop mock time generator when real hardware connects (it would interfere)
    if (connected && isRealHardwareConnection()) {
      stopMockTimeGenerator();
    }

    refreshMode();
  };

  const handleProtocolReady = () => {
    // Query hardware for the real transport state and sync the machine.
    Effect.runPromise(queryHardwareTransportState()).then(syncState);
  };

  const handleJsonMeta = (e: Event) => {
    const detail = (e as CustomEvent).detail;
    syncState(extractTransportStateFromMeta(detail));
  };

  const handleSettingsChanged = () => {
    refreshMode();
  };

  // --- Layout height tracking ---
  let resizeObserver: ResizeObserver | undefined;
  const handleWindowResize = () => {
    if (toolbarRef) updateToolbarHeightVar(toolbarRef);
  };

  onMount(() => {
    // Set initial mode
    refreshMode();

    // Wire up runtime sync listeners
    window.addEventListener("useq-connection-changed", handleConnectionChanged);
    window.addEventListener("useq-protocol-ready", handleProtocolReady);
    window.addEventListener("useq-json-meta", handleJsonMeta);
    window.addEventListener("useq-settings-changed", handleSettingsChanged);

    // Track toolbar height -> CSS variable
    if (toolbarRef) {
      updateToolbarHeightVar(toolbarRef);
      // Schedule a second measurement after layout settles
      requestAnimationFrame(() => {
        if (toolbarRef) updateToolbarHeightVar(toolbarRef);
      });

      if (typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(() => {
          if (toolbarRef) updateToolbarHeightVar(toolbarRef);
        });
        resizeObserver.observe(toolbarRef);
      }

      window.addEventListener("resize", handleWindowResize, { passive: true });
    }
  });

  onCleanup(() => {
    window.removeEventListener("useq-connection-changed", handleConnectionChanged);
    window.removeEventListener("useq-protocol-ready", handleProtocolReady);
    window.removeEventListener("useq-json-meta", handleJsonMeta);
    window.removeEventListener("useq-settings-changed", handleSettingsChanged);
    window.removeEventListener("resize", handleWindowResize);
    resizeObserver?.disconnect();
  });

  const isPlaying = () => state().value === "playing";
  const isPaused = () => state().value === "paused";
  const isStopped = () => state().value === "stopped";
  const isModeNone = () => state().context.mode === "none";

  const playButtonClass = () =>
    `toolbar-button ${isModeNone() ? "disabled" : (isPlaying() ? "primary disabled" : "")}`;
  const pauseButtonClass = () =>
    `toolbar-button ${isModeNone() ? "disabled" : `${isPaused() ? "primary disabled" : ""} ${isStopped() ? "disabled" : ""}`}`;
  const stopButtonClass = () =>
    `toolbar-button ${isModeNone() ? "primary disabled" : (isStopped() ? "primary disabled" : "")}`;
  const rewindButtonClass = () =>
    `toolbar-button ${isModeNone() ? "disabled" : ""}`;
  const clearButtonClass = () =>
    `toolbar-button ${isModeNone() ? "disabled" : ""}`;

  const isPlayDisabled = () => isModeNone() || isPlaying();
  const isPauseDisabled = () => isModeNone() || isPaused() || isStopped();
  const isStopDisabled = () => isModeNone() || isStopped();
  const isRewindDisabled = () => isModeNone();
  const isClearDisabled = () => isModeNone();

  return (
    <div id="panel-top-toolbar" ref={toolbarRef}>
      <div class="toolbar-row">
        <button
          class={playButtonClass()}
          title="Play"
          aria-label="Play"
          disabled={isPlayDisabled()}
          onClick={() => !isPlaying() && send({ type: "PLAY" })}
        >
          <Play />
        </button>
        <button
          class={pauseButtonClass()}
          title="Pause"
          aria-label="Pause"
          disabled={isPauseDisabled()}
          onClick={() => !isPaused() && !isStopped() && send({ type: "PAUSE" })}
        >
          <Pause />
        </button>
        <button
          class={stopButtonClass()}
          title="Stop"
          aria-label="Stop"
          disabled={isStopDisabled()}
          onClick={() => !isStopped() && send({ type: "STOP" })}
        >
          <Square />
        </button>
        <button
          class={rewindButtonClass()}
          title="Rewind"
          aria-label="Rewind"
          disabled={isRewindDisabled()}
          onClick={() => send({ type: "REWIND" })}
        >
          <Rewind />
        </button>
        <button
          class={clearButtonClass()}
          title="Clear"
          aria-label="Clear"
          disabled={isClearDisabled()}
          onClick={() => send({ type: "CLEAR" })}
        >
          <X />
        </button>
      </div>
      <ProgressBar />
    </div>
  );
}
