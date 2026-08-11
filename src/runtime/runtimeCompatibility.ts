/** Compatibility policy derived from the canonical runtime session state. */

import {
  getRuntimeSessionState,
} from "./runtimeCoordinator.ts";
import { getActiveWasmRuntimePort } from "./activeWasmRuntimePort.ts";

/**
 * The bundled WASM interpreter is the current v1.2 language implementation.
 * It must not shadow pre-1.2 hardware because the language/runtime semantics
 * are not equivalent. The WASM stays loaded and resumes automatically after
 * disconnect or a connection to JSON firmware.
 */
export function shouldUseWasmShadow(): boolean {
  try {
    getActiveWasmRuntimePort();
  } catch {
    return false;
  }

  const state = getRuntimeSessionState();
  if (!state.session.wasmEnabled) return false;
  return !(
    state.session.hasHardwareConnection &&
    state.protocolMode === "legacy"
  );
}
