// src/ui/TransportToolbar.tsx
//
// Pure view component: renders transport controls and sends intents.
// All side-effects (mock-time clock, runtime sync, WASM mirroring) are
// owned by the transport orchestrator -- see effects/transportOrchestrator.ts.

import { onCleanup, onMount } from "solid-js";
import { useActorSignal } from "../lib/useActorSignal";
import { getTransportOrchestrator } from "../effects/transportOrchestrator";
import { ProgressBar } from "./ProgressBar";
import { Play, Pause, Square, Rewind, X } from "lucide-solid";

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

  // Obtain the singleton orchestrator (creates it on first call).
  const orchestrator = getTransportOrchestrator();

  // Bind the actor's state to a Solid signal for reactivity.
  const { state, send } = useActorSignal(orchestrator.actor as any);

  // --- Layout height tracking ---
  let resizeObserver: ResizeObserver | undefined;
  const handleWindowResize = () => {
    if (toolbarRef) updateToolbarHeightVar(toolbarRef);
  };

  onMount(() => {
    if (toolbarRef) {
      updateToolbarHeightVar(toolbarRef);
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
    window.removeEventListener("resize", handleWindowResize);
    resizeObserver?.disconnect();
  });

  // --- Derived state ---
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
