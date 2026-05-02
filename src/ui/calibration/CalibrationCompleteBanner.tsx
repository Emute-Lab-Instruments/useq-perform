// src/ui/calibration/CalibrationCompleteBanner.tsx
//
// Final completion banner offered after the 5th (4V) point is saved
// (docs/specs/calibration.md §5.4). Lets the user chain to another
// output or dismiss the takeover ("Done").

import { For } from "solid-js";
import type { CalibrationOutput } from "../../contracts/hardware";

export interface CalibrationCompleteBannerProps {
  /** Output that was just calibrated. */
  output: string;
  /** Outputs available to chain into (typically siblings minus current). */
  nextOutputs: CalibrationOutput[];
  /** `null` = "Done", string = next output id. */
  onRequestNextOutput: (outputId: string | null) => void;
}

export function CalibrationCompleteBanner(
  props: CalibrationCompleteBannerProps
) {
  return (
    <div class="cal-complete-banner" role="status" aria-live="polite">
      <p class="cal-complete-title">Saved to flash ✓</p>
      <p class="cal-complete-detail">{props.output} calibration complete</p>
      <p class="cal-complete-prompt">Calibrate next output?</p>
      <div class="cal-btn-row">
        <For each={props.nextOutputs}>
          {(out) => (
            <button
              class="cal-btn"
              type="button"
              onClick={() => props.onRequestNextOutput(out.id)}
            >
              {out.id}
            </button>
          )}
        </For>
        <button
          class="cal-btn cal-btn-primary"
          type="button"
          onClick={() => props.onRequestNextOutput(null)}
        >
          Done
        </button>
      </div>
    </div>
  );
}
