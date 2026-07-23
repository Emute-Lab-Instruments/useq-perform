/**
 * Devmode-only browser eval surface.
 *
 * The ordered first-sound browser journey (VAL-CROSS-001..009/013) and
 * other agent-browser driven validation must drive the production eval
 * path. Prior evidence used an unverified synthetic `KeyboardEvent`
 * dispatched via `dispatchEvent`, which is not a trusted event and
 * silently failed to trigger CodeMirror's `eval.quantised` keymap
 * binding in several journey steps. The journey then mistook retained
 * prior state for a successful commit, masking real defects.
 *
 * This module exposes a tiny read-only surface on
 * `window.__useqBrowserEval` (installed only when `startupFlags.devmode`
 * is true) that:
 *
 *   1. Resolves the active CodeMirror EditorView via the production
 *      `editorSession.view` accessor (the same path the rest of the app
 *      uses; never a DOM-scrape).
 *   2. Places the cursor inside the intended form before evaluating, so
 *      the top-level form lookup sees the form the caller wrote.
 *   3. Calls the production `evaluate(view, "toplevel")` function — the
 *      same function the `eval.quantised` keymap handler invokes.
 *   4. Returns the post-eval synthesis telemetry snapshot (when a
 *      synthesis service is active) so the caller can assert revision,
 *      epoch, instanceId, peak/RMS changes before advancing. When audio
 *      capability is absent the telemetry is `null` (degraded profile).
 *   5. Exposes deterministic clock control (freezeClock / stepClock /
 *      resumeClock / isClockFrozen — e2e axe item A1) over the single
 *      time-source seam in `src/effects/visualisationRuntime.ts`, so
 *      browser journeys never need wall-clock waits.
 *
 * Outside devmode this module is inert: `installBrowserEvalSurface` is
 * only called from bootstrap when `devmode === true`, and production
 * builds never see `window.__useqBrowserEval`.
 *
 * Import boundary note: this file lives in `src/runtime/` so it may
 * consume `src/effects/editorEvaluation` and `src/lib/editorStore` via
 * the bootstrap exemption. It MUST NOT be imported from `src/contracts/`
 * or `src/lib/`.
 */
import type { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";

import { editorSession } from "../lib/editorStore.ts";
import { evaluate } from "../effects/editorEvaluation.ts";
import {
  setVisualisationNowSource,
  _drainForTests as drainVisualisationSampling,
} from "../effects/visualisationRuntime.ts";
import { audioIsMasterClock } from "../audio/audioClockPolicy.ts";
import { getActiveSynthesisService } from "./activeSynthesisService.ts";
import { getActiveWasmRuntimePort } from "./activeWasmRuntimePort.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * A trimmed copy of the synthesis telemetry snapshot that callers use
 * to assert eval commits. Mirrors the relevant fields of
 * `SynthesisTelemetrySnapshot` without forcing this module to import
 * the synthesis service type (which would cross the runtime/audio
 * boundary in the wrong direction).
 */
export interface BrowserEvalTelemetry {
  programRevision: number;
  activeEpoch: number;
  pendingEpoch: number;
  instanceId: string;
  engineState: string;
  peakSample: number;
  rmsSample: number;
  finiteOutput: number;
  [key: string]: unknown;
}

/**
 * Result of `evalToplevelNow()`.
 *
 * - `ok: true` — the production `evaluate()` function was reached. The
 *   `evalAccepted` flag is the boolean it returned; `telemetry` is the
 *   post-eval synthesis snapshot when a service is active, or `null`
 *   when the app is in a degraded (service-less) profile.
 * - `ok: false` — the surface could not reach `evaluate()` (no editor
 *   view mounted, or `evaluate()` threw). `error` carries a short
 *   reason string.
 */
export type BrowserEvalResult =
  | { ok: true; evalAccepted: boolean; telemetry: BrowserEvalTelemetry | null }
  | { ok: false; error: string };

/**
 * Devmode-only browser eval surface. The shape is intentionally tiny
 * so it is easy to audit.
 */
export interface BrowserEvalSurface {
  /**
   * Run the production top-level eval on the active editor. Returns a
   * correlated post-eval snapshot the caller can assert on. Never
   * throws — failures are reported as `{ ok: false, error }`.
   */
  evalToplevelNow(): BrowserEvalResult;

  /**
   * Observe a compiled output through the active production WASM port.
   * This is deliberately read-only: browser E2E tests use it to prove that
   * trusted user input reached the worker-backed virtual firmware without
   * installing a second test runtime or mutating interpreter state.
   */
  sampleOutputAtTime(outputName: string, timeSeconds: number): Promise<number>;

  // ── Deterministic clock control (e2e axe item A1) ─────────────────
  //
  // These hooks drive the single time-source seam in
  // `src/effects/visualisationRuntime.ts` (`setVisualisationNowSource`)
  // so browser journeys never need wall-clock waits for time-driven
  // behaviour. Semantics:
  //
  //   - Freezing pins ModuLisp *local* time at its current value. The
  //     rAF loop keeps running — it still paints, polls diagnostics,
  //     and drains the sampling queue — but the local-time branch reads
  //     a constant, so `visStore.currentTime` holds.
  //   - Stepping advances the frozen time source; the *production* rAF
  //     tick then observes the new time and runs `updateTime` +
  //     `requestLocalSamplesThrough` exactly as if real frames had
  //     elapsed. There is no parallel stepping implementation.
  //   - Transport interplay: Stop under a frozen clock re-pins t=0
  //     (resetLocalTime reads the frozen source); Play/Pause re-anchor
  //     against it. All transport clock semantics (transport.md §1.5)
  //     hold under frozen time.
  //   - Audio arbitration (VAL-ENGINE-002): while the synthesis engine
  //     owns the timeline (`running`/`suspended`), freeze/step THROW.
  //     The worklet clock cannot be frozen from the main thread, and a
  //     silently non-authoritative frozen clock would let journeys
  //     assert against the wrong timeline.

  /**
   * Pin ModuLisp local time at its current value. Idempotent when
   * already frozen. Throws if the synthesis engine owns the timeline.
   */
  freezeClock(): void;

  /**
   * Advance frozen local time by `stepMs` milliseconds. Resolves after
   * the production rAF tick has observed the new time and the sampling
   * queue has fully drained, so callers can assert immediately.
   *
   * Whether ModuLisp time actually advances follows production rules:
   * with transport stopped/paused (local-time mode inactive) the step
   * is timeline-neutral, exactly like real wall time passing.
   *
   * Throws if the clock is not frozen, `stepMs` is not a finite
   * non-negative number, or the synthesis engine owns the timeline.
   */
  stepClock(stepMs: number): Promise<void>;

  /**
   * Restore the real `performance.now` source. The seam re-anchors so
   * local time continues from its frozen value without a jump — wall
   * time that passed while frozen is invisible. No-op when not frozen.
   */
  resumeClock(): void;

  /** Whether the deterministic clock is currently frozen. */
  isClockFrozen(): boolean;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Place the cursor inside the first top-level form so the top-level
 * form lookup sees the intended form. We pick position 1 (just inside
 * the opening paren of the first top-level form) unless the document
 * is empty or shorter than 2 chars, in which case we fall back to 0.
 *
 * The selection is dispatched through the production CodeMirror
 * transaction pipeline (the same path user input takes) so subsequent
 * `top_level_string` calls inside `evaluate()` see the cursor where we
 * put it.
 */
function placeCursorInsideFirstForm(view: EditorView): void {
  const len = view.state.doc.length;
  const head = len >= 2 ? 1 : 0;
  view.dispatch({
    selection: EditorSelection.single(head),
    scrollIntoView: false,
  });
}

// ── Deterministic clock state ──
//
// Module-level so repeated install/teardown cycles (dev hot-reload)
// share one view of whether the runtime seam currently holds a frozen
// source. `null` = real time.
let frozenNowMs: number | null = null;

/**
 * Resolve on the next animation frame. The visualisation runtime's
 * pending tick was registered before this callback, so by the time two
 * of these have resolved the production tick has run at least once
 * with the current frozen time regardless of rAF registration order.
 */
function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

function assertClockNotAudioOwned(hook: string): void {
  if (audioIsMasterClock()) {
    throw new Error(
      `${hook}: the synthesis engine owns the timeline (VAL-ENGINE-002) — ` +
        "the worklet clock cannot be frozen from the main thread, and a " +
        "non-authoritative frozen rAF clock would assert against the wrong timeline",
    );
  }
}

function buildSurface(): BrowserEvalSurface {
  return Object.freeze({
    evalToplevelNow(): BrowserEvalResult {
      try {
        const view = editorSession.view;
        if (!view) {
          return { ok: false, error: "no editor view is mounted" };
        }
        // Place the cursor inside the intended form so the top-level
        // form lookup sees the form the caller wrote. Without this the
        // journey could silently re-evaluate whatever form happened to
        // hold the cursor from a previous step.
        placeCursorInsideFirstForm(view);

        const accepted = evaluate(view, "toplevel");

        // Pull the correlated post-eval telemetry snapshot when a
        // synthesis service is active. In a degraded (service-less)
        // profile the snapshot is null — callers that only care about
        // diagnostics should still see `evalAccepted` true.
        //
        // NOTE: the production evaluate() function returns
        // synchronously, but the Worker eval + commit-coordinator +
        // worklet activation chain is asynchronous. The telemetry
        // snapshot returned here reflects the state at the moment the
        // surface was called; callers that need to assert on the
        // POST-COMMIT snapshot should read
        // `window.__useqSynthesisDev.getTelemetry()` after the commit
        // has had time to propagate (typically a few hundred
        // milliseconds). This is the contract the journey helper in
        // /tmp/first-sound-evidence-v3/editor.mjs follows.
        const service = getActiveSynthesisService();
        const telemetry = service
          ? (service.telemetry as unknown as BrowserEvalTelemetry)
          : null;

        return { ok: true, evalAccepted: accepted, telemetry };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { ok: false, error: msg };
      }
    },

    sampleOutputAtTime(outputName: string, timeSeconds: number): Promise<number> {
      return getActiveWasmRuntimePort().evalOutputAtTime(outputName, timeSeconds);
    },

    freezeClock(): void {
      if (frozenNowMs !== null) return; // idempotent
      assertClockNotAudioOwned("freezeClock");
      frozenNowMs = performance.now();
      // The installed source reads the mutable `frozenNowMs` so
      // `stepClock` advances it without re-installing (re-installing
      // would re-anchor and lose the step).
      setVisualisationNowSource(() => frozenNowMs ?? performance.now());
    },

    async stepClock(stepMs: number): Promise<void> {
      if (typeof stepMs !== "number" || !Number.isFinite(stepMs) || stepMs < 0) {
        throw new Error(
          `stepClock: step must be a finite non-negative number of ms, got ${String(stepMs)}`,
        );
      }
      if (frozenNowMs === null) {
        throw new Error("stepClock: clock is not frozen — call freezeClock() first");
      }
      assertClockNotAudioOwned("stepClock");
      frozenNowMs += stepMs;
      // Let the running production tick observe the new frozen time —
      // it advances local time, publishes it via `updateTime`, and
      // queues catch-up samples through `requestLocalSamplesThrough`,
      // the exact real-frame code path. Two frames guarantee at least
      // one committed tick regardless of rAF registration order; the
      // drain then guarantees every queued sample has been processed.
      await nextAnimationFrame();
      await nextAnimationFrame();
      await drainVisualisationSampling();
    },

    resumeClock(): void {
      if (frozenNowMs === null) return; // no-op
      frozenNowMs = null;
      // Restoring the default source re-anchors inside the seam, so
      // local time continues from the frozen value without a jump.
      setVisualisationNowSource(null);
    },

    isClockFrozen(): boolean {
      return frozenNowMs !== null;
    },
  });
}

// ---------------------------------------------------------------------------
// Bootstrap wiring
// ---------------------------------------------------------------------------

/**
 * Install the devmode-only browser eval surface on a window-like
 * object. Called from bootstrap when `devmode === true`.
 *
 * Passing `undefined` (or any falsy object) is a no-op — SSR safety.
 */
export function installBrowserEvalSurface(
  target: unknown,
): void {
  if (!target || typeof target !== "object") return;
  const w = target as { __useqBrowserEval?: BrowserEvalSurface };
  w.__useqBrowserEval = buildSurface();
}

/**
 * Remove the devmode-only browser eval surface. Used by hot-reload
 * during development so a fresh surface replaces the previous one.
 *
 * Outside devmode this is a no-op.
 */
export function teardownBrowserEvalSurface(target: unknown): void {
  if (!target || typeof target !== "object") return;
  const w = target as { __useqBrowserEval?: unknown };
  delete w.__useqBrowserEval;
  // Never leave a frozen clock behind without its controlling surface
  // (dev hot-reload replaces the surface; the runtime seam outlives it).
  if (frozenNowMs !== null) {
    frozenNowMs = null;
    setVisualisationNowSource(null);
  }
}
