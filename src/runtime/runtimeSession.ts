export type RuntimeConnectionMode = "hardware" | "browser" | "none";
export type TransportMode = "hardware" | "wasm" | "both" | "none";

// ── Valid mode combination matrix ────────────────────────────────────────────
//
// There are three orthogonal mode dimensions. Not every combination is reachable
// at runtime. The table below lists every valid combination and the bootstrap
// startup mode that drives it.
//
// Inputs (RuntimeSessionInputs):
//   H = hasHardwareConnection
//   N = noModuleMode
//   W = wasmEnabled
//
// ┌────────────────────────┬───┬───┬───┬─────────────────┬───────────────┬─────────────────────┐
// │ Startup mode           │ H │ N │ W │ connectionMode  │ transportMode │ Notes               │
// ├────────────────────────┼───┼───┼───┼─────────────────┼───────────────┼─────────────────────┤
// │ hardware               │ Y │ - │ N │ hardware        │ hardware      │ Serial only         │
// │ hardware + wasm        │ Y │ - │ Y │ hardware        │ both          │ Serial + WASM eval  │
// │ browser-local          │ N │ N │ Y │ browser         │ wasm          │ WASM only, no hw    │
// │ no-module              │ N │ Y │ Y │ browser         │ wasm          │ URL flag, WASM only │
// │ unsupported-browser    │ N │ N │ N │ none            │ none          │ No Web Serial, no   │
// │                        │   │   │   │                 │               │ WASM — read-only UI │
// └────────────────────────┴───┴───┴───┴─────────────────┴───────────────┴─────────────────────┘
//
// Dead / unreachable combinations:
//   • connectionMode "hardware"  + transportMode "wasm"     — impossible: hardware connection
//                                                             always enables at least "hardware"
//                                                             transport; WASM alone yields "both"
//   • connectionMode "hardware"  + transportMode "none"     — impossible: a live serial connection
//                                                             always maps to hardware transport
//   • connectionMode "browser"   + transportMode "hardware" — impossible: browser-local mode has
//                                                             no serial connection
//   • connectionMode "browser"   + transportMode "both"     — impossible: "both" requires a live
//                                                             hardware connection
//   • connectionMode "browser"   + transportMode "none"     — impossible: browser-local requires
//                                                             wasmEnabled=true
//   • connectionMode "none"      + transportMode "hardware" — impossible: no connection = no hw
//   • connectionMode "none"      + transportMode "wasm"     — impossible: no connection = no wasm
//   • connectionMode "none"      + transportMode "both"     — impossible: no connection at all
//
// Note on "both" transport mode:
//   Reachable only when hasHardwareConnection=true AND wasmEnabled=true. This is the least
//   common path (hardware-connected session with the WASM runtime also running) and is exercised
//   in tests but seldom seen in practice. If the dual-transport path becomes dead code, remove
//   the "both" value and the supportsHardwareTransport / supportsWasmTransport guards.
//
// Note on startup mode vs. connection mode:
//   BootstrapStartupMode (bootstrap.ts) is determined once at boot from URL params and
//   browser capabilities. RuntimeConnectionMode (this file) is re-derived live whenever the
//   serial port connects or disconnects. A session that boots as "hardware" startup mode can
//   temporarily fall back to connectionMode "none" while waiting for the port to reconnect.
// ────────────────────────────────────────────────────────────────────────────

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
