/**
 * Output Health Store
 *
 * Reactive store tracking the health state of each uSEQ output (a1-a4,
 * d1-d8, s1-s4, etc.). UI components can subscribe to this store to
 * render per-output health indicators.
 *
 * Health states:
 * - `idle`     — no recent activity
 * - `running`  — output was recently evaluated successfully
 * - `fallback` — output fell back to a simpler evaluation path
 * - `error`    — output has active diagnostics (warnings/errors)
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
 * Refresh output health from active diagnostics returned by the WASM
 * interpreter. Call this once per animation frame.
 *
 * Outputs with diagnostics are marked as `error`; outputs that previously
 * had errors but no longer appear in the diagnostics map are cleared back
 * to `idle`.
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
  const hasErrorEntries = Object.values(outputHealth).some(e => e.health === "error");
  if (!hasDiags && !hasErrorEntries) return;

  const now = Date.now();

  // Clear previously errored outputs when no diagnostics are active
  if (!hasDiags) {
    for (const [name, entry] of Object.entries(outputHealth)) {
      if (entry.health === "error") {
        setOutputHealth(name, {
          health: "idle",
          message: undefined,
          lastUpdated: now,
        });
      }
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
