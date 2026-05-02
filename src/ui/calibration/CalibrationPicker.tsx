// src/ui/calibration/CalibrationPicker.tsx
//
// Pre-flight picker (docs/specs/calibration.md §2.2, §2.3, §7.1).
// Lists every analog output with its calibration status, lets the user
// pick fresh / resume / restart, and surfaces any inline error from a
// previous calibrate-begin rejection.

import { For, Show } from "solid-js";
import type {
  CalibrationOutput,
  CalibrationStatus,
} from "../../contracts/hardware";

export interface CalibrationPickerProps {
  outputs: CalibrationOutput[];
  /** Pick mode: 'fresh' = uncalibrated/recalibrate, 'resume'/'restart' = partial. */
  onPick: (outputId: string, mode: "fresh" | "resume" | "restart") => void;
  onCancel: () => void;
  /** §7.1 — inline error from previous calibrate-begin rejection. */
  pendingError?: string;
}

function describeStatus(status: CalibrationStatus): string {
  switch (status.kind) {
    case "uncalibrated":
      return "uncalibrated";
    case "calibrated":
      return `calibrated ${status.date}`;
    case "partial":
      return `partial (${status.savedOctaves.length} of 5 saved)`;
    default:
      return "unknown";
  }
}

function glyphClass(status: CalibrationStatus): string {
  switch (status.kind) {
    case "calibrated":
      return "cal-saved";
    case "partial":
      return "cal-partial";
    case "uncalibrated":
    default:
      return "";
  }
}

function glyphFor(status: CalibrationStatus): string {
  switch (status.kind) {
    case "calibrated":
      return "●";
    case "partial":
      return "◐";
    case "uncalibrated":
    default:
      return "○";
  }
}

export function CalibrationPicker(props: CalibrationPickerProps) {
  return (
    <div class="cal-picker">
      <p class="cal-picker-blurb">
        Plug an external tuner (or oscilloscope) into the output you want to
        calibrate. The module will play 0V – 4V in sequence; you'll adjust each
        step until your tuner reads C0, C1, C2, C3, C4.
        <br />
        <br />
        Other outputs will be frozen during calibration.
      </p>

      <Show when={props.pendingError}>
        <p class="cal-picker-error" role="alert">
          {props.pendingError}
        </p>
      </Show>

      <div class="cal-picker-list" role="list">
        <For each={props.outputs}>
          {(out) => (
            <div class="cal-picker-row" role="listitem">
              <span
                class={`cal-picker-row-glyph ${glyphClass(out.status)}`}
                aria-hidden="true"
              >
                {glyphFor(out.status)}
              </span>
              <span class="cal-picker-row-id">{out.id}</span>
              <span class="cal-picker-row-status">
                {describeStatus(out.status)}
              </span>
              <span class="cal-picker-row-actions">
                <Show
                  when={out.status.kind === "partial"}
                  fallback={
                    <button
                      class="cal-picker-row-btn"
                      type="button"
                      onClick={() => props.onPick(out.id, "fresh")}
                    >
                      {out.status.kind === "calibrated"
                        ? "Re-calibrate"
                        : "Calibrate"}
                    </button>
                  }
                >
                  <button
                    class="cal-picker-row-btn"
                    type="button"
                    onClick={() => props.onPick(out.id, "resume")}
                  >
                    Resume
                  </button>
                  <button
                    class="cal-picker-row-btn"
                    type="button"
                    onClick={() => props.onPick(out.id, "restart")}
                  >
                    Restart
                  </button>
                </Show>
              </span>
            </div>
          )}
        </For>
      </div>

      <div class="cal-picker-footer">
        <button class="cal-btn" type="button" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
