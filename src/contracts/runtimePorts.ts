/**
 * Runtime port contracts.
 *
 * Two ports represent the two ways the editor talks to the ModuLisp interpreter:
 *
 *   - {@link WebSerialHostPort} — uSEQ Eurorack hardware over Web Serial.
 *   - {@link WasmRuntimePort}   — in-browser WASM build of the same interpreter.
 *
 * Both ports expose a small **shared transport surface** (the 6-command floor
 * defined in `docs/RUNTIME_CONTRACT.md`) plus a port-specific surface for
 * capabilities that only one side has (the JSON handshake on hardware, the
 * batch-output sampling on WASM, etc).
 *
 * Why an explicit port abstraction:
 *
 *   - The runtime layer (`src/runtime/runtime*Service.ts`) used to branch on
 *     "is hardware connected?" / "is WASM enabled?" and call the underlying
 *     transport / WASM modules directly. That meant two contracts, two error
 *     surfaces, and no clean seam for the worker move (see
 *     `useq-perform-nri`).
 *   - With ports, the runtime layer asks "which ports support shared
 *     transport commands right now?" and dispatches uniformly. The fan-out is
 *     a property of how many ports are active, not a code-path branch.
 *   - The `WasmRuntimePort` shape is also the natural postMessage boundary
 *     for the upcoming worker move: every method is async, every argument is
 *     a structured-cloneable value, and there is no shared mutable state
 *     between calls. Replacing the in-process implementation with a worker
 *     proxy is then a swap of one concrete adapter, not a re-shape of every
 *     caller.
 *
 * Per `RUNTIME_CONTRACT.md`, the shared command set is the 6-builtin floor
 * (play / pause / stop / rewind / clear / get-transport-state). Anything
 * port-specific lives on the port-specific interface.
 *
 * Worker readiness rules of thumb (for `WasmRuntimePort` callers):
 *
 *   - Every method returns a `Promise` — even the ones that are synchronous
 *     today.
 *   - Arguments and return values must be structured-cloneable: primitives,
 *     `string[]`, `Map<string, TimeSample[]>`, `Float64Array`, etc. No
 *     functions, no class instances, no DOM references.
 *   - Each call is self-contained: never depend on a previous call having
 *     left state behind beyond what the runtime already documents
 *     (e.g. `useq_init` happens exactly once, internally).
 */

import type { TransportState } from "../machines/transport.machine";
import type { SharedTransportCommand } from "./useqRuntimeContract";
import type { RuntimeDiagnostic, RuntimeProtocolMode } from "./runtimeTypes";

// ---------------------------------------------------------------------------
// Shared transport surface — implemented by both ports
// ---------------------------------------------------------------------------

/**
 * Capability hint shared by both ports. Lets callers ask
 * "is this port currently usable?" without try/catch at every call site.
 */
export interface RuntimePortCapabilities {
  /** True when the port is connected/initialised and shared commands will go out. */
  readonly available: boolean;
}

/**
 * The shared transport surface defined by `RUNTIME_CONTRACT.md`.
 *
 * Both ports must implement exactly this much. Port-specific capabilities
 * live on the port-specific sub-interfaces.
 *
 * Methods that fan out a side-effect (eval, setTransportState) are
 * fire-and-forget by default — the response, when relevant, comes back as a
 * resolved promise.
 */
export interface SharedRuntimePort {
  /** Identifier used when reporting capabilities and logging. */
  readonly kind: "web-serial-host" | "wasm-runtime";

  /** Snapshot of what this port can do right now. */
  capabilities(): RuntimePortCapabilities;

  /**
   * Send a shared transport command (`(useq-play)`, `(useq-stop)`, etc.).
   * Resolves when the side has accepted the command (or, for ports that
   * batch, when it has been queued for delivery).
   */
  sendTransportCommand(command: SharedTransportCommand): Promise<void>;

  /**
   * Sync this port's notion of transport state to the supplied state.
   *
   * This is a higher-level helper used to align *both* ports when the user
   * presses play/pause/stop. Implementations typically forward to the
   * appropriate `(useq-*)` builtin from `useqRuntimeContract.ts`.
   */
  syncTransportState(state: TransportState): Promise<void>;
}

// ---------------------------------------------------------------------------
// WebSerial host port — hardware-specific surface
// ---------------------------------------------------------------------------

/** Capability snapshot for the hardware port. */
export interface WebSerialHostCapabilities extends RuntimePortCapabilities {
  /** True when a serial port is open and the firmware is responding. */
  readonly connected: boolean;
  /** True when a Web Serial port object is held (may be open or closed). */
  readonly hasOpenPort: boolean;
  /** "json" once the JSON handshake has completed; "legacy" otherwise. */
  readonly protocolMode: RuntimeProtocolMode;
}

/**
 * Hardware-side port wrapping `connector.ts` + `json-protocol.ts`.
 *
 * The shared methods (`sendTransportCommand`, `syncTransportState`) go out
 * over the JSON protocol when negotiated, and over raw text on the
 * pre-handshake fallback path. The hardware-only methods cover the bits the
 * WASM port simply doesn't have: cable lifecycle, firmware-info probe,
 * direct request/response.
 */
export interface WebSerialHostPort extends SharedRuntimePort {
  readonly kind: "web-serial-host";

  capabilities(): WebSerialHostCapabilities;

  /**
   * Toggle the connection state. If currently connected, disconnect; if not,
   * try the saved port and fall back to a port picker.
   */
  toggleConnection(): Promise<void>;

  /**
   * Query the device's current transport state by sending
   * `(useq-get-transport-state)` and parsing the text reply.
   * Resolves with `null` if the device doesn't reply or the protocol isn't ready.
   */
  queryTransportState(): Promise<TransportState | null>;

  /**
   * Send arbitrary uSEQ Lisp code to the device. Optionally captures the
   * text reply via the supplied callback (used by the firmware-info probe
   * and by editor evaluation in legacy mode).
   *
   * Code outside the shared transport surface (eval forms, builtins, etc.)
   * uses this method.
   */
  sendCode(
    code: string,
    capture?: ((response: string) => void) | null
  ): Promise<void>;
}

// ---------------------------------------------------------------------------
// WASM runtime port — browser-local surface
// ---------------------------------------------------------------------------

/** Time-series sample point used by batch sampling. */
export interface TimeSample {
  time: number;
  value: number;
}

/** Map of channel name to sample series. */
export type SampleSeriesMap = Map<string, TimeSample[]>;

/**
 * Result of the combined tick + future projection ABI call.
 *
 * `tickValues` carries the state-advancing tick output (one entry per
 * requested output, NaN for inactive). `projectionSamples` carries the
 * future samples produced under save/restore.
 */
export interface TickAndProjectResult {
  tickValues: Map<string, number>;
  projectionSamples: SampleSeriesMap;
}

/** Capability snapshot for the WASM port. */
export interface WasmRuntimeCapabilities extends RuntimePortCapabilities {
  /** Whether the WASM runtime is enabled in user settings. */
  readonly enabled: boolean;
  /** Whether `eval` operations are available. */
  readonly supportsEval: boolean;
  /** Whether time-window batch evaluation is available. */
  readonly supportsTimeWindow: boolean;
  /** Whether the combined tick + project export is available. */
  readonly supportsTickAndProject: boolean;
}

/**
 * WASM-side port wrapping `wasmInterpreter.ts`.
 *
 * Designed so that swapping the in-process implementation for a Web Worker
 * proxy is a localised change:
 *
 *   - All methods are async.
 *   - All arguments are primitives, plain arrays, or typed arrays.
 *   - All return values are primitives, plain `Map`s of plain objects, or
 *     numeric arrays — all structured-cloneable across postMessage.
 *   - Diagnostics are returned as plain JSON-shaped arrays.
 */
export interface WasmRuntimePort extends SharedRuntimePort {
  readonly kind: "wasm-runtime";

  capabilities(): WasmRuntimeCapabilities;

  /**
   * Ensure the WASM module is loaded, instantiated, and ready for use.
   * Idempotent — repeated calls share the same load promise. Resolves once
   * `useq_init()` has run and the ABI has been validated.
   *
   * Worker-readiness: when the worker version lands, this becomes the
   * bootstrap handshake — the worker is spawned, the WASM module is loaded
   * inside it, and this promise resolves once it has signalled "ready".
   */
  ensureLoaded(): Promise<void>;

  /**
   * Evaluate uSEQ Lisp code in the WASM interpreter and return the result
   * string. Resolves with `null` when the WASM runtime is disabled by
   * settings.
   */
  evalCode(code: string): Promise<string | null>;

  /**
   * Like {@link evalCode} but does not publish the `codeEvaluated` channel.
   * Used when probing or for internal one-shots that shouldn't appear as a
   * user-driven evaluation.
   */
  evalCodeSilently(code: string): Promise<string | null>;

  /** Advance the WASM interpreter's wall-clock. */
  updateTime(timeSeconds: number): Promise<void>;

  /** Evaluate a single named output at a given time. */
  evalOutputAtTime(name: string, timeSeconds: number): Promise<number>;

  /** Evaluate multiple outputs across a time window (batch sampling path). */
  evalOutputsInTimeWindow(
    outputs: string[],
    startTime: number,
    endTime: number,
    numSamples: number
  ): Promise<SampleSeriesMap>;

  /**
   * Combined tick + future projection in a single boundary crossing.
   *
   * Phase 1 advances the WASM state to `tickTime` (same semantics as
   * the legacy single-sample `evalOutputsInTimeWindow` tick). Phase 2
   * projects all requested outputs at `numFutureSamples` evenly spaced
   * times between `tickTime` and `projectEnd` under save/restore (live
   * state is not corrupted).
   *
   * Resolves to `null` when the export isn't available — callers must
   * fall back to the legacy 3-call path. See
   * `docs/specs/visualisation.md` §5.2 / §7.2.
   */
  tickAndProject(
    outputs: string[],
    tickTime: number,
    projectEnd: number,
    numFutureSamples: number,
  ): Promise<TickAndProjectResult | null>;

  /**
   * Read structured diagnostics from the most recent evaluation.
   *
   * Used by editor evaluation to drive inline error squiggles after each
   * eval. Resolves to an empty array if the runtime is not loaded, the
   * diagnostic export is unavailable, or parsing fails.
   */
  readLastDiagnostics(): Promise<RuntimeDiagnostic[]>;

  /**
   * Read currently-active diagnostics across all live outputs.
   *
   * Polled per-frame (with backoff) from the visualisation runtime to
   * drive output health UI. Implementations should memoize on the raw
   * JSON string so repeated reads of the same state are cheap. Resolves
   * to an empty array if the runtime is not loaded, the diagnostic
   * export is unavailable, or parsing fails.
   */
  readActiveDiagnostics(): Promise<RuntimeDiagnostic[]>;
}

// ---------------------------------------------------------------------------
// Diagnostic types — re-exported from the canonical location
// ---------------------------------------------------------------------------

export type { UseqDiagnostic } from "./runtimeTypes";
export type { RuntimeDiagnostic };
