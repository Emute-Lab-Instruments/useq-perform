export type RuntimeConnectionMode = "hardware" | "browser" | "none";
export type TransportMode = "hardware" | "wasm" | "both" | "none";

export interface RuntimeSessionInputs {
  hasHardwareConnection: boolean;
  noModuleMode: boolean;
  wasmEnabled: boolean;
}

export interface RuntimeSessionSnapshot extends RuntimeSessionInputs {
  connectionMode: RuntimeConnectionMode;
  transportMode: TransportMode;
}

export function resolveRuntimeConnectionMode(
  inputs: RuntimeSessionInputs
): RuntimeConnectionMode {
  if (inputs.hasHardwareConnection) {
    return "hardware";
  }

  if (inputs.noModuleMode || inputs.wasmEnabled) {
    return "browser";
  }

  return "none";
}

export function resolveTransportModeFromRuntime(
  inputs: RuntimeSessionInputs
): TransportMode {
  const connectionMode = resolveRuntimeConnectionMode(inputs);

  if (connectionMode === "hardware") {
    return inputs.wasmEnabled ? "both" : "hardware";
  }

  if (connectionMode === "browser") {
    return "wasm";
  }

  return "none";
}

export function createRuntimeSessionSnapshot(
  inputs: RuntimeSessionInputs
): RuntimeSessionSnapshot {
  return {
    ...inputs,
    connectionMode: resolveRuntimeConnectionMode(inputs),
    transportMode: resolveTransportModeFromRuntime(inputs),
  };
}

export function supportsHardwareTransport(mode: TransportMode): boolean {
  return mode === "hardware" || mode === "both";
}

export function supportsWasmTransport(mode: TransportMode): boolean {
  return mode === "wasm" || mode === "both";
}
