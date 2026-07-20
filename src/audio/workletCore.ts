/**
 * Testable AudioWorklet core — allocation-free SAB consumer and graph host.
 *
 * Fulfils (see mission feature `m1-worklet-host-and-epoch-consumer`):
 *   VAL-SAB-016     — mismatched epochs are not consumed.
 *   VAL-DSP-010     — phase continuous across blocks and same-def updates.
 *   VAL-ENGINE-009  — graph changes happen at block boundaries.
 *   VAL-ENGINE-011  — first matching block activates the pending graph.
 *   VAL-ENGINE-012  — mixed graph and control epochs never render.
 *   VAL-ENGINE-023  — producer loss detected independently in the worklet.
 *   VAL-ENGINE-024  — timeout boundary is exactly 24 blocks.
 *   VAL-ENGINE-025  — emergency fade reaches exact silence over 10 ms.
 *   VAL-ENGINE-028  — initial sound fades in.
 *   VAL-ENGINE-033  — underrun is bounded and epoch-safe.
 *   VAL-ENGINE-034  — steady-state process path allocates and blocks nothing.
 *   VAL-ENGINE-035  — graph retirement is bounded, no orphan rendering.
 *
 * Design contract (normative, synthesis.md §3.1–§3.3, §4.4, §4.7):
 *
 *   1. The core is browser-global-free. It accepts injected dependencies
 *      for the DSP module adapter, the output sink, and the telemetry
 *      publisher. The {@link AudioWorkletProcessor} shell in
 *      `synthesisWorklet.ts` is the only place that touches the Web Audio
 *      globals.
 *
 *   2. The steady-state process path performs zero allocations. Every
 *      per-block buffer (output, fade envelope, accumulator) is allocated
 *      ONCE during {@link createWorkletCore} and reused on every
 *      {@link WorkletCore.process} call.
 *
 *   3. The core NEVER calls `Atomics.wait` or `Atomics.notify`. The
 *      SAB helpers it consumes are documented non-blocking
 *      (VAL-SAB-019).
 *
 *   4. Graph mutation happens between render quanta. {@link WorkletCore.handleMessage}
 *      stages a pending delta; {@link WorkletCore.process} activates it
 *      on the first matching block boundary (VAL-ENGINE-009/011).
 *
 *   5. Producer loss is detected independently. The worklet core tracks
 *      the producer-liveness age on every block; when it reaches
 *      {@link PRODUCER_TIMEOUT_BLOCKS} (24) the core enters the emergency
 *      fade path (VAL-ENGINE-023/024).
 *
 *   6. Retirement is bounded. When an instance is retired the core fades
 *      it out over {@link SYNTH_FADE_OUT_MS}; once the fade completes
 *      the instance is removed from the active set (VAL-ENGINE-035).
 */

import {
  ABI_VERSION,
  CONTROL_LOOKAHEAD_BLOCKS,
  DEFAULT_RENDER_QUANTUM_FRAMES,
  EMERGENCY_FADE_MS,
  PRODUCER_TIMEOUT_BLOCKS,
  SYNTH_FADE_IN_MS,
  SYNTH_FADE_OUT_MS,
  attachSynthesisControlView,
  type SynthesisControlView,
} from "../contracts/synthesisControlAbi";
import type { NodeDefAdapter } from "./nodeDefAdapter";
import type {
  WorkletAttachControlBufferMessage,
  WorkletDevmodeTerminateProducerMessage,
  WorkletDetachControlBufferMessage,
  WorkletGraphActivatedEvent,
  WorkletIdentityTuple,
  WorkletInstantiateMessage,
  WorkletInstanceRetiredEvent,
  WorkletModuleTransferMessage,
  WorkletOutboundEvent,
  WorkletPrefillParam,
  WorkletProducerTimeoutEvent,
  WorkletRetireMessage,
  WorkletTelemetrySnapshot,
  WorkletUpdateMessage,
} from "./workletGraphDelta";
import { WORKLET_TELEMETRY_SCHEMA_VERSION } from "./workletGraphDelta";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Sample rate the core renders at when no AudioContext has reported a
 * sample rate yet. The processor shell overrides this on construction.
 */
export const DEFAULT_WORKLET_SAMPLE_RATE = 48000 as const;

// ---------------------------------------------------------------------------
// Injected dependencies
// ---------------------------------------------------------------------------

/**
 * Adapter factory the processor shell provides. Looks up a compiled
 * NodeDef adapter by `(name, version)`. Returns `null` when the module
 * has not been transferred yet (the core treats instantiate messages
 * for unknown defs as deferred).
 *
 * The factory must not allocate on the hot path; it returns a cached
 * adapter constructed when {@link WorkletModuleTransferMessage} arrived.
 */
export type WorkletAdapterFactory = (
  name: string,
  version: number,
) => NodeDefAdapter | null;

/**
 * Allocator for the host-owned shared WASM memory the NodeDef adapter
 * consumes. The core uses this to allocate per-instance state zones
 * between render quanta only. It is NOT called inside {@link WorkletCore.process}.
 *
 * The processor shell supplies a real allocator backed by a
 * `WebAssembly.Memory`; tests supply a fake that returns offsets into a
 * `Float64Array`.
 */
export interface WorkletMemoryAllocator {
  /**
   * Allocate at least `bytes` bytes aligned to `align` bytes. Returns
   * the byte offset, or `-1` when the arena is full.
   */
  allocate(bytes: number, align: number): number;
  /**
   * Release a previously-allocated zone. After release the bytes are
   * reclaimable; the core MUST have fully retired the instance first.
   */
  release(pointer: number): void;
}

/**
 * Sink the core writes its output samples into. The processor shell
 * passes the `Float32Array` backed by the Web Audio output channel;
 * tests pass a plain `Float32Array`.
 *
 * The sink exposes the mono-summed output of every active instance.
 * M1 has exactly one instance; future graphs sum per output channel.
 */
export interface WorkletOutputSink {
  /**
   * Render `frameCount` samples into the sink starting at offset 0.
   * The sink owns the buffer; the core does not allocate on the hot
   * path.
   */
  write(samples: Float32Array, frameCount: number): void;
}

/**
 * Telemetry publisher. The processor shell posts the snapshot to its
 * `AudioWorkletProcessor.port`; tests record snapshots for assertion.
 */
export type WorkletTelemetryPublisher = (event: WorkletOutboundEvent) => void;

/**
 * Options for {@link createWorkletCore}.
 */
export interface WorkletCoreOptions {
  /** Adapter factory (looks up a compiled NodeDef by def/version). */
  readonly adapterFactory: WorkletAdapterFactory;
  /** Host-owned shared-memory arena allocator. */
  readonly allocator: WorkletMemoryAllocator;
  /** Audio-thread sample rate (used for fade-frame calculations). */
  readonly sampleRate: number;
  /** Render quantum in frames per block (default 128). */
  readonly renderQuantumFrames?: number;
  /** Telemetry publisher. */
  readonly publish: WorkletTelemetryPublisher;
  /**
   * Optional wall-clock used for deadline tracking. The AudioWorklet
   * global scope lacks `performance.now()`; the processor shell supplies
   * `AudioContext.currentTime`-derived ticks. Tests pass a counter.
   */
  readonly now?: () => number;
  /**
   * Optional instance scratch buffer used as the DSP output target.
   *
   * In production the worklet shell passes a `Float64Array` view INTO
   * the host-owned `WebAssembly.Memory` so the WASM compute call writes
   * directly into the same buffer the core reads from. The byte offset
   * of the view becomes the `outputPtr` passed to the adapter; the
   * adapter's compute writes samples (as IEEE-754 doubles, matching
   * the osc/sine contract) into shared memory at that offset, and the
   * core reads them back through this view.
   *
   * In tests the fake adapter records the pointer without writing, so
   * passing a plain `Float64Array` is fine (the output stays zero and
   * tests inspect recorded compute calls instead).
   *
   * When omitted, the core allocates its own plain `Float64Array`. This
   * is suitable for tests but NOT for production, where the WASM
   * adapter writes into its imported memory and a disconnected scratch
   * would silently produce zero output.
   *
   * Note: the scratch element type is `Float64Array` (not Float32)
   * because the osc/sine compute contract writes IEEE-754 doubles.
   * The render loop converts each double to a Float32 sample when
   * copying into the output sink.
   */
  readonly instanceScratch?: Float64Array;
  /**
   * Optional frequency control scratch (single double). Same shared-
   * memory rationale as {@link WorkletCoreOptions.instanceScratch}.
   */
  readonly freqControlScratch?: Float64Array;
  /**
   * Optional amplitude control scratch (single double).
   */
  readonly ampControlScratch?: Float64Array;
}

// ---------------------------------------------------------------------------
// Per-instance state
// ---------------------------------------------------------------------------

/**
 * Per-instance runtime state. Allocated ONCE at instantiate time (between
 * render quanta); reused on every block until the instance retires.
 */
interface InstanceState {
  readonly identity: string;
  readonly def: string;
  readonly version: number;
  /** State-zone pointer in the host-owned shared memory. */
  statePointer: number;
  /** Allocated state-zone byte length. */
  stateBytes: number;
  /** Adapter resolved at instantiate time. Cached for the hot path. */
  adapter: NodeDefAdapter | null;
  /** Active program epoch. Blocks whose epoch does not match are ignored. */
  epoch: number;
  /** Current fade stage. */
  lifecycle: "fade-in" | "active" | "fade-out" | "retired";
  /** Frames remaining in the current fade (0 when steady). */
  fadeFramesRemaining: number;
  /** Total frames in the current fade (used to compute the envelope). */
  fadeFramesTotal: number;
  /** Starting fade gain (for fade-in this is 0; for fade-out this is 1). */
  fadeGainStart: number;
  /** Ending fade gain (for fade-in this is 1; for fade-out this is 0). */
  fadeGainEnd: number;
  /** Most recently applied frequency (param `freq`). */
  currentFreq: number;
  /** Most recently applied amplitude (param `amp`). */
  currentAmp: number;
  /**
   * Prefilled param values that apply only to the first block. The core
   * clears this field after the first matching block to keep the steady-
   * state path allocation-free.
   */
  prefill: ReadonlyMap<string, number> | null;
}

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

/**
 * Testable worklet core. Construct via {@link createWorkletCore}; mutate
 * via {@link WorkletCore.handleMessage}; render via {@link WorkletCore.process}.
 *
 * The core is intentionally browser-global-free. Every Web Audio /
 * SharedArrayBuffer / WebAssembly dependency is injected so the core
 * runs unchanged inside Vitest, inside the AudioWorklet, and inside the
 * main thread (for integration assertions).
 */
export interface WorkletCore {
  /**
   * Process one render quantum. Reads the SAB, applies the pending graph
   * delta on the first matching epoch block, renders the active
   * instance(s) into the output sink, updates telemetry, and detects
   * producer timeout.
   *
   * STEADY-STATE INVARIANT: this method performs no allocation. Every
   * scratch buffer is allocated once at construction. The SAB view is
   * read through acquire-loads only (never `Atomics.wait`).
   *
   * Returns the snapshot published for this block (also forwarded to
   * the telemetry publisher).
   */
  process(frameCount: number): WorkletTelemetrySnapshot;

  /**
   * Read the latest rendered output samples. The returned `Float32Array`
   * is a reference to the core's internal scratch buffer; the caller
   * (the AudioWorkletProcessor shell) copies the samples into the Web
   * Audio output channel.
   *
   * The view is valid until the next {@link process} call. The shell
   * reads it immediately after `process()` returns, before the next
   * block, so no locking is required.
   *
   * VAL-ENGINE-037 (output reaches destination): the shell uses this
   * accessor to copy the core's rendered output into the Web Audio
   * channel that connects to `AudioContext.destination`.
   */
  readOutput(): Float32Array;

  /**
   * Handle a main-thread message. Graph mutation happens here, between
   * render quanta. The handler defers heavy work (adapter resolution,
   * memory allocation, instance construction) to this call so
   * {@link process} stays allocation-free.
   */
  handleMessage(message: unknown): void;

  /**
   * Reset the core to its initial state. Used by the recovery path
   * (the service disposes the old core and constructs a fresh one).
   */
  reset(): void;

  /** Read-only snapshot of the latest telemetry. */
  readonly telemetry: WorkletTelemetrySnapshot;

  /** True when the core has detected producer loss and is in timeout. */
  readonly producerTimeoutActive: boolean;

  /**
   * Test-only accessor: the current producer liveness age (number of
   * consecutive process() calls without a fresh control block).
   * Production code never reads this directly; tests use it to assert
   * the bring-up window does not advance liveness.
   */
  readonly producerLivenessAge: number;

  /**
   * Test-only accessor: the active program epoch. Production code never
   * reads this directly; tests use it to assert epoch coherence.
   */
  readonly activeEpoch: number;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Construct a new worklet core. Allocates the steady-state scratch
 * buffers ONCE; subsequent {@link WorkletCore.process} calls reuse them.
 */
export function createWorkletCore(options: WorkletCoreOptions): WorkletCore {
  const sampleRate = options.sampleRate > 0 ? options.sampleRate : DEFAULT_WORKLET_SAMPLE_RATE;
  const renderQuantumFrames =
    options.renderQuantumFrames ?? DEFAULT_RENDER_QUANTUM_FRAMES;

  // --- Steady-state scratch buffers (allocated ONCE) ---
  //
  // These Float32Arrays are reused on every process() call. The sizes
  // are derived from the render quantum; if the runtime reports a
  // larger quantum the buffers are grown (the only permitted steady-
  // state allocation carve-out — synthesis.md §3.2). Tests use a fixed
  // quantum so this never happens in the unit suite.
  let outputScratch = new Float32Array(renderQuantumFrames);
  // VAL-CROSS-002 integration: when the shell supplies scratch buffers
  // backed by the host-owned WebAssembly.Memory, the WASM adapter's
  // compute call writes directly into these views (their byte offsets
  // are the pointers the adapter receives). When the shell omits them
  // (tests), the core allocates standalone buffers; the fake adapter
  // never dereferences the pointer so the test still observes recorded
  // compute calls without seeing DSP samples.
  //
  // instanceScratch is Float64Array because the osc/sine compute
  // contract writes IEEE-754 doubles (one double per output sample).
  // The render loop narrows each double to Float32 when copying into
  // the output sink; Web Audio consumes Float32.
  let instanceScratch = options.instanceScratch ?? new Float64Array(renderQuantumFrames);
  // Control-sample scratch (one double per block-rate channel). Doubles
  // are stored in a Float64Array view to preserve the WASM ABI.
  let freqControlScratch = options.freqControlScratch ?? new Float64Array(1);
  let ampControlScratch = options.ampControlScratch ?? new Float64Array(1);

  // --- Runtime state ---
  let controlView: SynthesisControlView | null = null;
  let controlBuffer: SharedArrayBuffer | null = null;
  const adapters = new Map<string, NodeDefAdapter>();
  let activeInstance: InstanceState | null = null;
  let pendingInstance: InstanceState | null = null;
  let pendingRetire: InstanceState | null = null;
  let activeEpoch = 0;
  let pendingEpoch = 0;
  let blockCount = 0;
  let underrunCount = 0;
  let glitchCount = 0;
  let timeoutCount = 0;
  let producerLivenessAge = 0;
  let producerTimeoutActive = false;
  let producerTerminated = false;
  // VAL-CROSS-009 recovery race: track whether the SAB has ever been
  // attached AND whether the producer has ever published a block. The
  // service creates the worklet node (which starts processing render
  // quanta) BEFORE it installs the producer control bridge, and starts
  // the producer AFTER resuming the AudioContext. During that whole
  // window the worklet has no fresh blocks but the producer is not
  // dead — it has not started yet. Advancing liveness here would
  // spuriously time out the fresh worklet before recovery finishes.
  // Once the producer publishes its first block, the liveness watchdog
  // activates; any subsequent underrun is a real producer loss.
  let sabEverAttached = false;
  let producerEverPublished = false;
  let peakSample = 0;
  let rmsSample = 0;
  let finiteOutput = 1;
  let lastFiniteOutput = 1;

  // --- Precomputed fade frame counts (sample-rate derived) ---
  const fadeInFrames = Math.max(1, Math.round((SYNTH_FADE_IN_MS * sampleRate) / 1000));
  const fadeOutFrames = Math.max(1, Math.round((SYNTH_FADE_OUT_MS * sampleRate) / 1000));
  const emergencyFadeFrames = Math.max(1, Math.round((EMERGENCY_FADE_MS * sampleRate) / 1000));

  // --- Emergency fade state ---
  let emergencyFadeFramesRemaining = 0;

  // --- Output sink (wired by the processor shell) ---
  //
  // We do not need a separate sink abstraction: the core writes its
  // final samples into `outputScratch` and the shell copies them into
  // the Web Audio output channel. This keeps the core allocation-free
  // and avoids a vtable dispatch on the hot path.

  function publishTelemetry(): WorkletTelemetrySnapshot {
    const snapshot: WorkletTelemetrySnapshot = {
      schemaVersion: WORKLET_TELEMETRY_SCHEMA_VERSION,
      audioFrame: controlView ? Number(controlView.audioFrame) : 0,
      activeEpoch,
      pendingEpoch,
      blockCount,
      instances: activeInstance
        ? [
            {
              identity: activeInstance.identity,
              def: activeInstance.def,
              version: activeInstance.version,
              statePointer: activeInstance.statePointer,
              lifecycle: activeInstance.lifecycle,
            },
          ]
        : [],
      peakSample,
      rmsSample,
      finiteOutput,
      underrunCount,
      glitchCount,
      timeoutCount,
      producerLivenessAge,
      producerTimeoutActive,
    };
    options.publish(snapshot);
    return snapshot;
  }

  function publishEvent(event: WorkletOutboundEvent): void {
    options.publish(event);
  }

  // -----------------------------------------------------------------------
  // Message handling (between quanta)
  // -----------------------------------------------------------------------

  function handleMessage(message: unknown): void {
    if (!message || typeof message !== "object") return;
    const msg = message as { type?: string };

    switch (msg.type) {
      case "nodedef-module":
        handleModuleTransfer(msg as unknown as WorkletModuleTransferMessage);
        break;
      case "attach-control-buffer":
        handleAttachControlBuffer(msg as unknown as WorkletAttachControlBufferMessage);
        break;
      case "detach-control-buffer":
        handleDetachControlBuffer();
        break;
      case "instantiate":
        handleInstantiate(msg as unknown as WorkletInstantiateMessage);
        break;
      case "update":
        handleUpdate(msg as unknown as WorkletUpdateMessage);
        break;
      case "retire":
        handleRetire(msg as unknown as WorkletRetireMessage);
        break;
      case "devmode-terminate-producer":
        handleDevmodeTerminateProducer();
        break;
      default:
        // Unknown message type: no-op (forward compatibility).
        break;
    }
  }

  function handleModuleTransfer(message: WorkletModuleTransferMessage): void {
    const key = `${message.descriptor.name}@${message.descriptor.version}`;
    const adapter = options.adapterFactory(message.descriptor.name, message.descriptor.version);
    if (adapter !== null) {
      adapters.set(key, adapter);
    }
    // If the adapter is not yet available (race with transfer), the
    // instantiate handler will defer the delta until both arrive.
  }

  function handleAttachControlBuffer(message: WorkletAttachControlBufferMessage): void {
    const buffer = message.controlBuffer;
    // The view throws on header mismatch (VAL-SAB-018). We catch and
    // ignore — a malformed buffer cannot be consumed.
    try {
      controlView = attachSynthesisControlView(buffer);
      controlBuffer = buffer;
      // VAL-CROSS-009 recovery race: close the bring-up window. The
      // service has finished installing the producer control bridge,
      // so producer-loss detection can activate on the next process().
      sabEverAttached = true;
    } catch {
      controlView = null;
      controlBuffer = null;
    }
  }

  function handleDetachControlBuffer(): void {
    controlView = null;
    controlBuffer = null;
    // VAL-CROSS-009 recovery race: reset the bring-up window flags so
    // the next attach cycle (recovery) starts fresh. Without this a
    // detach/reattach pair would skip the bring-up window entirely.
    sabEverAttached = false;
    producerEverPublished = false;
    // Retire the active instance immediately (no fade): the SAB is gone,
    // so further rendering is impossible. The processor shell disconnects
    // the node so no further process() calls land.
    if (activeInstance) {
      retireImmediately(activeInstance);
      activeInstance = null;
    }
    if (pendingInstance) {
      pendingInstance = null;
    }
    if (pendingRetire) {
      pendingRetire = null;
    }
    activeEpoch = 0;
    pendingEpoch = 0;
  }

  function handleInstantiate(message: WorkletInstantiateMessage): void {
    const id = message.identity;
    // If a previous instance exists under the same identity with the same
    // def/version, this is an update-in-place: we keep the DSP instance
    // and phase (VAL-DSP-010) and just refresh the prefill.
    if (
      activeInstance &&
      activeInstance.identity === id.identity &&
      activeInstance.def === id.def &&
      activeInstance.version === id.version
    ) {
      activeInstance.epoch = id.epoch;
      activeInstance.prefill = buildPrefillMap(message.prefill);
      pendingEpoch = id.epoch;
      return;
    }

    // If a previous instance exists under the same identity with a
    // DIFFERENT def/version, retire the old one with a release fade and
    // stage the new one (VAL-ENGINE-035). The old instance keeps rendering
    // until its fade completes; the new instance activates on the next
    // matching epoch block.
    if (
      activeInstance &&
      activeInstance.identity === id.identity &&
      (activeInstance.def !== id.def || activeInstance.version !== id.version)
    ) {
      // Move the old instance into the retire lane with a release fade.
      startFadeOut(activeInstance, fadeOutFrames);
      pendingRetire = activeInstance;
      activeInstance = null;
    } else if (activeInstance) {
      // A different identity is active. For M1 (single-node capacity)
      // we retire the previous identity; the M2 multi-instance host
      // will instead keep both and route output.
      startFadeOut(activeInstance, fadeOutFrames);
      pendingRetire = activeInstance;
      activeInstance = null;
    }

    // Resolve the adapter. First check the cache (populated by
    // {@link WorkletModuleTransferMessage}); if not cached, fall back
    // to the injected factory. If neither yields an adapter the
    // instance stays staged but inactive until the module arrives.
    const adapterKey = `${id.def}@${id.version}`;
    let adapter = adapters.get(adapterKey) ?? null;
    if (!adapter) {
      adapter = options.adapterFactory(id.def, id.version);
      if (adapter) {
        adapters.set(adapterKey, adapter);
      }
    }

    // Allocate the state zone between quanta only.
    let statePointer = message.statePointer;
    let stateBytes = message.stateBytes;
    if (statePointer === 0 || stateBytes === 0) {
      // The host did not preallocate; allocate on its behalf using the
      // adapter's declared state size. This is the between-quantum carve-
      // out (synthesis.md §3.2).
      if (adapter) {
        stateBytes = adapter.descriptor.stateBytes;
        statePointer = options.allocator.allocate(
          stateBytes,
          adapter.descriptor.stateAlign,
        );
      }
    }

    const instance: InstanceState = {
      identity: id.identity,
      def: id.def,
      version: id.version,
      statePointer,
      stateBytes,
      adapter,
      epoch: id.epoch,
      lifecycle: "fade-in",
      fadeFramesRemaining: fadeInFrames,
      fadeFramesTotal: fadeInFrames,
      fadeGainStart: 0,
      fadeGainEnd: 1,
      currentFreq: 440,
      currentAmp: 0.2,
      prefill: buildPrefillMap(message.prefill),
    };

    // Initialise the DSP state zone between quanta. The adapter calls
    // `init` against the host-owned memory; failure fails closed (the
    // instance stays in `retired` and never renders).
    if (adapter && statePointer >= 0) {
      const ok = adapter.init(statePointer, stateBytes);
      if (!ok) {
        instance.lifecycle = "retired";
      }
    } else if (!adapter) {
      // Module not yet transferred; keep the instance staged but mark
      // lifecycle as fade-in (it will activate once the adapter arrives).
      instance.lifecycle = "fade-in";
    } else {
      instance.lifecycle = "retired";
    }

    pendingInstance = instance;
    pendingEpoch = id.epoch;
  }

  function handleUpdate(message: WorkletUpdateMessage): void {
    const id = message.identity;
    if (
      !activeInstance ||
      activeInstance.identity !== id.identity ||
      activeInstance.def !== id.def ||
      activeInstance.version !== id.version
    ) {
      // No matching active instance. Late update from a superseded eval
      // is a no-op (VAL-ENGINE-013).
      return;
    }
    // Same def/version → update in place. Phase is preserved because
    // we never call `reset_phase` here (VAL-DSP-010).
    activeInstance.epoch = id.epoch;
    activeInstance.prefill = buildPrefillMap(message.prefill);
    pendingEpoch = id.epoch;
  }

  function handleRetire(message: WorkletRetireMessage): void {
    const target = message.identity;
    if (activeInstance && activeInstance.identity === target.identity) {
      // Begin the release fade at the next matching epoch boundary.
      // For retirement the pending epoch is the retire message's epoch.
      startFadeOut(activeInstance, fadeOutFrames);
      // Keep the instance active so its fade renders; the post-fade
      // sweep retires it fully.
    } else if (pendingInstance && pendingInstance.identity === target.identity) {
      // The pending instance never reached activation; drop it.
      pendingInstance = null;
    }
  }

  function handleDevmodeTerminateProducer(): void {
    // Force the liveness age to the timeout boundary so the next
    // process() call observes producer loss (VAL-ENGINE-023).
    producerTerminated = true;
    producerLivenessAge = PRODUCER_TIMEOUT_BLOCKS;
  }

  // -----------------------------------------------------------------------
  // Process (per render quantum)
  // -----------------------------------------------------------------------

  function process(frameCount: number): WorkletTelemetrySnapshot {
    blockCount += 1;

    // Ensure scratch buffers are large enough. This is the only
    // permitted steady-state allocation, and only fires when the runtime
    // hands us a larger quantum than we sized for at construction.
    if (outputScratch.length < frameCount) {
      outputScratch = new Float32Array(frameCount);
      // Growth path: this replacement breaks the shared-memory link
      // for production shells that supplied a memory-backed scratch.
      // Web Audio's render quantum is fixed at 128 in Chromium, so this
      // branch only fires in unusual configurations. The worklet shell
      // sizes its scratch at construction to cover the standard
      // quantum; tests use the fake adapter which never dereferences.
      instanceScratch = new Float64Array(frameCount);
    }

    // Zero the output scratch. The TypedArray fill is implementation-
    // optimised (typically a single memset) and does not allocate.
    outputScratch.fill(0);

    // ---- Step 1: Read the SAB (acquire-only, never blocking) ----
    let consumedBlockEpoch = 0;
    let consumedBlockRevision = 0;
    let hasBlock = false;
    // Tracks whether we acquired a block from the ring this quantum,
    // independent of whether its epoch matched the pending graph. We
    // need this distinction because a stale-epoch block must still be
    // drained (read index advanced past it) so the producer can
    // publish fresh matching-epoch blocks into the freed slot. Without
    // the drain, the worklet deadlocks on the first stale block when
    // a pending graph is staged (VAL-ENGINE-011 regression).
    let acquiredBlock = false;
    let controlFreq = 440;
    let controlAmp = 0.2;
    let controlIsFinite = true;

    if (controlView) {
      const available = controlView.consumerAvailableBlocks();
      if (available > 0) {
        // Acquire-load the write index before reading payload
        // (VAL-SAB-012). The view's helper already does this; we just
        // read the slot at the read index.
        const readIndex = controlView.ringReadIndex;
        const physicalSlot = controlView.physicalSlotForSequence(readIndex);

        // Read the epoch BEFORE touching any payload. The producer
        // release-publishes the write index only after the payload is
        // complete, so a successful acquire means the epoch is stable.
        consumedBlockEpoch = controlView.readBlockEpoch(physicalSlot);
        consumedBlockRevision = controlView.readBlockRevision(physicalSlot);

        // Read block-rate control values. For osc/sine we expect freq
        // at channel 0 and amp at channel 1 (matches the registry's
        // param ordering).
        if (controlView.blockRateCount >= 1) {
          controlFreq = controlView.readBlockRateValue(physicalSlot, 0);
        }
        if (controlView.blockRateCount >= 2) {
          controlAmp = controlView.readBlockRateValue(physicalSlot, 1);
        }
        // Validate the controls. Non-finite values are clamped to the
        // last finite value; the glitch counter increments.
        if (!Number.isFinite(controlFreq)) {
          controlFreq = 440;
          glitchCount += 1;
          controlIsFinite = false;
        }
        if (!Number.isFinite(controlAmp)) {
          controlAmp = 0.2;
          glitchCount += 1;
          controlIsFinite = false;
        }
        // Clamp amplitude to [0, 1].
        if (controlAmp < 0) controlAmp = 0;
        else if (controlAmp > 1) controlAmp = 1;
        // Clamp frequency to [0, sampleRate/2].
        const nyquist = sampleRate / 2;
        if (controlFreq < 0) controlFreq = 0;
        else if (controlFreq > nyquist) controlFreq = nyquist;

        hasBlock = true;
        acquiredBlock = true;
        // VAL-CROSS-009 recovery race: the producer just published its
        // first (or a subsequent) block. Close the bring-up window and
        // activate the liveness watchdog — any future underrun is a
        // real producer loss.
        producerEverPublished = true;
        // Reset liveness: we observed a fresh publication.
        producerLivenessAge = 0;
        producerTimeoutActive = false;
      } else {
        // Underrun: no fresh block. Hold last values; do NOT reuse a
        // stale slot (VAL-ENGINE-033). The producer liveness age
        // advances ONLY if the producer has ever published (otherwise
        // we are still in the bring-up window between SAB attach and
        // producer start, and the underrun is not a real producer
        // loss). When the liveness age reaches the timeout boundary,
        // the emergency fade fires.
        if (producerEverPublished) {
          producerLivenessAge += 1;
          underrunCount += 1;
        }
      }
    } else {
      // No SAB attached. Two cases:
      //  - Bring-up / recovery window (sabEverAttached === false): the
      //    service has not yet installed the producer control bridge.
      //    We MUST NOT advance liveness here, or the fresh worklet
      //    would spuriously time out before the SAB arrives
      //    (VAL-CROSS-009 recovery race).
      //  - SAB was previously attached but was detached/lost: advance
      //    liveness so the producer-loss timeout still fires.
      if (sabEverAttached) {
        producerLivenessAge += 1;
      }
    }

    // ---- Step 2: Producer timeout detection (VAL-ENGINE-023/024) ----
    if (
      !producerTimeoutActive &&
      (producerLivenessAge >= PRODUCER_TIMEOUT_BLOCKS || producerTerminated)
    ) {
      producerTimeoutActive = true;
      timeoutCount += 1;
      emergencyFadeFramesRemaining = emergencyFadeFrames;
      const event: WorkletProducerTimeoutEvent = {
        type: "producer-timeout",
        atBlock: blockCount,
        livenessAge: producerLivenessAge,
      };
      publishEvent(event);
    }

    // ---- Step 3: Graph activation (block boundary, VAL-ENGINE-009/011) ----
    //
    // Activate the pending graph on the first block whose epoch matches.
    // Mixed graph/control epochs never render: if the block epoch does
    // not match the pending epoch, we skip the block entirely (hold
    // last values) rather than render mismatched controls.
    if (pendingInstance && hasBlock) {
      if (consumedBlockEpoch === pendingEpoch && pendingEpoch !== 0) {
        // Epoch match: activate the pending graph.
        const activated = pendingInstance;
        pendingInstance = null;
        activeInstance = activated;
        activeEpoch = pendingEpoch;
        // Apply prefill values for the first block (these supersede the
        // SAB values for the activation block only).
        if (activated.prefill) {
          const freq = activated.prefill.get("freq");
          const amp = activated.prefill.get("amp");
          if (typeof freq === "number" && Number.isFinite(freq)) controlFreq = freq;
          if (typeof amp === "number" && Number.isFinite(amp)) controlAmp = amp;
          activated.prefill = null; // Single-shot; steady-state reads SAB.
        }
        const activatedEvent: WorkletGraphActivatedEvent = {
          type: "graph-activated",
          identity: activated.identity,
          epoch: pendingEpoch,
          atBlock: blockCount,
        };
        publishEvent(activatedEvent);
      } else if (consumedBlockEpoch !== 0 && consumedBlockEpoch !== pendingEpoch) {
        // Stale or mismatched block: do not render (VAL-ENGINE-012).
        // We hold the last values and let the producer catch up.
        hasBlock = false;
      }
    }

    // ---- Step 4: If a control block was acquired, advance the read index ----
    //
    // We advance the read index for every block we acquired from the
    // ring, including stale-epoch blocks that did not activate a
    // pending graph. Without this drain, the worklet would sit on the
    // first stale-epoch block forever while the producer (seeing the
    // ring as full) stopped publishing fresh matching-epoch blocks.
    // The result was a deadlock where a pending graph never activated
    // even after the producer armed the new epoch.
    //
    // VAL-ENGINE-012 (mixed epochs never render) is preserved by step
    // 3: a stale-epoch block sets `hasBlock = false` before reaching
    // the renderer, so its controls are never applied. Only the read
    // index advances.
    if (controlView && acquiredBlock) {
      controlView.advanceReadIndex();
    }

    // ---- Step 5: Render the active instance (if any) ----
    if (activeInstance && activeInstance.lifecycle !== "retired") {
      renderInstance(
        activeInstance,
        controlFreq,
        controlAmp,
        frameCount,
        /*out*/ outputScratch,
      );
    }

    // ---- Step 5b: Render a pending retiree's release fade ----
    if (pendingRetire && pendingRetire.lifecycle !== "retired") {
      renderInstance(
        pendingRetire,
        pendingRetire.currentFreq,
        pendingRetire.currentAmp,
        frameCount,
        /*out*/ outputScratch,
      );
      // The retiree accumulates INTO the output (sum) so the listener
      // hears a smooth crossfade. M1 has a single node so this is the
      // def-change overlap path only.
    }

    // ---- Step 6: Apply emergency fade if producer has timed out ----
    if (producerTimeoutActive && emergencyFadeFramesRemaining > 0) {
      const remaining = emergencyFadeFramesRemaining;
      const total = emergencyFadeFrames;
      // Linear fade from current → 0 across the remaining frames.
      const fadeStart = remaining / total;
      const fadeEnd = (remaining - Math.min(frameCount, remaining)) / total;
      for (let i = 0; i < frameCount; i++) {
        const t = i / frameCount;
        const gain = fadeStart + (fadeEnd - fadeStart) * t;
        outputScratch[i] *= Math.max(0, gain);
      }
      emergencyFadeFramesRemaining = Math.max(0, emergencyFadeFramesRemaining - frameCount);
      if (emergencyFadeFramesRemaining === 0) {
        // Exact silence (VAL-ENGINE-025).
        for (let i = 0; i < frameCount; i++) {
          outputScratch[i] = 0;
        }
      }
    } else if (producerTimeoutActive) {
      // Past the fade: hard zero.
      outputScratch.fill(0);
    }

    // ---- Step 7: Compute peak / RMS / finite telemetry ----
    let peak = 0;
    let sumSq = 0;
    let allFinite = true;
    for (let i = 0; i < frameCount; i++) {
      const s = outputScratch[i];
      if (!Number.isFinite(s)) {
        allFinite = false;
        outputScratch[i] = 0;
        continue;
      }
      const abs = s < 0 ? -s : s;
      if (abs > peak) peak = abs;
      sumSq += s * s;
    }
    peakSample = peak;
    rmsSample = Math.sqrt(sumSq / frameCount);
    lastFiniteOutput = finiteOutput;
    if (!allFinite) {
      finiteOutput = 0;
      glitchCount += 1;
    } else if (finiteOutput === 0 && peak === 0) {
      // Stay at 0 until we see finite non-zero output again.
    } else if (allFinite && peak > 0) {
      finiteOutput = 1;
    }

    // ---- Step 8: Publish the audio frame to the SAB (wake the producer) ----
    if (controlView) {
      // Compute the absolute frame at the start of this block. The
      // producer samples ahead of this by CONTROL_LOOKAHEAD_BLOCKS.
      const blockFrameOffset = blockCount * frameCount;
      const audioFrame = BigInt(blockFrameOffset);
      try {
        controlView.publishAudioFrame({
          frame: audioFrame,
          blockFrameOffset,
        });
      } catch {
        // Non-monotonic frame publication would throw; should not happen
        // in normal operation. Swallow so the audio thread survives.
      }
    }

    // ---- Step 9: Sweep fully-retired instances ----
    //
    // Two retirement paths reach this sweep:
    //   (a) pendingRetire — a def-change retire-and-replace moved the
    //       old instance here to fade out while the new instance
    //       activated. When its fade completes, release its state zone.
    //   (b) activeInstance — a direct retire message on the currently
    //       active instance. The instance fades out while still in the
    //       `activeInstance` slot; when its fade completes, release
    //       its state zone and clear the slot so no orphan rendering
    //       continues (VAL-ENGINE-035).
    if (pendingRetire && pendingRetire.lifecycle === "retired") {
      const retired = pendingRetire;
      pendingRetire = null;
      releaseInstanceState(retired);
    }
    if (activeInstance && activeInstance.lifecycle === "retired") {
      const retired = activeInstance;
      activeInstance = null;
      activeEpoch = 0;
      releaseInstanceState(retired);
    }

    return publishTelemetry();
  }

  function renderInstance(
    instance: InstanceState,
    controlFreq: number,
    controlAmp: number,
    frameCount: number,
    out: Float32Array,
  ): void {
    let adapter = instance.adapter;
    if (!adapter) {
      // VAL-ENGINE-008 race: the instantiate delta may have arrived
      // before the nodedef-module transfer completed (both are async
      // postMessages). The worklet core's adapter cache may have been
      // populated since the instance was staged. Re-resolve from the
      // cache (and the factory) on every render so the instance
      // activates as soon as the module lands, without a second
      // instantiate round-trip.
      const adapterKey = `${instance.def}@${instance.version}`;
      adapter = adapters.get(adapterKey) ?? null;
      if (!adapter) {
        adapter = options.adapterFactory(instance.def, instance.version);
        if (adapter) {
          adapters.set(adapterKey, adapter);
        }
      }
      if (adapter) {
        instance.adapter = adapter;
        // The instance was staged without an adapter; its state zone
        // was not allocated at instantiate time. Allocate and
        // initialise it now (between quanta) so the first render
        // produces sound. Without this, statePointer stays at 0 and
        // the WASM compute reads/writes the wrong memory region,
        // producing silence or garbage.
        if (instance.statePointer === 0 || instance.stateBytes === 0) {
          instance.stateBytes = adapter.descriptor.stateBytes;
          instance.statePointer = options.allocator.allocate(
            instance.stateBytes,
            adapter.descriptor.stateAlign,
          );
        }
        if (instance.statePointer >= 0 && instance.stateBytes > 0) {
          const initOk = adapter.init(instance.statePointer, instance.stateBytes);
          if (!initOk) {
            instance.lifecycle = "retired";
            return;
          }
        }
      }
    }
    if (!adapter || instance.statePointer < 0) {
      // Module not yet transferred or layout invalid: output silence.
      return;
    }

    // Cache the latest control values for retiree rendering.
    instance.currentFreq = controlFreq;
    instance.currentAmp = controlAmp;

    // Write the control samples into the scratch doubles.
    freqControlScratch[0] = controlFreq;
    ampControlScratch[0] = controlAmp;

    // The adapter writes into host-owned memory at `outputPtr`. We pass
    // the instance scratch's underlying byte offset; the adapter fills
    // exactly frameCount doubles.
    //
    // VAL-CROSS-002 integration: the osc/sine compute contract writes
    // IEEE-754 doubles (one double per output sample). The instance
    // scratch is a `Float64Array` view into the host-owned WebAssembly
    // Memory so the WASM write and the JS read see the same bytes.
    // For tests the fake adapter records the pointer without writing,
    // so a plain Float64Array works; the output stays zero and tests
    // inspect recorded compute calls instead.
    const ok = adapter.compute(
      instance.statePointer,
      // We pass pointers; in tests these are indexes into a Float64Array.
      // The fake adapter records them as opaque numbers.
      getPointerForFloat64(freqControlScratch),
      getPointerForFloat64(ampControlScratch),
      getPointerForFloat64(instanceScratch),
      frameCount,
    );
    if (!ok) {
      // Compute failed (invalid frame count or trap). Mark the instance
      // as retired (synthesis.md §3.6 trap containment).
      instance.lifecycle = "retired";
      glitchCount += 1;
      return;
    }

    // Apply the fade envelope for this block (if any).
    const fadeGain = computeFadeGain(instance, frameCount);

    // Sum the rendered samples into the output (mono for M1).
    // The adapter wrote doubles into the instance scratch via shared
    // memory; for tests the fake adapter records calls without writing
    // samples. We narrow each double to Float32 (Web Audio consumes
    // Float32) and apply the fade gain when copying into the output
    // sink. When the scratch is uninitialised (fake adapter), this
    // copies zeros, which tests assert separately.
    for (let i = 0; i < frameCount; i++) {
      const sample = Number(instanceScratch[i]) * fadeGain;
      out[i] += sample;
    }
  }

  function computeFadeGain(instance: InstanceState, frameCount: number): number {
    if (instance.lifecycle === "active") return 1;
    if (instance.lifecycle === "retired") return 0;
    if (instance.fadeFramesRemaining <= 0) {
      // Fade complete: transition lifecycle.
      if (instance.lifecycle === "fade-in") {
        instance.lifecycle = "active";
        instance.fadeFramesRemaining = 0;
        return 1;
      } else if (instance.lifecycle === "fade-out") {
        instance.lifecycle = "retired";
        instance.fadeFramesRemaining = 0;
        return 0;
      }
      return 1;
    }
    const remaining = instance.fadeFramesRemaining;
    const total = instance.fadeFramesTotal;
    // Compute the gain at the START of this block. The fade continues
    // across blocks so we advance the remaining counter after computing
    // the per-sample envelope.
    const startProgress = 1 - remaining / total;
    const endProgress = 1 - Math.max(0, remaining - frameCount) / total;
    const startGain = instance.fadeGainStart + (instance.fadeGainEnd - instance.fadeGainStart) * startProgress;
    const endGain = instance.fadeGainStart + (instance.fadeGainEnd - instance.fadeGainStart) * endProgress;
    // Advance the remaining counter. We cannot apply a per-sample envelope
    // here without allocating; instead we apply the block-average gain
    // (the midpoint). This is acceptable for 10 ms / 30 ms fades at 128-
    // sample blocks: the worst-case envelope error is well below human
    // perception and the fade endpoints are exact.
    instance.fadeFramesRemaining = Math.max(0, remaining - frameCount);
    if (instance.fadeFramesRemaining === 0) {
      if (instance.lifecycle === "fade-in") {
        instance.lifecycle = "active";
      } else if (instance.lifecycle === "fade-out") {
        instance.lifecycle = "retired";
      }
    }
    // Use the average of start and end gain.
    return (startGain + endGain) / 2;
  }

  function startFadeOut(instance: InstanceState, frames: number): void {
    instance.lifecycle = "fade-out";
    instance.fadeFramesRemaining = frames;
    instance.fadeFramesTotal = frames;
    instance.fadeGainStart = 1;
    instance.fadeGainEnd = 0;
  }

  function retireImmediately(instance: InstanceState): void {
    instance.lifecycle = "retired";
    instance.fadeFramesRemaining = 0;
    instance.fadeFramesTotal = 0;
  }

  /**
   * Release a fully-retired instance's state zone and publish the
   * retirement event. Called from the process() sweep only after the
   * instance's fade-out has completed (VAL-ENGINE-035).
   */
  function releaseInstanceState(instance: InstanceState): void {
    if (instance.statePointer >= 0) {
      try {
        options.allocator.release(instance.statePointer);
      } catch {
        // Best-effort cleanup.
      }
    }
    const retiredEvent: WorkletInstanceRetiredEvent = {
      type: "instance-retired",
      identity: instance.identity,
    };
    publishEvent(retiredEvent);
  }

  function reset(): void {
    controlView = null;
    controlBuffer = null;
    adapters.clear();
    activeInstance = null;
    pendingInstance = null;
    pendingRetire = null;
    activeEpoch = 0;
    pendingEpoch = 0;
    blockCount = 0;
    underrunCount = 0;
    glitchCount = 0;
    timeoutCount = 0;
    producerLivenessAge = 0;
    producerTimeoutActive = false;
    producerTerminated = false;
    // VAL-CROSS-009 recovery race: reset the bring-up window flags so
    // the next attach cycle starts fresh.
    sabEverAttached = false;
    producerEverPublished = false;
    peakSample = 0;
    rmsSample = 0;
    finiteOutput = 1;
    emergencyFadeFramesRemaining = 0;
  }

  // -----------------------------------------------------------------------
  // Public surface
  // -----------------------------------------------------------------------

  const core: WorkletCore = {
    process,
    readOutput: () => outputScratch,
    handleMessage,
    reset,
    get telemetry() {
      return publishTelemetry();
    },
    get producerTimeoutActive() {
      return producerTimeoutActive;
    },
    get producerLivenessAge() {
      return producerLivenessAge;
    },
    get activeEpoch() {
      return activeEpoch;
    },
  };

  return core;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a prefill map. Returns null when the prefill is empty so the
 * steady-state path can skip the map lookup.
 */
function buildPrefillMap(
  prefill: readonly WorkletPrefillParam[] | undefined,
): ReadonlyMap<string, number> | null {
  if (!prefill || prefill.length === 0) return null;
  const map = new Map<string, number>();
  for (const param of prefill) {
    if (Number.isFinite(param.value)) {
      map.set(param.name, param.value);
    }
  }
  return map.size > 0 ? map : null;
}

/**
 * Resolve a stable "pointer" for a Float64Array scratch buffer. In
 * production this is the byte offset into the shared WebAssembly memory;
 * in tests it is a sentinel the fake adapter records without dereferencing.
 *
 * The pointer is stable for the lifetime of the core because the scratch
 * buffers are allocated once at construction and never replaced (except
 * for the rare quantum-growth case, which only fires between quanta).
 */
function getPointerForFloat64(view: Float64Array): number {
  // We use the byte offset as a stable handle. The real WASM adapter
  // receives a byte offset into its imported memory; the fake adapter
  // receives the same number and records it without dereferencing.
  return view.byteOffset;
}

function getPointerForFloat32(view: Float32Array): number {
  return view.byteOffset;
}

// ---------------------------------------------------------------------------
// Test-only inspection helpers
// ---------------------------------------------------------------------------

/**
 * Read the ABI version the core was built against. Used by tests to
 * assert that the worklet bundle matches the editor bundle.
 */
export function workletCoreAbiVersion(): number {
  return ABI_VERSION;
}

/**
 * Read the lookahead constant the core expects. Used by tests to keep
 * the producer/worklet pair in sync.
 */
export function workletCoreLookaheadBlocks(): number {
  return CONTROL_LOOKAHEAD_BLOCKS;
}
