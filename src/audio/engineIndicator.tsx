/**
 * Synthesis engine indicator — props-based transport-family component.
 *
 * Fulfils (partial — see mission feature
 * `m1-synthesis-service-and-devmode-contract`):
 *   VAL-ENGINE-021 — all four engine states render through props in the
 *                    transport-indicator family without importing runtime
 *                    singletons. The adapter layer (adapters/toolbars.tsx)
 *                    subscribes to the engine-state channel and passes the
 *                    snapshot as props.
 *   VAL-ENGINE-020 (related) — there is no permanent Enable Sound command
 *                    here. The suspended indicator is the recovery
 *                    affordance; clicking it calls `onResume()`.
 *
 * Architecture notes:
 *
 * - This component is a PURE VIEW. It receives a snapshot of the engine
 *   state and an `onResume` callback. It imports NOTHING from `runtime/`,
 *   `effects/`, or the synthesis service. The adapter layer is the sole
 *   bridge.
 *
 - The indicator is part of the "transport-indicator family" by visual
 *   contract (synthesis.md §6.4): it sits next to the transport toolbar
 *   and uses the same visual vocabulary (rail / chip / tooltip) as the
 *   existing transport controls.
 *
 * - The component does NOT render itself when the snapshot says `off`
 *   AND the reason is capability-related (audio is unavailable). The
 *   capability diagnostic is delivered through the regular compiler
 *   diagnostic channel (VAL-HOST-008); the indicator surfaces no
 *   separate UI in that case.
 */

import { Show, type JSX } from "solid-js";

import type { EngineStateSnapshot, SynthesisEngineState } from "../contracts/synthesisChannels";

/**
 * Props the engine indicator accepts. The adapter layer constructs this
 * shape from the typed {@link engineStateChanged} channel.
 */
export interface EngineIndicatorProps {
  /** Latest engine state snapshot. */
  readonly state: EngineStateSnapshot;
  /**
   * Click handler for the recovery affordance. The adapter wires this to
   * `synthesisService.resumeOnUserActivation()`. The indicator calls it
   * only on a trusted user click (pointerdown on the indicator itself).
   */
  readonly onResume: () => void;
  /**
   * Optional: aria-label override for screen readers. Defaults to a
   * state-appropriate phrase.
   */
  readonly ariaLabel?: string;
}

/**
 * Visual class for each engine state. Consumers (Inspector scenarios,
 * visual regression tests) match against these class names.
 */
export function engineIndicatorClass(state: SynthesisEngineState): string {
  switch (state) {
    case "off":
      return "engine-indicator-off";
    case "suspended":
      return "engine-indicator-suspended";
    case "running":
      return "engine-indicator-running";
    case "error":
      return "engine-indicator-error";
  }
}

/**
 * Default aria label for each state. The indicator exposes this so the
 * adapter layer can compose its own label with the BPM display etc.
 */
export function engineIndicatorAriaLabel(state: SynthesisEngineState): string {
  switch (state) {
    case "off":
      return "Synthesis engine off";
    case "suspended":
      return "Synthesis engine suspended — click to enable sound";
    case "running":
      return "Synthesis engine running";
    case "error":
      return "Synthesis engine error — click to reinitialise";
  }
}

/**
 * Default human-readable label for each state. Used inside the chip.
 */
export function engineIndicatorLabel(state: SynthesisEngineState): string {
  switch (state) {
    case "off":
      return "Audio off";
    case "suspended":
      return "Suspended";
    case "running":
      return "Running";
    case "error":
      return "Error";
  }
}

/**
 * Synthesis engine indicator — the transport-family recovery affordance.
 *
 * Renders nothing when:
 *   - `state.state === "off"` AND `state.reasonKey === "NO_AUDIO_CAPABILITY"`
 *     (the capability diagnostic carries that case).
 */
export function EngineIndicator(props: EngineIndicatorProps): JSX.Element {
  const isHidden = () =>
    props.state.state === "off" &&
    props.state.reasonKey === "NO_AUDIO_CAPABILITY";

  const isClickable = () =>
    props.state.state === "suspended" || props.state.state === "error";

  const tooltip = () =>
    props.state.reasonMessage ?? engineIndicatorAriaLabel(props.state.state);

  const aria = () => props.ariaLabel ?? engineIndicatorAriaLabel(props.state.state);

  const handleClick = (event: MouseEvent) => {
    // The indicator is a real-user-action surface. Synthetic/scripted
    // events cannot grant AudioContext activation (synthesis.md §6.5),
    // so the click handler is intentionally a plain onClick: the browser
    // only honours it for trusted pointer input.
    event.preventDefault();
    if (isClickable()) {
      props.onResume();
    }
  };

  return (
    <Show when={!isHidden()}>
      <button
        type="button"
        class={`engine-indicator ${engineIndicatorClass(props.state.state)}`}
        classList={{
          "engine-indicator-clickable": isClickable(),
          "engine-indicator-disabled": !isClickable(),
        }}
        title={tooltip()}
        aria-label={aria()}
        aria-pressed={props.state.state === "running"}
        disabled={!isClickable()}
        data-engine-state={props.state.state}
        data-transition-count={props.state.transitionCount}
        onClick={handleClick}
      >
        <span class="engine-indicator-dot" aria-hidden="true" />
        <span class="engine-indicator-label">
          {engineIndicatorLabel(props.state.state)}
        </span>
      </button>
    </Show>
  );
}
