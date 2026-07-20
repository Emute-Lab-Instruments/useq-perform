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
import { getActiveSynthesisService } from "./activeSynthesisService.ts";

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
}
