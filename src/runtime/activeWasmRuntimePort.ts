/**
 * Compatibility import surface. The selected port is owned by
 * `runtimeCoordinator.ts`; this file contains no mutable state.
 */
import type { WasmRuntimePort } from "../contracts/runtimePorts";
import {
  getActiveWasmRuntimePort,
  isUsingInProcessWasmRuntime,
  transitionRuntimeCoordinator,
} from "./runtimeCoordinator.ts";

export { getActiveWasmRuntimePort, isUsingInProcessWasmRuntime };

/** @deprecated Bootstrap should select the port through the coordinator. */
export function setActiveWasmRuntimePort(port: WasmRuntimePort): void {
  transitionRuntimeCoordinator({ type: "select-wasm-port", port });
}
