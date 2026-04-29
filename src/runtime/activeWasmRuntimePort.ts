/**
 * Active WASM runtime port selector.
 *
 * Single read-through accessor that returns either the in-process
 * `wasmRuntimePort` (default) or the worker-backed port (opt-in via the
 * `?wasmInWorker=true` URL flag, see `bootstrap.ts`).
 *
 * Why this indirection exists:
 *
 *   - `bootstrap.ts` is the only place allowed to choose the active port,
 *     so the rest of the codebase asks `getActiveWasmRuntimePort()`
 *     instead of importing a concrete singleton. This keeps the worker
 *     path opt-in: when the flag is off the worker module is never
 *     loaded.
 *   - The runtime services (`runtimeTransportService`, `appLifecycle`)
 *     route through this accessor so the swap is centralised.
 *   - The hot-path samplers (`visualisationSampler`, `editorEvaluation`)
 *     also route through it; calling the port instead of the underlying
 *     interpreter functions is what actually moves the work off the main
 *     thread.
 *
 * Note: the diagnostics reads (`readLastDiagnostics`,
 * `readActiveDiagnostics`) still hit the legacy main-thread globals.
 * When the worker port is active those globals are absent and the
 * readers degrade to empty arrays — a known limitation behind the flag,
 * tracked as a follow-up bead.
 */
import type { WasmRuntimePort } from "../contracts/runtimePorts";
import { wasmRuntimePort as inProcessPort } from "./wasmRuntimePort.ts";

let activePort: WasmRuntimePort = inProcessPort;

/**
 * Replace the active WASM runtime port. Called once during bootstrap
 * when the opt-in flag selects the worker-backed port. Idempotent.
 */
export function setActiveWasmRuntimePort(port: WasmRuntimePort): void {
  activePort = port;
}

/** Snapshot of the currently selected WASM runtime port. */
export function getActiveWasmRuntimePort(): WasmRuntimePort {
  return activePort;
}

/** True when the active port is the in-process (default) implementation. */
export function isUsingInProcessWasmRuntime(): boolean {
  return activePort === inProcessPort;
}
