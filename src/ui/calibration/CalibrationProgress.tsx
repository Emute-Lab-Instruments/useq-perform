// src/ui/calibration/CalibrationProgress.tsx
//
// Progress ribbon for the calibration takeover (docs/specs/calibration.md §3.2, §5.3).
// Renders "Step N of 5  ● ● ◐ ○ ○" — one glyph per fixed octave step.

import { For } from "solid-js";
import type {
  CalibrationOctaveIndex,
  CalibrationStepStatus,
} from "../../contracts/hardware";

const OCTAVE_INDICES: CalibrationOctaveIndex[] = [0, 1, 2, 3, 4];

export interface CalibrationProgressProps {
  /** Currently-active step (0..4). Used to highlight the current dot. */
  current: CalibrationOctaveIndex;
  /** Per-step status. */
  stepStatus: Record<CalibrationOctaveIndex, CalibrationStepStatus>;
}

function glyphFor(status: CalibrationStepStatus): string {
  switch (status) {
    case "saved":
      return "●";
    case "skipped":
      return "◐";
    case "pending":
    default:
      return "○";
  }
}

export function CalibrationProgress(props: CalibrationProgressProps) {
  return (
    <div class="cal-progress" role="status" aria-live="polite">
      <span class="cal-progress-label">
        Step {props.current + 1} of {OCTAVE_INDICES.length}
      </span>
      <span class="cal-progress-dots" aria-label="Per-octave status">
        <For each={OCTAVE_INDICES}>
          {(idx) => {
            const status = props.stepStatus[idx];
            const isCurrent = idx === props.current;
            const cls = `cal-progress-dot cal-${status}${
              isCurrent ? " cal-current" : ""
            }`;
            return (
              <span class={cls} aria-label={`${idx}V ${status}`}>
                {glyphFor(status)}
              </span>
            );
          }}
        </For>
      </span>
    </div>
  );
}
