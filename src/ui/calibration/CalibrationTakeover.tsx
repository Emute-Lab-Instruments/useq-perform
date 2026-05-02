// src/ui/calibration/CalibrationTakeover.tsx
//
// Full-screen calibration takeover overlay (docs/specs/calibration.md §3, §5, §6, §7).
//
// Pure prop-driven UI. The state machine driving session state lives in
// gii8.60; this component just reflects `session` and emits user gestures.
//
// Layout (single focal column, generous negative space):
//   - Output id (large)
//   - Target voltage ("1.000 V")
//   - Offset cents
//   - Adjust slider
//   - Progress ribbon (Step N of 5  ● ● ○ ○ ○)
//   - One of:
//       Complete banner (session.complete)
//       Error block + Retry/Abort (session.error)
//       Abort confirm + Discard/Keep-going (session.abortConfirm)
//       Action buttons (Save & next / Skip / Abort) — default

import { Match, Show, Switch, createMemo } from "solid-js";
import {
  CALIBRATION_TARGET_VOLTS,
  type CalibrationOctaveIndex,
  type CalibrationOutput,
  type CalibrationSession,
} from "../../contracts/hardware";
import { CalibrationCompleteBanner } from "./CalibrationCompleteBanner";
import { CalibrationProgress } from "./CalibrationProgress";
import { CalibrationSlider } from "./CalibrationSlider";

export interface CalibrationTakeoverProps {
  session: CalibrationSession;
  /** Other outputs to offer in the §5.4 next-output picker (excludes current). */
  nextOutputs?: CalibrationOutput[];
  onAdjust: (deltaCents: number) => void;
  onSaveAndNext: () => void;
  onSkip: () => void;
  /** First press: opens the abort confirm. (No-op if already in confirm.) */
  onAbort: () => void;
  /** From the abort confirm: discard=true sends calibrate-end{commit:false}. */
  onAbortConfirm: (discard: boolean) => void;
  /** Retry the last save-point send. */
  onRetrySave: () => void;
  /** From the complete banner; null = Done. */
  onRequestNextOutput: (outputId: string | null) => void;
}

function formatVolts(step: CalibrationOctaveIndex): string {
  return `${CALIBRATION_TARGET_VOLTS[step].toFixed(3)} V`;
}

function formatCents(cents: number): string {
  const abs = Math.abs(cents);
  const sign = cents > 0 ? "+" : cents < 0 ? "−" : "";
  return `${sign}${abs.toFixed(1)} cents`;
}

/** True if user has saved at least one octave (drives §6.5 abort skip). */
function hasAnySaved(session: CalibrationSession): boolean {
  return Object.values(session.stepStatus).some((s) => s === "saved");
}

function savedCount(session: CalibrationSession): number {
  return Object.values(session.stepStatus).filter((s) => s === "saved").length;
}

export function CalibrationTakeover(props: CalibrationTakeoverProps) {
  const inDetent = createMemo(() => Math.abs(props.session.offsetCents) <= 0.3);

  // Saved-point flash: visual cue that the current step is saved.
  // Approximate via prop snapshot — see §5.2.
  const showSavedFlash = createMemo(
    () =>
      !props.session.saving &&
      props.session.stepStatus[props.session.step] === "saved" &&
      !props.session.complete
  );

  const handleAbortClick = () => {
    if (!hasAnySaved(props.session)) {
      // §6.5 — exit directly with no confirm.
      props.onAbortConfirm(true);
      return;
    }
    props.onAbort();
  };

  // Decide which body block to render.
  type BodyMode = "complete" | "error" | "abort-confirm" | "actions";
  const bodyMode = (): BodyMode => {
    if (props.session.complete) return "complete";
    if (props.session.error) return "error";
    if (props.session.abortConfirm) return "abort-confirm";
    return "actions";
  };

  return (
    <div
      class="cal-takeover-root"
      role="dialog"
      aria-modal="true"
      aria-label="CV calibration"
    >
      <div class="cal-column">
        <h1 class="cal-output-id">{props.session.output}</h1>

        <div
          class={`cal-target-volts${showSavedFlash() ? " cal-flash-saved" : ""}`}
        >
          <span>{formatVolts(props.session.step)}</span>
          <Show when={showSavedFlash()}>
            <span class="cal-saved-check" aria-hidden="true">
              ✓
            </span>
          </Show>
        </div>

        <hr class="cal-divider" />

        <p class={`cal-offset-cents${inDetent() ? " cal-detent" : ""}`}>
          {formatCents(props.session.offsetCents)}
        </p>

        <CalibrationSlider
          offsetCents={props.session.offsetCents}
          onAdjust={props.onAdjust}
          onSnapZero={() => {
            /* visual-only — offset is already in detent via onAdjust. */
          }}
        />

        <CalibrationProgress
          current={props.session.step}
          stepStatus={props.session.stepStatus}
        />

        <Switch>
          <Match when={bodyMode() === "complete"}>
            <CalibrationCompleteBanner
              output={props.session.output}
              nextOutputs={props.nextOutputs ?? []}
              onRequestNextOutput={props.onRequestNextOutput}
            />
          </Match>

          <Match when={bodyMode() === "error"}>
            <div class="cal-error-block" role="alert">
              <p class="cal-error-title">Error: save failed.</p>
              <p class="cal-error-message">{props.session.error}</p>
              <div class="cal-btn-row">
                <button
                  class="cal-btn cal-btn-primary"
                  type="button"
                  onClick={props.onRetrySave}
                >
                  Retry save
                </button>
                <button
                  class="cal-btn cal-btn-danger"
                  type="button"
                  onClick={handleAbortClick}
                >
                  Abort
                </button>
              </div>
            </div>
          </Match>

          <Match when={bodyMode() === "abort-confirm"}>
            <div class="cal-abort-confirm" role="alertdialog">
              <p class="cal-abort-prompt">
                Discard partial calibration of {props.session.output}?
              </p>
              <p class="cal-abort-detail">
                You've saved {savedCount(props.session)} of 5 points.
              </p>
              <div class="cal-btn-row">
                <button
                  class="cal-btn cal-btn-danger"
                  type="button"
                  onClick={() => props.onAbortConfirm(true)}
                >
                  Discard
                </button>
                <button
                  class="cal-btn cal-btn-primary"
                  type="button"
                  onClick={() => props.onAbortConfirm(false)}
                >
                  Keep going
                </button>
              </div>
            </div>
          </Match>

          <Match when={bodyMode() === "actions"}>
            <div class="cal-actions">
              <button
                class="cal-btn cal-btn-primary"
                type="button"
                autofocus
                onClick={props.onSaveAndNext}
                disabled={props.session.saving}
              >
                {props.session.saving ? "Saving…" : "Save & next →"}
              </button>
              <div class="cal-btn-row">
                <button
                  class="cal-btn"
                  type="button"
                  onClick={props.onSkip}
                  disabled={props.session.saving}
                >
                  Skip
                </button>
                <button
                  class="cal-btn cal-btn-danger"
                  type="button"
                  onClick={handleAbortClick}
                >
                  Abort
                </button>
              </div>
              <p class="cal-helper">
                Move your tuner to output {props.session.output}. Adjust until
                the reading is exact, then press Save.
              </p>
            </div>
          </Match>
        </Switch>
      </div>
    </div>
  );
}
