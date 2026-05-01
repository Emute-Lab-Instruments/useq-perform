/**
 * Active WASM runtime port selector.
 *
 * Single read-through accessor that returns the WASM runtime port
 * selected by `bootstrap.ts`. The default is the worker-backed port; the
 * in-process port remains available as a fallback for environments where
 * Web Workers are unavailable (and as the surface tests mock against).
 *
 * Why this indirection exists:
 *
 *   - `bootstrap.ts` is the only place allowed to choose the active port,
 *     so the rest of the codebase asks `getActiveWasmRuntimePort()`
 *     instead of importing a concrete singleton.
 *   - The runtime services (`runtimeTransportService`, `appLifecycle`)
 *     route through this accessor so the swap is centralised.
 *   - The hot-path samplers (`visualisationSampler`, `editorEvaluation`),
 *     the probe sampler, and the diagnostics readers all route through
 *     it; calling the port instead of underlying interpreter functions
 *     is what actually moves the work off the main thread.
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
