/**
 * Graph delta message types shared between the main-thread synthesis
 * service and the AudioWorklet core.
 *
 * Fulfils (partial — see mission feature
 * `m1-worklet-host-and-epoch-consumer`):
 *   VAL-ENGINE-009 — graph changes happen at block boundaries. The
 *                    worklet receives deltas via {@link WorkletInboundMessage}
 *                    but only applies them between render quanta.
 *   VAL-ENGINE-011 — first matching block activates the graph. Each
 *                    delta carries a program epoch; the core holds the
 *                    delta as pending until the first SAB block bearing
 *                    the matching epoch arrives.
 *   VAL-ENGINE-012 — mixed graph and control epochs never render. The
 *                    core rejects blocks whose epoch does not match the
 *                    pending or active epoch.
 *   VAL-ENGINE-035 — graph retirement is bounded. Retire / replace
 *                    deltas fade the old instance out at an epoch-coherent
 *                    block boundary with no orphan rendering.
 *
 * Architecture notes:
 *
 * - Messages are plain struct-clones; the worklet receives them via
 *   `AudioWorkletProcessor.port.onmessage`. The only transferable the
 *   main thread ever attaches is a compiled `WebAssembly.Module`
 *   (see {@link WorkletModuleTransferMessage}).
 *
 * - The shapes are stable: any new field is added optional so older
 *   senders keep working. The worklet core treats unknown message
 *   `type` values as no-ops rather than throwing — the audio thread
 *   must survive a forward-compatible main thread.
 *
 * - Identity, def, and version travel with every delta so the worklet
 *   can apply its own update-in-place rules (same def/version →
 *   preserve instance and phase; different def/version → retire + fade)
 *   without a second round-trip.
 */

// ---------------------------------------------------------------------------
// Identity / def tuple (carried by every delta)
// ---------------------------------------------------------------------------

/**
 * Identity tuple the main-thread eval pipeline emits for every synth
 * declaration. The `identity` is the stable editor sidecar ID; `def`
 * and `version` describe the NodeDef; `epoch` is the program epoch the
 * Worker has armed for this delta.
 *
 * The worklet core uses `epoch` to decide when the delta is allowed to
 * activate, and `(identity, def, version)` to decide update-in-place
 * versus retire-and-replace.
 */
export interface WorkletIdentityTuple {
  /** Stable editor-sidecar identity (never the source text). */
  readonly identity: string;
  /** NodeDef name (e.g. `"osc/sine"`). */
  readonly def: string;
  /** NodeDef version (matches the registry entry). */
  readonly version: number;
  /**
   * Program epoch the delta is armed for. The core holds the delta as
   * pending until the first matching SAB block arrives. Zero is the
   * "no program" sentinel; a non-zero delta epoch must match a block
   * epoch to activate (VAL-ENGINE-011).
   */
  readonly epoch: number;
}

// ---------------------------------------------------------------------------
// Param values (prefill)
// ---------------------------------------------------------------------------

/**
 * Prefilled param value for a delta. The main-thread eval pipeline
 * resolves the param expression to a finite scalar at prefill time and
 * ships it so the new instance never reads a stale or undefined slot
 * before the producer's first matching block lands.
 *
 * Param updates after activation are read directly from the SAB block-
 * rate channel region; prefill values apply only to the first block.
 */
export interface WorkletPrefillParam {
  /** Parameter name (matches the NodeDef registry entry). */
  readonly name: string;
  /** Finite scalar value for the first block. */
  readonly value: number;
}

// ---------------------------------------------------------------------------
// Inbound messages (main thread → worklet)
// ---------------------------------------------------------------------------

/**
 * Transfer a compiled NodeDef module to the worklet. The worklet reuses
 * the module without recompiling (VAL-ENGINE-008). Instantiation
 * against the host-owned shared memory happens between render quanta
 * inside the message handler (synthesis.md §3.2).
 *
 * VAL-ENGINE-008 contract: the main thread fetches the exact NodeDef
 * bytes and compiles AND validates them BEFORE installation. Exactly
 * ONE installation payload is sent per def before rendering or graph
 * activation. The payload carries EITHER:
 *
 *   - `module` — a structured-cloned `WebAssembly.Module` the browser
 *     has agreed to clone across the AudioWorklet MessagePort. This is
 *     the preferred path (no recompilation on the audio side).
 *
 *   - `wasmBytes` — the EXACT prevalidated bytes the main thread
 *     compiled from. This is the Chromium compatibility fallback for
 *     versions that silently drop `WebAssembly.Module` across the
 *     AudioWorklet MessagePort. The worklet compiles these bytes ONCE
 *     in its message handler (before graph activation) and reuses the
 *     resulting module for every subsequent instantiation.
 *
 * Setting BOTH fields is a contract violation; the worklet treats such
 * a payload as malformed and refuses installation. Setting NEITHER is
 * also a violation; the worklet cannot install "nothing". The
 * `WorkletModuleTransferKind` discriminator exposes the choice in
 * telemetry and tests.
 *
 * Compilation inside `process()` or any steady-state path is forbidden.
 */
export interface WorkletModuleTransferMessage {
  readonly type: "nodedef-module";
  readonly descriptor: {
    readonly name: string;
    readonly version: number;
  };
  /**
   * Compiled `WebAssembly.Module` for the structured-clone fast path.
   * Mutually exclusive with {@link wasmBytes}.
   */
  readonly module?: WebAssembly.Module;
  /**
   * EXACT prevalidated bytes the main thread compiled from. Mutually
   * exclusive with {@link module}. The worklet compiles these ONCE
   * in its message handler and reuses the resulting module.
   */
  readonly wasmBytes?: Uint8Array;
}

/**
 * Discriminator describing which installation path a
 * {@link WorkletModuleTransferMessage} used. Exposed for tests and
 * telemetry so the VAL-ENGINE-008 "exactly one" rule is observable.
 *
 *   - `"module"` — structured-cloned compiled module path (preferred).
 *   - `"bytes"` — exact-byte fallback (Chromium compatibility).
 *   - `"malformed"` — neither or both fields set; the worklet refuses
 *     installation of malformed payloads.
 */
export type WorkletModuleTransferKind = "module" | "bytes" | "malformed";

/**
 * Inspect a {@link WorkletModuleTransferMessage}-shaped payload and
 * report which installation path it represents. Used by the worklet
 * shell and by tests to enforce the "exactly one of module OR
 * wasmBytes" rule (VAL-ENGINE-008).
 */
export function classifyModuleTransfer(
  payload: Pick<WorkletModuleTransferMessage, "module" | "wasmBytes">,
): WorkletModuleTransferKind {
  const hasModule = typeof payload.module !== "undefined" && payload.module !== null;
  const hasBytes = typeof payload.wasmBytes !== "undefined" && payload.wasmBytes !== null;
  if (hasModule && !hasBytes) return "module";
  if (hasBytes && !hasModule) return "bytes";
  return "malformed";
}

/**
 * Instantiate a new NodeDef instance at the next matching epoch
 * boundary. The core fades the new instance in over
 * `SYNTH_FADE_IN_MS` (default 10 ms, VAL-ENGINE-028).
 *
 * If a previous instance is still active under the same identity, the
 * core treats this message as an update-in-place when def/version match
 * (no DSP reset; phase preserved, VAL-DSP-010 / VAL-ENGINE-014) and as
 * a retire-and-replace when def/version differ (old instance fades out,
 * new instance fades in, overlapping fades per synth-nodes.md §5.7).
 */
export interface WorkletInstantiateMessage {
  readonly type: "instantiate";
  readonly identity: WorkletIdentityTuple;
  /** Prefilled param values for the first block. */
  readonly prefill?: readonly WorkletPrefillParam[];
  /**
   * Pointer offset into the worklet's shared WASM memory where the
   * instance's state zone has been allocated. The host adapter calls
   * `validate_layout` against this pointer before `init`.
   */
  readonly statePointer: number;
  /** Allocated state-zone byte length (must satisfy `validate_layout`). */
  readonly stateBytes: number;
}

/**
 * Update the parameters of an existing instance without replacing the
 * DSP instance or resetting phase (VAL-DSP-010). If no active instance
 * matches the identity, the message is a no-op (a late update from a
 * superseded eval).
 */
export interface WorkletUpdateMessage {
  readonly type: "update";
  readonly identity: WorkletIdentityTuple;
  readonly prefill?: readonly WorkletPrefillParam[];
}

/**
 * Retire an instance with a release fade (`SYNTH_FADE_OUT_MS`, default
 * 30 ms). After the fade completes the instance is fully retired and
 * its state zone is reclaimable; no orphan rendering continues
 * (VAL-ENGINE-035).
 */
export interface WorkletRetireMessage {
  readonly type: "retire";
  readonly identity: Pick<WorkletIdentityTuple, "identity" | "epoch">;
}

/**
 * Devmode-only controlled fault: simulate producer loss. The worklet
 * core immediately stops observing fresh producer activity and enters
 * the timeout fade path (VAL-ENGINE-023, VAL-ENGINE-024).
 *
 * Production builds never send this message.
 */
export interface WorkletDevmodeTerminateProducerMessage {
  readonly type: "devmode-terminate-producer";
}

/**
 * Attach the SharedArrayBuffer that carries the control ring. The
 * worklet core consumes the SAB without ever blocking on it
 * (VAL-SAB-019). The view exposes the typed {@link SynthesisControlView}
 * surface.
 *
 * The `controlBuffer` field is the underlying `SharedArrayBuffer`.
 */
export interface WorkletAttachControlBufferMessage {
  readonly type: "attach-control-buffer";
  readonly controlBuffer: SharedArrayBuffer;
}

/**
 * Disconnect from the SAB and retire every active instance. Sent by
 * the service when the engine is disposed or reinitialised.
 */
export interface WorkletDetachControlBufferMessage {
  readonly type: "detach-control-buffer";
}

/**
 * Union of every message the worklet core accepts. Unknown shapes are
 * treated as no-ops so a forward-compatible main thread cannot crash
 * the audio thread.
 */
export type WorkletInboundMessage =
  | WorkletModuleTransferMessage
  | WorkletInstantiateMessage
  | WorkletUpdateMessage
  | WorkletRetireMessage
  | WorkletDevmodeTerminateProducerMessage
  | WorkletAttachControlBufferMessage
  | WorkletDetachControlBufferMessage;

// ---------------------------------------------------------------------------
// Outbound telemetry (worklet → main thread)
// ---------------------------------------------------------------------------

/**
 * Per-instance descriptor the core exposes in telemetry. The
 * `identity` matches the main-thread sidecar ID; `phase` and
 * `smoothedAmp` are the DSP-side readbacks used by conformance tests.
 */
export interface WorkletInstanceTelemetry {
  readonly identity: string;
  readonly def: string;
  readonly version: number;
  readonly statePointer: number;
  /** True while the instance is fading in, active, or fading out. */
  readonly lifecycle: "fade-in" | "active" | "fade-out" | "retired";
}

/**
 * Snapshot the core publishes to the main thread after every block.
 * The main-thread synthesis service incorporates these values into its
 * devmode telemetry (VAL-ENGINE-029).
 *
 * Every field is a finite primitive; the snapshot is structurally
 * cloneable so it survives `postMessage` without translation.
 */
export interface WorkletTelemetrySnapshot {
  readonly schemaVersion: number;
  readonly audioFrame: number;
  readonly activeEpoch: number;
  readonly pendingEpoch: number;
  /** Number of rendered blocks since the core was constructed. */
  readonly blockCount: number;
  /** Active instance telemetry (one for M1; the array is future-proof). */
  readonly instances: readonly WorkletInstanceTelemetry[];
  /** Latest output peak (absolute). */
  readonly peakSample: number;
  /** Latest output RMS. */
  readonly rmsSample: number;
  /** 1 while every output sample is finite, 0 after a NaN/Inf trap. */
  readonly finiteOutput: number;
  /** Monotonic underrun counter (VAL-ENGINE-033). */
  readonly underrunCount: number;
  /** Monotonic glitch counter (deadline misses). */
  readonly glitchCount: number;
  /** Monotonic producer-timeout counter (VAL-ENGINE-024). */
  readonly timeoutCount: number;
  /** Current producer-liveness age in blocks. */
  readonly producerLivenessAge: number;
  /** True while the core has detected producer loss and is fading out. */
  readonly producerTimeoutActive: boolean;
}

/** Telemetry schema version. Bumped only when the snapshot shape changes. */
export const WORKLET_TELEMETRY_SCHEMA_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Outbound state-transition event (worklet → main thread)
// ---------------------------------------------------------------------------

/**
 * Event the core publishes when the producer-timeout path fires.
 * The synthesis service listens and transitions the engine to `error`
 * (VAL-ENGINE-023, VAL-ENGINE-026).
 */
export interface WorkletProducerTimeoutEvent {
  readonly type: "producer-timeout";
  /** Block count at which the timeout was detected. */
  readonly atBlock: number;
  /** Liveness age that triggered the timeout (in blocks). */
  readonly livenessAge: number;
}

/**
 * Event the core publishes when an instance finishes retiring. The
 * service uses this to advance its internal graph state and reclaim
 * bookkeeping (VAL-ENGINE-035).
 */
export interface WorkletInstanceRetiredEvent {
  readonly type: "instance-retired";
  readonly identity: string;
}

/**
 * Event the core publishes when a new graph delta activates on its
 * matching epoch block. Useful for telemetry correlation
 * (VAL-ENGINE-011).
 */
export interface WorkletGraphActivatedEvent {
  readonly type: "graph-activated";
  readonly identity: string;
  readonly epoch: number;
  readonly atBlock: number;
}

/**
 * Ack the core publishes after handling `attach-control-buffer`
 * (`synthesis.md` §4.8). `ok: false` means the SAB failed validation
 * (ABI magic/version mismatch — typically a stale cached worklet
 * bundle) and the service must fail closed into `error`; the service
 * also treats a missing ack (timeout) as fatal.
 */
export interface WorkletControlAttachAckEvent {
  readonly type: "attach-control-buffer-ack";
  readonly ok: boolean;
  readonly reason?: string;
}

export type WorkletOutboundEvent =
  | WorkletTelemetrySnapshot
  | WorkletProducerTimeoutEvent
  | WorkletInstanceRetiredEvent
  | WorkletGraphActivatedEvent
  | WorkletControlAttachAckEvent;
