// src/ui/adapters/calibration.tsx
//
// Adapter that bridges the CalibrationSequencer (pure state machine) to the
// CalibrationTakeover and CalibrationPicker UI components.
//
// Uses createSolidAdapter for mount lifecycle and reactive Solid signals to
// push sequencer state changes into the component tree.

import { Show, createSignal, createMemo, onCleanup } from "solid-js";
import { createSolidAdapter } from "./createSolidAdapter";
import { CalibrationTakeover } from "../calibration/CalibrationTakeover";
import { CalibrationPicker } from "../calibration/CalibrationPicker";
import type {
  CalibrationSequencer,
  SequencerState,
} from "../../effects/calibrationSequencer";
import type { CalibrationOutput } from "../../contracts/hardware";

// ── Wired state signal ───────────────────────────────────────────────────────

/**
 * Module-level signal holding the current sequencer. Null when no calibration
 * flow is active. The adapter reads from this to derive component props.
 */
const [sequencerRef, setSequencerRef] = createSignal<CalibrationSequencer | null>(null);
const [snapshot, setSnapshot] = createSignal<SequencerState>({
  phase: "idle",
  outputs: [],
  session: null,
});

let unsubscribe: (() => void) | undefined;

/**
 * Wire a CalibrationSequencer to the adapter. Call when the user opens the
 * calibration flow; call `unwireCalibrationSequencer()` on exit.
 */
export function wireCalibrationSequencer(seq: CalibrationSequencer): void {
  unsubscribe?.();
  setSequencerRef(seq);
  setSnapshot({ ...seq.state });
  unsubscribe = seq.onStateChanged((s) => setSnapshot({ ...s }));
}

/**
 * Disconnect the sequencer from the adapter. The overlay will unmount.
 */
export function unwireCalibrationSequencer(): void {
  unsubscribe?.();
  unsubscribe = undefined;
  setSequencerRef(null);
  setSnapshot({ phase: "idle", outputs: [], session: null });
}

// ── Solid component tree ─────────────────────────────────────────────────────

function CalibrationRoot() {
  const seq = sequencerRef;
  const state = snapshot;

  // Compute next outputs (for the complete banner) by filtering out the current.
  const nextOutputs = createMemo<CalibrationOutput[]>(() => {
    const s = state();
    if (!s.session) return s.outputs;
    return s.outputs.filter((o) => o.id !== s.session!.output);
  });

  onCleanup(() => {
    unwireCalibrationSequencer();
  });

  return (
    <>
      <Show when={state().phase === "picking"}>
        <div class="cal-overlay-backdrop" role="presentation">
          <CalibrationPicker
            outputs={state().outputs}
            pendingError={state().pickerError}
            onPick={(outputId, mode) => seq()?.pickOutput(outputId, mode)}
            onCancel={() => seq()?.cancelPicker()}
          />
        </div>
      </Show>

      <Show
        when={
          state().session &&
          (state().phase === "calibrating" ||
            state().phase === "saving" ||
            state().phase === "complete" ||
            state().phase === "error")
        }
      >
        <CalibrationTakeover
          session={state().session!}
          nextOutputs={nextOutputs()}
          onAdjust={(delta) => seq()?.adjust(delta)}
          onSaveAndNext={() => seq()?.saveAndNext()}
          onSkip={() => seq()?.skip()}
          onAbort={() => seq()?.requestAbort()}
          onAbortConfirm={(discard) => seq()?.confirmAbort(discard)}
          onRetrySave={() => seq()?.retrySave()}
          onRequestNextOutput={(id) => seq()?.requestNextOutput(id)}
        />
      </Show>
    </>
  );
}

// ── Solid adapter ────────────────────────────────────────────────────────────

const calibrationAdapter = createSolidAdapter({
  containerId: "solid-calibration-root",
  Component: () => <CalibrationRoot />,
  containerStyle: {
    position: "fixed",
    top: "0",
    left: "0",
    width: "100vw",
    height: "100vh",
    zIndex: "9999",
    pointerEvents: "none",
  },
});

/**
 * Mount the calibration overlay container. Safe to call multiple times.
 * The overlay only renders content when a sequencer is wired.
 */
export function mountCalibrationOverlay(): void {
  calibrationAdapter.mount();
}

/**
 * Dispose the calibration overlay entirely.
 */
export function disposeCalibrationOverlay(): void {
  unwireCalibrationSequencer();
  calibrationAdapter.dispose();
}
