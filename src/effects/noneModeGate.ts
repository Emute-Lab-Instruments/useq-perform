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

import { getRuntimeServiceSnapshot } from "../runtime/runtimeService.ts";

/** The exact §1.10 warning shown when eval is attempted with no runtime. */
export const NO_RUNTIME_WARNING =
  "no runtime available — connect hardware or enable browser-local WASM";

/**
 * §1.10 companion: posted when a dispatched eval resolves with NEITHER leg —
 * e.g. wasm mode while the Worker runtime is still loading, so
 * `capabilities().available` is false and no hardware leg is active. The app
 * must never silently drop an eval; without this warning the eval highlight
 * would flash with no feedback.
 */
export const WASM_RUNTIME_NOT_READY_WARNING =
  "WASM runtime not ready — eval was not delivered";

/**
 * Returns the §1.10 warning string when eval should be rejected because the
 * current transport mode is `none`, or `null` when a runtime is available and
 * eval may proceed.
 */
export function evalRejectionForNoRuntime(): string | null {
  return getRuntimeServiceSnapshot().session.transportMode === "none"
    ? NO_RUNTIME_WARNING
    : null;
}
