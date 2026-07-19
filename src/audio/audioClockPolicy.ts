/**
 * Audio clock policy — keeps rAF presentation-only while audio runs.
 *
 * Fulfils (see mission feature `m1-audio-clocked-worker-producer`):
 *   VAL-ENGINE-002 — Audio frames become the live master clock while
 *                    rAF remains presentation-only. Pausing or
 *                    throttling rAF neither stops the audio timeline
 *                    nor advances a second timeline.
 *
 * Design contract (normative, synthesis.md §4):
 *
 *   - While the synthesis engine is in the `running` state, audio frames
 *     own ModuLisp time. The visualisation runtime's local-time mode
 *     MUST NOT advance the interpreter's clock; rAF stays presentation-
 *     only (it still paints, polls diagnostics, and projects past
 *     samples, but never advances live execution time).
 *
 *   - This module is the single place where that policy is decided. The
 *     visualisation runtime imports `shouldAdvanceLocalTime()` and skips
 *     the local-time branch when it returns `false`. No second timeline
 *     can sneak in through any other path because every time-advancing
 *     branch consults this helper.
 *
 *   - The helper reads the typed `engineStateStore` (no singleton import
 *     beyond the contract module), so it stays in sync with engine
 *     transitions published by the synthesis service.
 *
 *   - The helper is dependency-light: it imports only the engine state
 *     store from `src/contracts/`. It does not import the synthesis
 *     service or any UI module, so it respects import boundaries.
 */
import { engineStateStore } from "../contracts/synthesisChannels";

/**
 * Returns `true` when the visualisation runtime's local-time mode is
 * allowed to advance the WASM interpreter's clock.
 *
 * The policy is:
 *
 *   - When the synthesis engine is `running` or `suspended`, audio
 *     frames own the timeline. Local-time mode must NOT advance a
 *     second timeline. Returns `false`.
 *
 *   - When the synthesis engine is `off` (audio capability absent or
 *     AudioContext never created) or `error` (engine failed; the
 *     producer is no longer advancing time), local-time mode is the
 *     only clock and may advance. Returns `true`.
 *
 * The `error` case allows local-time mode to keep the visualisation
 * sampler responsive for diagnostics after a producer failure, while
 * the producer itself is halted and the worklet has faded to silence.
 * The user must explicitly recover the engine before audio owns the
 * timeline again.
 */
export function shouldAdvanceLocalTime(): boolean {
  const state = engineStateStore.current.state;
  return state === "off" || state === "error";
}

/**
 * Returns `true` when audio frames are the current master clock.
 *
 * This is the inverse of {@link shouldAdvanceLocalTime}: while audio
 * owns the timeline, callers that would advance a parallel timeline
 * (rAF-based local clock, hardware time echo, etc.) MUST no-op.
 */
export function audioIsMasterClock(): boolean {
  const state = engineStateStore.current.state;
  return state === "running" || state === "suspended";
}
