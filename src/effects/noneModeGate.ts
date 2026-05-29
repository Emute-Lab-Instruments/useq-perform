/**
 * none-mode eval gate (runtime-modes.md §1.10).
 *
 * In `none` mode there is no runtime to evaluate against. The editor still
 * accepts input, but eval must be rejected with a user-visible warning — the
 * app must never silently drop the eval.
 *
 * Kept dependency-light (only the runtime session store) so the gate can be
 * unit-tested without dragging in the transport/eval module graph.
 */

import { getRuntimeSessionState } from "../runtime/runtimeSessionStore.ts";

/** The exact §1.10 warning shown when eval is attempted with no runtime. */
export const NO_RUNTIME_WARNING =
  "no runtime available — connect hardware or enable browser-local WASM";

/**
 * Returns the §1.10 warning string when eval should be rejected because the
 * current transport mode is `none`, or `null` when a runtime is available and
 * eval may proceed.
 */
export function evalRejectionForNoRuntime(): string | null {
  return getRuntimeSessionState().session.transportMode === "none"
    ? NO_RUNTIME_WARNING
    : null;
}
