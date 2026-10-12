import { For } from "solid-js";

export interface ProgressBarProps {
  /** Bar-phase progress value from 0 to 1 */
  progress: number;
  /**
   * Beats per bar. Draws `beats - 1` subtle tick marks at the beat
   * boundaries inside the bar. Defaults to 4; values < 2 draw no ticks.
   */
  beats?: number;
}

const DEFAULT_BEATS = 4;
/** Guard against absurd runtime values turning the bar into a comb. */
const MAX_TICKS = 32;

/**
 * Bar-position strip under the transport buttons (transport.md §1.7.4).
 * Width follows its parent through CSS layout (`width: 100%` of the transport
 * column); no measurement or ResizeObserver is involved.
 */
export function ProgressBar(props: ProgressBarProps) {
  const tickPositions = () => {
    const raw = props.beats ?? DEFAULT_BEATS;
    const beats = Number.isFinite(raw) ? Math.min(MAX_TICKS, Math.floor(raw)) : DEFAULT_BEATS;
    if (beats < 2) return [];
    return Array.from({ length: beats - 1 }, (_, i) => ((i + 1) / beats) * 100);
  };

  return (
    <div
      id="toolbar-bar-progress-container"
      role="presentation"
      style={{
        width: "100%",
        "pointer-events": "none",
        display: "block",
      }}
    >
      <div
        id="toolbar-bar-progress"
        style={{
          transform: `scaleX(${Math.max(0, Math.min(1, props.progress))})`,
          "pointer-events": "none",
        }}
      />
      <For each={tickPositions()}>
        {(left) => (
          <span
            class="progress-beat-tick"
            aria-hidden="true"
            style={{ left: `${left}%` }}
          />
        )}
      </For>
    </div>
  );
}
