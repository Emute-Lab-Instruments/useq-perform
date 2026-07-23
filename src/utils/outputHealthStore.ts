/**
 * Output Health Store
 *
 * Reactive store tracking the health state of each uSEQ output (a1-a4,
 * d1-d8, s1-s4, etc.). UI components can subscribe to this store to
 * render per-output health indicators.
 *
 * Health states (failure-model.md §5.1):
 * - `idle`     — no recent activity
 * - `running`  — output was recently evaluated successfully
 * - `fallback` — active program errored; output is running its LKG program
 * - `error`    — no LKG available; output holds its last valid sample
 */

import { createStore } from "solid-js/store";
import type { UseqDiagnostic } from "../contracts/runtimeTypes";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OutputHealth = "idle" | "running" | "fallback" | "error";

export interface OutputHealthEntry {
  health: OutputHealth;
  message?: string;
  lastUpdated: number;
}

export interface OutputHealthState {
  [outputName: string]: OutputHealthEntry;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const [outputHealth, setOutputHealth] = createStore<OutputHealthState>({});

export { outputHealth, setOutputHealth };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Active-diagnostic wire entries (`useq_active_diagnostics()`, see
 * `src-useq/wasm/wasm_wrapper.cpp`) carry per-output attribution beyond the
 * declared {@link UseqDiagnostic} span fields: `output` names the affected
 * output and `state` is the engine's reported health (`"fallback"` when the
 * LKG value was substituted, `"error"` when no LKG is available —
 * failure-model.md §5.1).
 */
type ActiveDiagnostic = UseqDiagnostic & { output?: string; state?: string };

/**
 * Refresh output health from active diagnostics returned by the WASM
 * interpreter. Call this once per animation frame.
 *
 * Outputs named by active diagnostics are marked per the engine's reported
 * state (`fallback`/`error`); outputs that no longer appear are cleared back
 * to `idle` (failure-model.md §3.3 — fallback tracking is per-pass).
 */
let _prevDiagsRef: UseqDiagnostic[] | null = null;

export function refreshOutputHealth(
  diagnostics: UseqDiagnostic[],
): void {
  // Skip entirely if the reference hasn't changed (same cached array from
  // readActiveDiagnostics). This is the common case on every rAF frame.
  if (diagnostics === _prevDiagsRef) return;
  _prevDiagsRef = diagnostics;

  const hasDiags = Array.isArray(diagnostics) && diagnostics.length > 0;
  const hasFailingEntries = Object.values(outputHealth).some(
    e => e.health === "error" || e.health === "fallback",
  );
  if (!hasDiags && !hasFailingEntries) return;

  const now = Date.now();

  // Project active diagnostics onto per-output health. Presence in the
  // active set means the engine substituted LKG on the most recent pass, so
  // default to `fallback` unless the engine explicitly reports `error`.
  const failing = new Set<string>();
  if (hasDiags) {
    for (const diag of diagnostics as ActiveDiagnostic[]) {
      const { output, state, message } = diag;
      if (!output) continue;
      failing.add(output);
      const health: OutputHealth = state === "error" ? "error" : "fallback";
      const current = outputHealth[output];
      // Only write on a real transition — every write retriggers the
      // gutter's reactive redraw.
      if (current?.health !== health || current.message !== message) {
        setOutputHealth(output, { health, message, lastUpdated: now });
      }
    }
  }

  // Recovery: previously failing outputs absent from the active set return
  // to idle.
  for (const [name, entry] of Object.entries(outputHealth)) {
    if (
      (entry.health === "error" || entry.health === "fallback") &&
      !failing.has(name)
    ) {
      setOutputHealth(name, {
        health: "idle",
        message: undefined,
        lastUpdated: now,
      });
    }
  }
}

/**
 * Mark an output as successfully running. Automatically fades back to
 * `idle` after a short delay unless a newer update supersedes it.
 */
export function markOutputRunning(outputName: string): void {
  const now = Date.now();
  setOutputHealth(outputName, {
    health: "running",
    message: undefined,
    lastUpdated: now,
  });

  const FADE_MS = 1500;
  setTimeout(() => {
    const current = outputHealth[outputName];
    // Only fade if this is still the same "running" update (not superseded)
    if (current && current.health === "running" && current.lastUpdated <= now) {
      setOutputHealth(outputName, {
        health: "idle",
        message: undefined,
        lastUpdated: Date.now(),
      });
    }
  }, FADE_MS);
}
