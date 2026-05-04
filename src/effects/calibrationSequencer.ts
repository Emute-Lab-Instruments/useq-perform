// src/effects/calibrationSequencer.ts
//
// Per-output octave test-signal sequencer for the CV 1V/oct calibration flow.
//
// Spec: docs/specs/calibration.md
// Pure module -- no DOM, no SolidJS.  All firmware interaction is abstracted
// behind CalibrationTransport, making the sequencer testable without hardware.
//
// States: idle -> picking -> calibrating -> saving -> complete | error
//         (abort can return to idle from calibrating or saving)
//
// The sequencer issues wire-protocol commands via the injected transport and
// maintains a CalibrationSession snapshot that the UI reads reactively.

import type {
  CalibrationOctaveIndex,
  CalibrationOutput,
  CalibrationSession,
  CalibrationStepStatus,
} from "../contracts/hardware";

// ── Transport interface (dependency injection seam) ──────────────────────────

/**
 * Minimal transport surface the sequencer needs. In production this is wired
 * to writeJsonRequest / sendTouSEQ; in tests it's a simple mock.
 */
export interface CalibrationTransport {
  /**
   * Send calibrate-begin. Resolves on firmware ack; rejects with a reason
   * string on firmware rejection (spec ??2.4, ??7.1).
   */
  calibrateBegin(output: string): Promise<void>;

  /**
   * Send calibrate-set-target. Resolves on ack; rejects on rejection (??7.2).
   */
  calibrateSetTarget(output: string, voltage: number): Promise<void>;

  /**
   * Send calibrate-adjust. Resolves on ack. May resolve with an authoritative
   * offset (cents) if the firmware clamped the value (??4.5); undefined means
   * the firmware accepted the delta as-is.
   */
  calibrateAdjust(
    output: string,
    deltaCents: number,
  ): Promise<number | undefined>;

  /**
   * Send calibrate-save-point. Resolves on ack; rejects on rejection (??7.2).
   */
  calibrateSavePoint(
    output: string,
    octave: CalibrationOctaveIndex,
  ): Promise<void>;

  /**
   * Send calibrate-end. `commit: true` flushes to flash; `commit: false`
   * reverts to pre-takeover state (??6.3).
   */
  calibrateEnd(commit: boolean): Promise<void>;
}

// ── Sequencer state ──────────────────────────────────────────────────────────

/** Top-level sequencer phase. */
export type SequencerPhase =
  | "idle"
  | "picking"
  | "calibrating"
  | "saving"
  | "complete"
  | "error";

/**
 * Full sequencer snapshot. The UI adapter reads this and maps it to component
 * props. Listeners are notified on every state transition.
 */
export interface SequencerState {
  phase: SequencerPhase;

  /** Outputs available for calibration (populated on entering picking). */
  outputs: CalibrationOutput[];

  /** Active session -- non-null during calibrating / saving / complete / error. */
  session: CalibrationSession | null;

  /** Inline error from calibrate-begin rejection (shown on picker, ??7.1). */
  pickerError?: string;

  /** Firmware rejection message during mid-takeover error (??7.2). */
  lastError?: string;
}

// ── Listener type ────────────────────────────────────────────────────────────

export type SequencerListener = (state: SequencerState) => void;

// ── Controller interface ─────────────────────────────────────────────────────

export interface CalibrationSequencer {
  /** Current snapshot. */
  readonly state: SequencerState;

  /**
   * Open the picker with the given list of outputs.
   * Transitions: idle -> picking.
   */
  openPicker(outputs: CalibrationOutput[]): void;

  /**
   * User picks an output from the picker. Sends calibrate-begin.
   * Transitions: picking -> calibrating (on ack) or stays picking (on rejection).
   */
  pickOutput(
    outputId: string,
    mode: "fresh" | "resume" | "restart",
  ): Promise<void>;

  /**
   * Cancel the picker (back to idle). No wire command.
   * Transitions: picking -> idle.
   */
  cancelPicker(): void;

  /**
   * User adjusts the slider. Sends calibrate-adjust delta.
   * Only valid during calibrating phase.
   */
  adjust(deltaCents: number): Promise<void>;

  /**
   * User presses "Save & next". Sends calibrate-save-point, then
   * advances to the next octave or completes.
   * Transitions: calibrating -> saving -> calibrating (next step) or complete.
   */
  saveAndNext(): Promise<void>;

  /**
   * User presses "Skip". Advances without saving.
   * Transitions: calibrating -> calibrating (next step) or complete.
   */
  skip(): Promise<void>;

  /**
   * User presses "Abort". Opens the abort confirm prompt.
   * Transitions: calibrating -> calibrating (with abortConfirm=true).
   */
  requestAbort(): void;

  /**
   * User responds to the abort confirm.
   * discard=true: sends calibrate-end{commit:false}, transitions to idle.
   * discard=false: dismisses confirm, stays on current step.
   */
  confirmAbort(discard: boolean): Promise<void>;

  /**
   * Retry the last failed save-point.
   * Transitions: error -> saving -> calibrating (on success) or error (on failure).
   */
  retrySave(): Promise<void>;

  /**
   * From the complete banner: start calibrating a new output, or exit.
   * outputId=null -> idle. Otherwise -> picking -> calibrating for that output.
   */
  requestNextOutput(outputId: string | null): Promise<void>;

  /**
   * Hardware disconnect mid-takeover. Sends no wire command (cable is gone).
   * Transitions: any -> idle.
   */
  handleDisconnect(): void;

  /** Subscribe to state changes. Returns an unsubscribe function. */
  onStateChanged(handler: SequencerListener): () => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const OCTAVE_STEPS: CalibrationOctaveIndex[] = [0, 1, 2, 3, 4];

const TARGET_VOLTS: Record<CalibrationOctaveIndex, number> = {
  0: 0,
  1: 1,
  2: 2,
  3: 3,
  4: 4,
};

function freshStepStatus(): Record<CalibrationOctaveIndex, CalibrationStepStatus> {
  return { 0: "pending", 1: "pending", 2: "pending", 3: "pending", 4: "pending" };
}

function nextStep(
  current: CalibrationOctaveIndex,
): CalibrationOctaveIndex | null {
  const idx = OCTAVE_STEPS.indexOf(current);
  if (idx < 0 || idx >= OCTAVE_STEPS.length - 1) return null;
  return OCTAVE_STEPS[idx + 1];
}

function resumeStep(
  savedOctaves: number[],
): CalibrationOctaveIndex {
  // Find the first octave not in savedOctaves.
  for (const step of OCTAVE_STEPS) {
    if (!savedOctaves.includes(step)) return step;
  }
  return 0; // All saved -- start over (shouldn't happen, but safe).
}

function resumeStepStatus(
  savedOctaves: number[],
): Record<CalibrationOctaveIndex, CalibrationStepStatus> {
  const status = freshStepStatus();
  for (const octave of savedOctaves) {
    if (octave >= 0 && octave <= 4) {
      status[octave as CalibrationOctaveIndex] = "saved";
    }
  }
  return status;
}

// ── Factory ──────────────────────────────────────────────────────────────────

export function createCalibrationSequencer(
  transport: CalibrationTransport,
): CalibrationSequencer {
  const listeners = new Set<SequencerListener>();

  let _state: SequencerState = {
    phase: "idle",
    outputs: [],
    session: null,
  };

  function setState(next: SequencerState): void {
    _state = next;
    for (const handler of listeners) {
      handler(next);
    }
  }

  function updateSession(patch: Partial<CalibrationSession>): void {
    if (!_state.session) return;
    setState({
      ..._state,
      session: { ..._state.session, ...patch },
    });
  }

  function makeSession(
    output: string,
    step: CalibrationOctaveIndex,
    stepStatus: Record<CalibrationOctaveIndex, CalibrationStepStatus>,
  ): CalibrationSession {
    return {
      output,
      step,
      offsetCents: 0,
      stepStatus,
      saving: false,
      abortConfirm: false,
      complete: false,
    };
  }

  /** Advance to the next octave or enter complete state. */
  async function advanceOrComplete(
    output: string,
    currentStep: CalibrationOctaveIndex,
    carryOffset: number,
  ): Promise<void> {
    const next = nextStep(currentStep);
    if (next === null) {
      // Last step -- complete.
      try {
        await transport.calibrateEnd(true);
        updateSession({ complete: true, saving: false });
        setState({ ..._state, phase: "complete" });
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : String(err);
        updateSession({ error: msg, saving: false });
        setState({ ..._state, phase: "error", lastError: msg });
      }
      return;
    }

    // Send set-target for the next octave.
    try {
      await transport.calibrateSetTarget(output, TARGET_VOLTS[next]);
      updateSession({
        step: next,
        offsetCents: carryOffset,
        saving: false,
        error: undefined,
      });
      setState({ ..._state, phase: "calibrating" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      updateSession({ error: msg, saving: false });
      setState({ ..._state, phase: "error", lastError: msg });
    }
  }

  return {
    get state(): SequencerState {
      return _state;
    },

    openPicker(outputs: CalibrationOutput[]): void {
      setState({
        phase: "picking",
        outputs,
        session: null,
        pickerError: undefined,
      });
    },

    async pickOutput(
      outputId: string,
      mode: "fresh" | "resume" | "restart",
    ): Promise<void> {
      if (_state.phase !== "picking") return;

      try {
        await transport.calibrateBegin(outputId);
      } catch (err) {
        // ??7.1 -- inline error on picker.
        const msg = err instanceof Error ? err.message : String(err);
        setState({ ..._state, pickerError: `${outputId} calibration unavailable: ${msg}` });
        return;
      }

      // Determine starting step and status based on mode.
      const outputInfo = _state.outputs.find((o) => o.id === outputId);
      let step: CalibrationOctaveIndex = 0;
      let stepStatus = freshStepStatus();

      if (mode === "resume" && outputInfo?.status.kind === "partial") {
        step = resumeStep(outputInfo.status.savedOctaves);
        stepStatus = resumeStepStatus(outputInfo.status.savedOctaves);
      }
      // "restart" and "fresh" both start at 0 with clean status.

      const session = makeSession(outputId, step, stepStatus);

      // Send set-target for the initial octave.
      try {
        await transport.calibrateSetTarget(outputId, TARGET_VOLTS[step]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setState({
          ..._state,
          phase: "error",
          session: { ...session, error: msg },
          lastError: msg,
        });
        return;
      }

      setState({
        phase: "calibrating",
        outputs: _state.outputs,
        session,
      });
    },

    cancelPicker(): void {
      if (_state.phase !== "picking") return;
      setState({ phase: "idle", outputs: [], session: null });
    },

    async adjust(deltaCents: number): Promise<void> {
      if (_state.phase !== "calibrating" || !_state.session) return;

      const result = await transport.calibrateAdjust(
        _state.session.output,
        deltaCents,
      );

      if (result !== undefined) {
        // Firmware clamped -- snap to authoritative value (??4.5).
        updateSession({ offsetCents: result });
      } else {
        updateSession({
          offsetCents: _state.session.offsetCents + deltaCents,
        });
      }
    },

    async saveAndNext(): Promise<void> {
      if (
        (_state.phase !== "calibrating" && _state.phase !== "error") ||
        !_state.session
      )
        return;

      const { output, step, offsetCents } = _state.session;

      updateSession({ saving: true, error: undefined });
      setState({ ..._state, phase: "saving" });

      try {
        await transport.calibrateSavePoint(output, step);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        updateSession({
          saving: false,
          error: msg,
        });
        setState({ ..._state, phase: "error", lastError: msg });
        return;
      }

      // Mark this step as saved.
      const newStatus = {
        ..._state.session!.stepStatus,
        [step]: "saved" as CalibrationStepStatus,
      };
      updateSession({ stepStatus: newStatus, saving: false });

      // Carry forward the current offset for the next step (??4.3).
      await advanceOrComplete(output, step, offsetCents);
    },

    async skip(): Promise<void> {
      if (_state.phase !== "calibrating" || !_state.session) return;

      const { output, step } = _state.session;

      // Mark as skipped (??5.3).
      const newStatus = {
        ..._state.session.stepStatus,
        [step]: "skipped" as CalibrationStepStatus,
      };
      updateSession({ stepStatus: newStatus });

      // Advance with zero carry offset on skip.
      await advanceOrComplete(output, step, 0);
    },

    requestAbort(): void {
      if (
        (_state.phase !== "calibrating" && _state.phase !== "error") ||
        !_state.session
      )
        return;
      updateSession({ abortConfirm: true });
    },

    async confirmAbort(discard: boolean): Promise<void> {
      if (!_state.session) return;

      if (!discard) {
        // Keep going -- dismiss the confirm.
        updateSession({ abortConfirm: false });
        return;
      }

      // Discard: send calibrate-end{commit:false} (??6.2).
      try {
        await transport.calibrateEnd(false);
      } catch {
        // Best effort -- the cable may be gone. Still transition to idle.
      }

      setState({ phase: "idle", outputs: [], session: null });
    },

    async retrySave(): Promise<void> {
      if (_state.phase !== "error" || !_state.session) return;

      // Re-issue the same save-point.
      await this.saveAndNext();
    },

    async requestNextOutput(outputId: string | null): Promise<void> {
      if (_state.phase !== "complete") return;

      if (outputId === null) {
        // Done -- exit to idle.
        setState({ phase: "idle", outputs: [], session: null });
        return;
      }

      // Chain to next output: re-enter picking, then auto-pick.
      setState({
        phase: "picking",
        outputs: _state.outputs,
        session: null,
        pickerError: undefined,
      });
      await this.pickOutput(outputId, "fresh");
    },

    handleDisconnect(): void {
      // ??6.4 -- hardware disconnect mid-takeover.
      setState({ phase: "idle", outputs: [], session: null });
    },

    onStateChanged(handler: SequencerListener): () => void {
      listeners.add(handler);
      return () => {
        listeners.delete(handler);
      };
    },
  };
}
