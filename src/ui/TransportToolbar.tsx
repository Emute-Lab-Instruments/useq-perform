// src/ui/TransportToolbar.tsx
//
// Pure view component: renders transport controls and sends intents.
// All side-effects (mock-time clock, runtime sync, WASM mirroring) are
// owned by the transport orchestrator -- see effects/transportOrchestrator.ts.
//
// Receives state and callbacks as props. The adapter layer
// (adapters/toolbars.tsx) wires the real orchestrator into props.

import { For, Show, onCleanup, onMount, type JSX } from "solid-js";
import { ProgressBar } from "./ProgressBar";
import { BpmControl } from "./toolbar/BpmControl";
import { withShortcut } from "./toolbar/shortcutLabels";
import { Play, Pause, Square, Rewind, X } from "lucide-solid";

export type TransportAction = "play" | "pause" | "stop" | "rewind" | "clear";

export interface TransportToolbarProps {
  state: "playing" | "paused" | "stopped";
  mode: "none" | "wasm" | "hardware" | "both";
  /** Bar phase in [0, 1]. */
  progress: number;
  /** Current BPM reported by the WASM runtime, or null when unavailable. */
  bpm?: number | null;
  /** Beats per bar reported by the runtime; drives the progress-bar ticks. */
  beatsPerBar?: number | null;
  /** Commit a new tempo (from the editable BPM chip) to the active runtime(s). */
  onBpmCommit?: (bpm: number) => void;
  /** Display shortcuts for transport actions, already formatted by the adapter. */
  shortcuts?: Partial<Record<TransportAction, string>>;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onRewind: () => void;
  onClear: () => void;
  /** Transport-family status indicators rendered inside the toolbar. */
  children?: JSX.Element;
}

const STATE_LABELS: Record<TransportToolbarProps["state"], string> = {
  playing: "Playing",
  paused: "Paused",
  stopped: "Stopped",
};

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

export function TransportToolbar(props: TransportToolbarProps) {
  let toolbarRef: HTMLDivElement | undefined;

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
  //
  // transport.md §1.7: the button for the current state is shown lit
  // (`is-active`, aria-pressed) rather than faded; only genuinely unavailable
  // actions are disabled. Pressing the lit button is a no-op (the machine
  // ignores PLAY while playing etc.). In `none` mode every control is inert
  // and nothing is lit.
  const isModeNone = () => props.mode === "none";
  const isActive = (state: TransportToolbarProps["state"]) =>
    !isModeNone() && props.state === state;

  interface ButtonSpec {
    action: TransportAction;
    label: string;
    icon: () => JSX.Element;
    /** Transport state this button represents, if it is a state button. */
    represents?: TransportToolbarProps["state"];
    disabled: () => boolean;
    run: () => void;
  }

  const buttons: ButtonSpec[] = [
    {
      action: "play", label: "Play", icon: () => <Play />, represents: "playing",
      disabled: () => isModeNone(),
      run: () => props.onPlay(),
    },
    {
      action: "pause", label: "Pause", icon: () => <Pause />, represents: "paused",
      // Pausing from stopped is meaningless (§1.2): genuinely unavailable.
      disabled: () => isModeNone() || props.state === "stopped",
      run: () => props.onPause(),
    },
    {
      action: "stop", label: "Stop", icon: () => <Square />, represents: "stopped",
      disabled: () => isModeNone(),
      run: () => props.onStop(),
    },
    {
      action: "rewind", label: "Rewind", icon: () => <Rewind />,
      disabled: () => isModeNone(),
      run: () => props.onRewind(),
    },
    {
      action: "clear", label: "Clear", icon: () => <X />,
      disabled: () => isModeNone(),
      run: () => props.onClear(),
    },
  ];

  const bpmValue = () => {
    const v = props.bpm;
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };

  const beats = () => {
    const v = props.beatsPerBar;
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined;
  };

  return (
    <div
      id="panel-top-toolbar"
      ref={toolbarRef}
      data-transport-state={isModeNone() ? "inert" : props.state}
    >
      <div class="transport-side transport-side-start">
        <div
          class="transport-state"
          classList={{
            "is-playing": isActive("playing"),
            "is-inert": isModeNone(),
          }}
          role="status"
          aria-live="polite"
          title={isModeNone() ? "Transport inactive: no runtime available" : `Transport: ${STATE_LABELS[props.state]}`}
        >
          <span class="transport-state-dot" aria-hidden="true" />
          <span class="transport-state-label">
            {isModeNone() ? "No runtime" : STATE_LABELS[props.state]}
          </span>
        </div>
        <Show when={bpmValue() !== null}>
          <BpmControl
            bpm={bpmValue() as number}
            onCommit={(value) => props.onBpmCommit?.(value)}
          />
        </Show>
      </div>
      <div class="transport-center">
        <div class="toolbar-row transport-row" role="group" aria-label="Transport">
          <For each={buttons}>
            {(button) => {
              const active = () => button.represents !== undefined && isActive(button.represents);
              const title = () => withShortcut(button.label, props.shortcuts?.[button.action]);
              return (
                <button
                  type="button"
                  class="toolbar-button transport-button"
                  classList={{
                    "is-active": active(),
                    disabled: button.disabled(),
                  }}
                  title={title()}
                  aria-label={button.label}
                  aria-pressed={button.represents !== undefined ? active() : undefined}
                  disabled={button.disabled()}
                  onClick={() => {
                    if (button.disabled() || active()) return;
                    button.run();
                  }}
                >
                  {button.icon()}
                </button>
              );
            }}
          </For>
        </div>
        <ProgressBar progress={props.progress} beats={beats()} />
      </div>
      <div class="transport-side transport-side-end">{props.children}</div>
    </div>
  );
}
