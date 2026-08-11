/**
 * Compatibility import surface. The selected port is owned by
 * `runtimeCoordinator.ts`; this file contains no mutable state.
 */
import {
  getActiveWasmRuntimePort,
  hasActiveWasmRuntimePort,
} from "./runtimeCoordinator.ts";

export { getActiveWasmRuntimePort, hasActiveWasmRuntimePort };
