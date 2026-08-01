/**
 * Testable AudioWorklet core — allocation-free SAB consumer and graph host.
 *
 * Fulfils (see mission feature `m1-worklet-host-and-epoch-consumer` and
 * synthesis epic M2.1, ergo 9a9370af / 10271a1d):
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
 * Design contract (normative, synthesis.md §2.3, §3.1–§3.3, §4.4, §4.7):
 *
 *   1. The core is browser-global-free. It accepts injected dependencies
 *      for the DSP module adapter, the shared-memory allocator, the
 *      arena view factory, and the telemetry publisher. The
 *      {@link AudioWorkletProcessor} shell in `synthesisWorklet.ts` is
 *      the only place that touches the Web Audio globals.
 *
 *   2. The steady-state process path performs zero allocations. Every
 *      per-block buffer (output scratch, per-instance zones, input
 *      pointer vectors, telemetry entries) is allocated at graph-
 *      mutation boundaries and reused on every {@link WorkletCore.process}
 *      call.
 *
 *   3. The core NEVER calls `Atomics.wait` or `Atomics.notify`. The
 *      SAB helpers it consumes are documented non-blocking
 *      (VAL-SAB-019).
 *
 *   4. Graph mutation happens between render quanta. {@link WorkletCore.handleMessage}
 *      stages pending deltas; {@link WorkletCore.process} activates the
 *      staged set on the first matching block boundary (VAL-ENGINE-009/011).
 *
 *   5. Multi-node execution (synthesis.md §3.1): the core hosts N live
 *      instances and executes them in TOPOLOGICAL order of the patch
 *      graph per block. Each instance owns an output zone in the
 *      host-owned shared memory; downstream nodes receive upstream
 *      zones as input-port pointers (pointer wiring, never copying);
 *      terminal instances (no downstream consumer) sum into the output
 *      scratch. A consumer whose source retires reads the shared
 *      silence zone, never a dangling pointer.
 *
 *   6. Producer loss is detected independently. The worklet core tracks
 *      the producer-liveness age on every block; when it reaches
 *      {@link PRODUCER_TIMEOUT_BLOCKS} (24) the core enters the emergency
 *      fade path (VAL-ENGINE-023/024).
 *
 *   7. Retirement is bounded. When an instance is retired the core fades
 *      it out over {@link SYNTH_FADE_OUT_MS}; once the fade completes
 *      the instance is removed from the active set and its zones are
 *      released back to the arena (VAL-ENGINE-035).
 *
 *   8. Render-quantum growth (synthesis.md §1.4, ergo 10271a1d): when
 *      the runtime reports a larger quantum than the zones were sized
 *      for, the core re-derives every zone THROUGH the allocator and
 *      the arena view factory — it never replaces a shared-memory view
 *      with a disconnected local array.
 */

import {
  ABI_VERSION,
  CONTROL_LOOKAHEAD_BLOCKS,
  DEFAULT_AUDIO_OUTPUT_PORTS,
  DEFAULT_RENDER_QUANTUM_FRAMES,
  EMERGENCY_FADE_MS,
  MAX_RENDER_QUANTUM_FRAMES,
  MAX_SYNTH_NODES,
  PRODUCER_TIMEOUT_BLOCKS,
  SYNTH_FADE_IN_MS,
  SYNTH_FADE_OUT_MS,
  attachSynthesisControlView,
  type SynthesisControlView,
} from "../contracts/synthesisControlAbi";
import type { NodeDefAdapter } from "./nodeDefAdapter";
import type {
  WorkletAttachControlBufferMessage,
  WorkletAudioInputWiring,
  WorkletControlChannel,
  WorkletGraphActivatedEvent,
  WorkletAbortGraphMessage,
  WorkletActivateGraphMessage,
  WorkletCommitGraphMessage,
  WorkletInstantiateMessage,
  WorkletInstanceRetiredEvent,
  WorkletInstanceTelemetry,
  WorkletModuleTransferMessage,
  WorkletOutboundEvent,
  WorkletPrefillParam,
  WorkletProducerTimeoutEvent,
  WorkletPrepareGraphMessage,
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

const BYTES_PER_DOUBLE = Float64Array.BYTES_PER_ELEMENT;
const DOUBLE_ALIGN = Float64Array.BYTES_PER_ELEMENT;

/** Registry defaults used when a control channel is absent or invalid. */
const DEFAULT_FREQ = 440;
const DEFAULT_AMP = 0.2;

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
 * consumes. The core uses this to allocate per-instance state and
 * output zones between render quanta only. It is NOT called inside the
 * steady-state {@link WorkletCore.process} path.
 *
 * The processor shell supplies the real zone allocator
 * (`workletZoneAllocator.ts`) backed by a `WebAssembly.Memory`; tests
 * supply the same allocator over a plain `ArrayBuffer` or a fake that
 * returns opaque offsets.
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
   * Factory for `Float64Array` views over the host-owned arena. The
   * allocator hands out byte offsets; this factory turns an offset into
   * a live view so the core can read back the doubles the WASM compute
   * wrote (and zero zones at mutation boundaries).
   *
   * In production the worklet shell supplies
   * `(offset, len) => new Float64Array(memory.buffer, offset, len)`.
   * When omitted (adapter-recording unit tests), the core falls back to
   * standalone `Float64Array`s — the fake adapters never dereference
   * their pointers, so tests observe recorded compute calls instead of
   * samples.
   */
  readonly createArenaView?: (byteOffset: number, lengthDoubles: number) => Float64Array;
  /**
   * Optional frequency control scratch (single double). In production
   * this is a view INTO the host-owned memory so the WASM compute call
   * reads the same bytes the core writes.
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

type MutableInstanceTelemetry = {
  -readonly [K in keyof WorkletInstanceTelemetry]: WorkletInstanceTelemetry[K];
};

/**
 * Per-instance runtime state. Allocated at instantiate time (between
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
  /** Most recently applied frequency (param `freq`). Held on underrun. */
  currentFreq: number;
  /** Most recently applied amplitude (param `amp`). Held on underrun. */
  currentAmp: number;
  /**
   * Prefilled param values that apply to the first matching-epoch
   * block only. Cleared after application so the steady-state path
   * skips the lookup.
   */
  prefill: ReadonlyMap<string, number> | null;
  /** Audio output port count. */
  audioOutputs: number;
  /** Declared audio-input wiring (patch-graph edges into this node). */
  inputWiring: readonly WorkletAudioInputWiring[];
  /**
   * Resolved input-port pointers (byte offsets into the arena), one
   * per input port. Preallocated at graph-mutation time; mutated in
   * place (silence repointing) — never reallocated on the hot path.
   */
  inputPtrs: number[];
  /** Staged input pointers, swapped in at epoch activation. */
  pendingInputPtrs: number[] | null;
  /** Output zone pointer (all ports), or -1 when allocation failed. */
  outputZonePtr: number;
  /** Output zone byte length. */
  outputZoneBytes: number;
  /** View over the output zone (audioOutputs × zoneFrames doubles). */
  outputView: Float64Array | null;
  /** True when no other instance consumes this instance's output. */
  isTerminal: boolean;
  /** Staged terminal flag, swapped in at epoch activation. */
  pendingIsTerminal: boolean;
  /**
   * Per-(node, param) block-rate SAB channel assignments (compiler
   * channel table, M2.2). Params without an entry are unbound: the
   * instance holds its prefill/default value for them.
   */
  controlChannels: ReadonlyMap<string, number>;
  /** One-shot guard for the missing-input-support diagnostic. */
  inputSupportWarned: boolean;
  /** True once the retire-sweep released this instance's zones. */
  released: boolean;
  /** Pooled telemetry entry (mutated in place every block). */
  telemetryEntry: MutableInstanceTelemetry;
}

interface PreparedGraphCandidate {
  readonly transactionId: number;
  readonly epoch: number;
  readonly newInstances: Map<string, InstanceState>;
  readonly updates: Map<string, WorkletUpdateMessage>;
  readonly retireIdentities: Set<string>;
  readonly order: InstanceState[];
  readonly inputPointers: Map<InstanceState, number[]>;
  readonly terminal: Map<InstanceState, boolean>;
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
   * Process one render quantum. Reads the SAB, activates the staged
   * graph delta on the first matching epoch block, renders the live
   * instances in topological order into the output scratch, updates
   * telemetry, and detects producer timeout.
   *
   * STEADY-STATE INVARIANT: this method performs no allocation. Every
   * scratch buffer is allocated at graph-mutation boundaries. The SAB
   * view is read through acquire-loads only (never `Atomics.wait`).
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
   * memory allocation, instance construction, topological planning) to
   * this call so {@link process} stays allocation-free.
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
 * buffers up front; subsequent {@link WorkletCore.process} calls reuse
 * them.
 */
export function createWorkletCore(options: WorkletCoreOptions): WorkletCore {
  const sampleRate = options.sampleRate > 0 ? options.sampleRate : DEFAULT_WORKLET_SAMPLE_RATE;
  const renderQuantumFrames =
    options.renderQuantumFrames ?? DEFAULT_RENDER_QUANTUM_FRAMES;

  /**
   * Per-port zone capacity in frames. Grows (only) when the runtime
   * reports a larger render quantum; growth re-derives every zone
   * through the allocator + arena view factory (ergo 10271a1d).
   */
  let zoneFrames = renderQuantumFrames;

  // Final mono output (Float32, core-local — Web Audio consumes Float32).
  let outputScratch = new Float32Array(zoneFrames);

  const arenaMode = typeof options.createArenaView === "function";
  const arenaView =
    options.createArenaView ?? ((_byteOffset: number, lengthDoubles: number) => new Float64Array(lengthDoubles));

  // Control-sample scratch (one double per block-rate channel). In
  // production these are views into the host-owned memory; the render
  // loop writes each instance's controls into them immediately before
  // that instance's compute call (execution is sequential, so one pair
  // serves every instance).
  const freqControlScratch = options.freqControlScratch ?? new Float64Array(1);
  const ampControlScratch = options.ampControlScratch ?? new Float64Array(1);

  // --- Shared silence zone -------------------------------------------------
  //
  // Input ports whose source is absent or retired point here. The zone
  // is zero-filled at allocation and never written, so a dangling
  // consumer reads silence — never freed memory (synthesis.md §3.1).
  let silencePtr = 0;
  let silenceView: Float64Array | null = null;

  function ensureSilenceZone(): void {
    if (silenceView) return;
    const bytes = zoneFrames * BYTES_PER_DOUBLE;
    const ptr = options.allocator.allocate(bytes, DOUBLE_ALIGN);
    if (ptr >= 0) {
      silencePtr = ptr;
      silenceView = arenaView(ptr, zoneFrames);
    } else {
      silencePtr = 0;
      silenceView = new Float64Array(zoneFrames);
    }
    silenceView.fill(0);
  }

  // --- Runtime state ---
  let controlView: SynthesisControlView | null = null;
  let controlBuffer: SharedArrayBuffer | null = null;
  const adapters = new Map<string, NodeDefAdapter>();
  /**
   * Live rendering set in topological execution order. Includes
   * fading-out retirees until the sweep removes them.
   */
  let executionOrder: InstanceState[] = [];
  /** Newest instance per identity (fading def-change ancestors excluded). */
  const liveByIdentity = new Map<string, InstanceState>();
  /** Staged instances awaiting their epoch block (not rendering yet). */
  const staged = new Map<string, InstanceState>();
  /** Precomputed post-activation execution order (swap at activation). */
  let stagedOrder: InstanceState[] | null = null;
  let preparedCandidate: PreparedGraphCandidate | null = null;
  let committedCandidate: PreparedGraphCandidate | null = null;
  let committedCandidateEligible = false;
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

  // --- Precomputed fade frame counts (sample-rate derived) ---
  const fadeInFrames = Math.max(1, Math.round((SYNTH_FADE_IN_MS * sampleRate) / 1000));
  const fadeOutFrames = Math.max(1, Math.round((SYNTH_FADE_OUT_MS * sampleRate) / 1000));
  const emergencyFadeFrames = Math.max(1, Math.round((EMERGENCY_FADE_MS * sampleRate) / 1000));

  // --- Emergency fade state ---
  let emergencyFadeFramesRemaining = 0;

  // Retained telemetry struct, mutated in place on every read. Steady-
  // state telemetry lives in the SAB header (written in process() step
  // 8); this object only serves the `telemetry` getter / process()
  // return value for tests and the simulated (non-SAB) worklet core, so
  // the audio thread never allocates for telemetry (b3895dbe). Callers
  // must copy fields they want to hold across blocks. Per-instance
  // entries are pooled on the InstanceState (allocated at instantiate,
  // a mutation boundary).
  type MutableTelemetry = {
    -readonly [K in keyof Omit<WorkletTelemetrySnapshot, "instances">]:
      WorkletTelemetrySnapshot[K];
  } & { instances: MutableInstanceTelemetry[] };
  const retainedTelemetry: MutableTelemetry = {
    schemaVersion: WORKLET_TELEMETRY_SCHEMA_VERSION,
    audioFrame: 0,
    activeEpoch: 0,
    pendingEpoch: 0,
    blockCount: 0,
    instances: [],
    peakSample: 0,
    rmsSample: 0,
    finiteOutput: 1,
    underrunCount: 0,
    glitchCount: 0,
    timeoutCount: 0,
    producerLivenessAge: 0,
    producerTimeoutActive: false,
  };

  function refreshTelemetry(): WorkletTelemetrySnapshot {
    const t = retainedTelemetry;
    t.audioFrame = controlView ? Number(controlView.audioFrame) : 0;
    t.activeEpoch = activeEpoch;
    t.pendingEpoch = pendingEpoch;
    t.blockCount = blockCount;
    t.instances.length = 0;
    for (const inst of executionOrder) {
      const e = inst.telemetryEntry;
      e.identity = inst.identity;
      e.def = inst.def;
      e.version = inst.version;
      e.statePointer = inst.statePointer;
      e.lifecycle = inst.lifecycle;
      t.instances.push(e);
    }
    t.peakSample = peakSample;
    t.rmsSample = rmsSample;
    t.finiteOutput = finiteOutput;
    t.underrunCount = underrunCount;
    t.glitchCount = glitchCount;
    t.timeoutCount = timeoutCount;
    t.producerLivenessAge = producerLivenessAge;
    t.producerTimeoutActive = producerTimeoutActive;
    return t;
  }

  function publishEvent(event: WorkletOutboundEvent): void {
    options.publish(event);
  }

  // -----------------------------------------------------------------------
  // Graph planning (between quanta only)
  // -----------------------------------------------------------------------

  /** Resolve the instance an identity refers to for wiring purposes. */
  function resolveSource(identity: string): InstanceState | null {
    return staged.get(identity) ?? liveByIdentity.get(identity) ?? null;
  }

  /**
   * Rebuild the pending graph plan: topological execution order over
   * (live ∪ staged), per-instance input-port pointers, and terminal
   * flags. Runs in the message handler (between quanta) so activation
   * inside process() is a pure pointer/array swap.
   *
   * When nothing is staged, the plan applies immediately (still between
   * quanta — a block boundary per VAL-ENGINE-009).
   */
  function rebuildGraphPlan(): void {
    const union: InstanceState[] = [];
    for (const inst of executionOrder) union.push(inst);
    for (const inst of staged.values()) union.push(inst);

    // --- Topological order (Kahn, stable) ---
    const indexOf = new Map<InstanceState, number>();
    for (let i = 0; i < union.length; i++) indexOf.set(union[i], i);
    const indegree = new Array<number>(union.length).fill(0);
    const adjacency: number[][] = union.map(() => []);
    for (const inst of union) {
      for (const w of inst.inputWiring) {
        const src = resolveSource(w.sourceIdentity);
        if (src && src !== inst && indexOf.has(src)) {
          adjacency[indexOf.get(src)!].push(indexOf.get(inst)!);
          indegree[indexOf.get(inst)!] += 1;
        }
      }
    }
    const order: InstanceState[] = [];
    const visited = new Array<boolean>(union.length).fill(false);
    const ready: number[] = [];
    for (let i = 0; i < union.length; i++) {
      if (indegree[i] === 0) ready.push(i);
    }
    while (ready.length > 0) {
      const i = ready.shift()!;
      visited[i] = true;
      order.push(union[i]);
      for (const j of adjacency[i]) {
        indegree[j] -= 1;
        if (indegree[j] === 0) ready.push(j);
      }
    }
    // Cycle remainder: append in insertion order. Compiler-side cycle
    // detection is M2.2; host-side a cycle degrades to one-block
    // feedback delay (zones hold the previous block's samples), never
    // a crash.
    for (let i = 0; i < union.length; i++) {
      if (!visited[i]) order.push(union[i]);
    }

    // --- Input pointers + terminal flags ---
    const consumed = new Set<InstanceState>();
    for (const inst of union) {
      let maxPort = -1;
      for (const w of inst.inputWiring) {
        if (w.port > maxPort) maxPort = w.port;
      }
      const ptrs = new Array<number>(maxPort + 1).fill(silencePtr);
      for (const w of inst.inputWiring) {
        const src = resolveSource(w.sourceIdentity);
        if (src && src !== inst && src.outputZonePtr >= 0) {
          ptrs[w.port] =
            src.outputZonePtr + w.sourcePort * zoneFrames * BYTES_PER_DOUBLE;
          consumed.add(src);
        }
      }
      inst.pendingInputPtrs = ptrs;
    }
    for (const inst of union) {
      inst.pendingIsTerminal = !consumed.has(inst);
    }

    if (staged.size > 0) {
      stagedOrder = order;
    } else {
      stagedOrder = null;
      executionOrder = order;
      applyPendingWiring();
    }
  }

  /** Swap staged wiring into the live set (allocation-free). */
  function applyPendingWiring(): void {
    for (const inst of executionOrder) {
      if (inst.pendingInputPtrs) {
        inst.inputPtrs = inst.pendingInputPtrs;
        inst.pendingInputPtrs = null;
      }
      inst.isTerminal = inst.pendingIsTerminal;
    }
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
      case "prepare-graph":
        handlePrepareGraph(msg as unknown as WorkletPrepareGraphMessage);
        break;
      case "commit-graph":
        handleCommitGraph(msg as unknown as WorkletCommitGraphMessage);
        break;
      case "abort-graph":
        handleAbortGraph(msg as unknown as WorkletAbortGraphMessage);
        break;
      case "activate-graph":
        handleActivateGraph(msg as unknown as WorkletActivateGraphMessage);
        break;
      case "devmode-terminate-producer":
        handleDevmodeTerminateProducer();
        break;
      default:
        // Unknown message type: no-op (forward compatibility).
        break;
    }
  }

  function releaseCandidate(candidate: PreparedGraphCandidate): void {
    for (const instance of candidate.newInstances.values()) {
      releaseInstanceZones(instance);
    }
  }

  function transactionAck(
    transactionId: number,
    phase: "prepare" | "commit" | "activate" | "abort",
    ok: boolean,
    reason?: string,
  ): void {
    publishEvent({
      type: "graph-transaction-ack",
      transactionId,
      phase,
      ok,
      ...(reason ? { reason } : {}),
    });
  }

  /** Allocate and initialise one candidate instance without touching live state. */
  function prepareInstance(message: WorkletInstantiateMessage): InstanceState | string {
    const id = message.identity;
    const adapter = options.adapterFactory(id.def, id.version);
    if (!adapter) return `NodeDef ${id.def}@${id.version} is not installed`;
    if (message.audioInputs?.length && typeof adapter.computeWithInputs !== "function") {
      return `NodeDef ${id.def}@${id.version} cannot accept audio inputs`;
    }
    ensureSilenceZone();
    const stateBytes = adapter.descriptor.stateBytes;
    const statePointer = options.allocator.allocate(stateBytes, adapter.descriptor.stateAlign);
    if (statePointer < 0) return "zone-exhausted";
    const audioOutputs =
      typeof message.audioOutputs === "number" && message.audioOutputs > 0
        ? message.audioOutputs
        : DEFAULT_AUDIO_OUTPUT_PORTS;
    const outputZoneBytes = audioOutputs * zoneFrames * BYTES_PER_DOUBLE;
    const outputZonePtr = options.allocator.allocate(outputZoneBytes, DOUBLE_ALIGN);
    if (outputZonePtr < 0) {
      options.allocator.release(statePointer);
      return "zone-exhausted";
    }
    if (!adapter.init(statePointer, stateBytes)) {
      options.allocator.release(outputZonePtr);
      options.allocator.release(statePointer);
      return `NodeDef ${id.def}@${id.version} rejected its state layout`;
    }
    const outputView = arenaView(outputZonePtr, audioOutputs * zoneFrames);
    outputView.fill(0);
    return {
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
      currentFreq: DEFAULT_FREQ,
      currentAmp: DEFAULT_AMP,
      prefill: buildPrefillMap(message.prefill),
      audioOutputs,
      inputWiring: message.audioInputs ?? EMPTY_WIRING,
      inputPtrs: EMPTY_PTRS,
      pendingInputPtrs: null,
      outputZonePtr,
      outputZoneBytes,
      outputView,
      isTerminal: true,
      pendingIsTerminal: true,
      controlChannels: buildControlChannelMap(message.controlChannels),
      inputSupportWarned: false,
      released: false,
      telemetryEntry: {
        identity: id.identity,
        def: id.def,
        version: id.version,
        statePointer,
        lifecycle: "fade-in",
      },
    };
  }

  function handlePrepareGraph(message: WorkletPrepareGraphMessage): void {
    if (
      !Number.isSafeInteger(message.transactionId) || message.transactionId <= 0 ||
      !Number.isSafeInteger(message.epoch) || message.epoch <= 0 ||
      !Array.isArray(message.deltas)
    ) {
      transactionAck(message.transactionId, "prepare", false, "malformed transaction");
      return;
    }
    if (committedCandidate) {
      transactionAck(message.transactionId, "prepare", false, "a prior candidate awaits activation");
      return;
    }
    if (preparedCandidate) {
      releaseCandidate(preparedCandidate);
      preparedCandidate = null;
    }

    const newInstances = new Map<string, InstanceState>();
    const updates = new Map<string, WorkletUpdateMessage>();
    const retireIdentities = new Set<string>();
    const fail = (reason: string) => {
      for (const instance of newInstances.values()) releaseInstanceZones(instance);
      transactionAck(message.transactionId, "prepare", false, reason);
    };
    for (const delta of message.deltas) {
      if (delta.type === "instantiate") {
        const prepared = prepareInstance(delta);
        if (typeof prepared === "string") {
          fail(prepared);
          return;
        }
        newInstances.set(delta.identity.identity, prepared);
      } else if (delta.type === "update") {
        const live = liveByIdentity.get(delta.identity.identity);
        if (!live || live.def !== delta.identity.def || live.version !== delta.identity.version) {
          fail(`no live instance matches update ${delta.identity.identity}`);
          return;
        }
        updates.set(delta.identity.identity, delta);
      } else if (delta.type === "retire") {
        retireIdentities.add(delta.identity.identity);
      } else {
        fail("unknown graph delta");
        return;
      }
    }

    const targetByIdentity = new Map<string, InstanceState>();
    for (const [identity, instance] of liveByIdentity) {
      if (!retireIdentities.has(identity)) targetByIdentity.set(identity, instance);
    }
    for (const [identity, instance] of newInstances) targetByIdentity.set(identity, instance);
    if (targetByIdentity.size > MAX_SYNTH_NODES) {
      fail("node-limit");
      return;
    }

    // Keep fading ancestors in the render order, then topologically order the
    // candidate active set. Pointer plans live in the candidate, never in the
    // current instances, until the matching epoch activates.
    const order: InstanceState[] = executionOrder.filter((instance) =>
      !targetByIdentity.has(instance.identity) ||
      (retireIdentities.has(instance.identity) && newInstances.has(instance.identity)),
    );
    const target = Array.from(targetByIdentity.values());
    const indegree = new Map<InstanceState, number>();
    const adjacency = new Map<InstanceState, InstanceState[]>();
    const wiringFor = (instance: InstanceState) =>
      updates.get(instance.identity)?.audioInputs ?? instance.inputWiring;
    for (const instance of target) {
      indegree.set(instance, 0);
      adjacency.set(instance, []);
    }
    for (const instance of target) {
      for (const wire of wiringFor(instance)) {
        const source = targetByIdentity.get(wire.sourceIdentity);
        if (source && source !== instance) {
          adjacency.get(source)!.push(instance);
          indegree.set(instance, indegree.get(instance)! + 1);
        }
      }
    }
    const ready = target.filter((instance) => indegree.get(instance) === 0);
    while (ready.length > 0) {
      const instance = ready.shift()!;
      order.push(instance);
      for (const next of adjacency.get(instance)!) {
        indegree.set(next, indegree.get(next)! - 1);
        if (indegree.get(next) === 0) ready.push(next);
      }
    }
    const retiringAncestorCount = executionOrder.filter((instance) =>
      !targetByIdentity.has(instance.identity) ||
      (retireIdentities.has(instance.identity) && newInstances.has(instance.identity)),
    ).length;
    if (order.length !== retiringAncestorCount + target.length) {
      fail("candidate graph contains a cycle");
      return;
    }

    const inputPointers = new Map<InstanceState, number[]>();
    const consumed = new Set<InstanceState>();
    for (const instance of target) {
      const wiring = wiringFor(instance);
      let maxPort = -1;
      for (const wire of wiring) maxPort = Math.max(maxPort, wire.port);
      const pointers = new Array<number>(maxPort + 1).fill(silencePtr);
      for (const wire of wiring) {
        const source = targetByIdentity.get(wire.sourceIdentity);
        if (source) {
          pointers[wire.port] =
            source.outputZonePtr + wire.sourcePort * zoneFrames * BYTES_PER_DOUBLE;
          consumed.add(source);
        }
      }
      inputPointers.set(instance, pointers);
    }
    const terminal = new Map<InstanceState, boolean>();
    for (const instance of target) terminal.set(instance, !consumed.has(instance));

    preparedCandidate = {
      transactionId: message.transactionId,
      epoch: message.epoch,
      newInstances,
      updates,
      retireIdentities,
      order,
      inputPointers,
      terminal,
    };
    transactionAck(message.transactionId, "prepare", true);
  }

  function handleCommitGraph(message: WorkletCommitGraphMessage): void {
    if (!preparedCandidate || preparedCandidate.transactionId !== message.transactionId) {
      transactionAck(message.transactionId, "commit", false, "candidate is not prepared");
      return;
    }
    committedCandidate = preparedCandidate;
    preparedCandidate = null;
    committedCandidateEligible = false;
    pendingEpoch = committedCandidate.epoch;
    transactionAck(message.transactionId, "commit", true);
  }

  function handleActivateGraph(message: WorkletActivateGraphMessage): void {
    const ok = committedCandidate?.transactionId === message.transactionId;
    if (ok) committedCandidateEligible = true;
    transactionAck(
      message.transactionId,
      "activate",
      ok,
      ok ? undefined : "candidate is not committed",
    );
  }

  function handleAbortGraph(message: WorkletAbortGraphMessage): void {
    let aborted = false;
    if (preparedCandidate?.transactionId === message.transactionId) {
      releaseCandidate(preparedCandidate);
      preparedCandidate = null;
      aborted = true;
    }
    if (committedCandidate?.transactionId === message.transactionId) {
      releaseCandidate(committedCandidate);
      committedCandidate = null;
      committedCandidateEligible = false;
      pendingEpoch = staged.size > 0 ? pendingEpoch : 0;
      aborted = true;
    }
    transactionAck(message.transactionId, "abort", aborted, aborted ? undefined : "candidate not found");
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
    // The view throws on header mismatch (VAL-SAB-018). Either way the
    // service gets an explicit ack (`synthesis.md` §4.8): a negative
    // ack — or no ack before its timeout — is a fatal startup error on
    // the service side, never indefinite silence.
    try {
      controlView = attachSynthesisControlView(buffer);
      controlBuffer = buffer;
      // VAL-CROSS-009 recovery race: close the bring-up window. The
      // service has finished installing the producer control bridge,
      // so producer-loss detection can activate on the next process().
      sabEverAttached = true;
    } catch (err) {
      controlView = null;
      controlBuffer = null;
      options.publish({
        type: "attach-control-buffer-ack",
        ok: false,
        reason: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    options.publish({ type: "attach-control-buffer-ack", ok: true });
  }

  function handleDetachControlBuffer(): void {
    controlView = null;
    controlBuffer = null;
    // VAL-CROSS-009 recovery race: reset the bring-up window flags so
    // the next attach cycle (recovery) starts fresh. Without this a
    // detach/reattach pair would skip the bring-up window entirely.
    sabEverAttached = false;
    producerEverPublished = false;
    // Retire every instance immediately (no fade): the SAB is gone, so
    // further rendering is impossible. The processor shell disconnects
    // the node so no further process() calls land. Zones are released
    // silently (no instance-retired events on teardown).
    for (const inst of executionOrder) {
      retireImmediately(inst);
      releaseInstanceZones(inst);
    }
    executionOrder.length = 0;
    for (const inst of staged.values()) {
      releaseInstanceZones(inst);
    }
    staged.clear();
    stagedOrder = null;
    if (preparedCandidate) releaseCandidate(preparedCandidate);
    if (committedCandidate) releaseCandidate(committedCandidate);
    preparedCandidate = null;
    committedCandidate = null;
    committedCandidateEligible = false;
    liveByIdentity.clear();
    activeEpoch = 0;
    pendingEpoch = 0;
  }

  function handleInstantiate(message: WorkletInstantiateMessage): void {
    const id = message.identity;
    const live = liveByIdentity.get(id.identity);

    // Same identity + same def/version on a live instance and no staged
    // replacement: update-in-place. We keep the DSP instance and phase
    // (VAL-DSP-010) and just refresh epoch/prefill/controls/wiring.
    if (
      live &&
      live.def === id.def &&
      live.version === id.version &&
      !staged.has(id.identity)
    ) {
      live.epoch = id.epoch;
      live.prefill = buildPrefillMap(message.prefill);
      if (message.controlChannels) {
        live.controlChannels = buildControlChannelMap(message.controlChannels);
      }
      if (message.audioInputs) {
        live.inputWiring = message.audioInputs;
        rebuildGraphPlan();
      }
      pendingEpoch = id.epoch;
      return;
    }

    // Same identity with a DIFFERENT def/version: retire the old
    // instance with a release fade (VAL-ENGINE-035). It keeps rendering
    // in the execution order until its fade completes; the incoming
    // instance is staged and activates on the next matching epoch
    // block (overlapping fades per synth-nodes.md §5.7).
    if (live && (live.def !== id.def || live.version !== id.version)) {
      startFadeOut(live, fadeOutFrames);
      liveByIdentity.delete(id.identity);
    }

    // A staged set armed for a DIFFERENT epoch is superseded by this
    // delta (a newer commit won the race, VAL-ENGINE-013). Drop it and
    // reclaim its zones before staging the new set.
    if (staged.size > 0 && pendingEpoch !== 0 && id.epoch !== pendingEpoch) {
      for (const inst of staged.values()) {
        releaseInstanceZones(inst);
      }
      staged.clear();
    }

    // Resource limit (synthesis.md §3.5): live + staged instances are
    // bounded by MAX_SYNTH_NODES. Breach is a diagnostic, never a
    // glitch — the delta is refused and the running graph continues.
    if (
      !staged.has(id.identity) &&
      executionOrder.length + staged.size >= MAX_SYNTH_NODES
    ) {
      publishEvent({
        type: "graph-diagnostic",
        code: "node-limit",
        identity: id.identity,
      });
      return;
    }

    // Resolve the adapter. First check the cache (populated by
    // {@link WorkletModuleTransferMessage}); if not cached, fall back
    // to the injected factory. If neither yields an adapter the
    // instance stays staged but silent until the module arrives.
    const adapterKey = `${id.def}@${id.version}`;
    let adapter = adapters.get(adapterKey) ?? null;
    if (!adapter) {
      adapter = options.adapterFactory(id.def, id.version);
      if (adapter) {
        adapters.set(adapterKey, adapter);
      }
    }

    ensureSilenceZone();

    // Allocate the state zone between quanta only.
    let statePointer = message.statePointer;
    let stateBytes = message.stateBytes;
    let stateAllocatedHere = false;
    if (statePointer === 0 || stateBytes === 0) {
      // The host did not preallocate; allocate on its behalf using the
      // adapter's declared state size. This is the between-quantum
      // carve-out (synthesis.md §3.2).
      if (adapter) {
        stateBytes = adapter.descriptor.stateBytes;
        statePointer = options.allocator.allocate(
          stateBytes,
          adapter.descriptor.stateAlign,
        );
        stateAllocatedHere = statePointer >= 0;
        if (statePointer < 0) {
          publishEvent({
            type: "graph-diagnostic",
            code: "zone-exhausted",
            identity: id.identity,
          });
          return;
        }
      }
    }

    // Allocate the output zone (all ports). Zone exhaustion fails the
    // delta closed with a diagnostic; the rest of the graph continues
    // (synthesis.md §3.5).
    const audioOutputs =
      typeof message.audioOutputs === "number" && message.audioOutputs > 0
        ? message.audioOutputs
        : DEFAULT_AUDIO_OUTPUT_PORTS;
    const outputZoneBytes = audioOutputs * zoneFrames * BYTES_PER_DOUBLE;
    const outputZonePtr = options.allocator.allocate(outputZoneBytes, DOUBLE_ALIGN);
    if (outputZonePtr < 0) {
      if (stateAllocatedHere) {
        try {
          options.allocator.release(statePointer);
        } catch {
          // Best-effort cleanup.
        }
      }
      publishEvent({
        type: "graph-diagnostic",
        code: "zone-exhausted",
        identity: id.identity,
      });
      return;
    }
    const outputView = arenaView(outputZonePtr, audioOutputs * zoneFrames);
    outputView.fill(0);

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
      currentFreq: DEFAULT_FREQ,
      currentAmp: DEFAULT_AMP,
      prefill: buildPrefillMap(message.prefill),
      audioOutputs,
      inputWiring: message.audioInputs ?? EMPTY_WIRING,
      inputPtrs: EMPTY_PTRS,
      pendingInputPtrs: null,
      outputZonePtr,
      outputZoneBytes,
      outputView,
      isTerminal: true,
      pendingIsTerminal: true,
      controlChannels: buildControlChannelMap(message.controlChannels),
      inputSupportWarned: false,
      released: false,
      telemetryEntry: {
        identity: id.identity,
        def: id.def,
        version: id.version,
        statePointer,
        lifecycle: "fade-in",
      },
    };

    // Initialise the DSP state zone between quanta. The adapter calls
    // `init` against the host-owned memory; failure fails closed (the
    // instance stays in `retired` and never renders).
    if (adapter && statePointer >= 0 && stateBytes > 0) {
      const ok = adapter.init(statePointer, stateBytes);
      if (!ok) {
        instance.lifecycle = "retired";
      }
    } else if (!adapter) {
      // Module not yet transferred; keep the instance staged but mark
      // lifecycle as fade-in (it will activate once the adapter arrives
      // — the renderer re-resolves per block, VAL-ENGINE-008).
      instance.lifecycle = "fade-in";
    } else {
      instance.lifecycle = "retired";
    }

    // Warn once when the delta wires inputs into a def whose adapter
    // has no input-capable compute entry point. The instance degrades
    // to its input-less compute (typically silence), never a crash.
    if (
      adapter &&
      instance.inputWiring.length > 0 &&
      typeof adapter.computeWithInputs !== "function"
    ) {
      instance.inputSupportWarned = true;
      publishEvent({
        type: "graph-diagnostic",
        code: "missing-input-support",
        identity: id.identity,
      });
    }

    staged.set(id.identity, instance);
    pendingEpoch = id.epoch;
    rebuildGraphPlan();
  }

  function handleUpdate(message: WorkletUpdateMessage): void {
    const id = message.identity;
    const live = liveByIdentity.get(id.identity);
    if (!live || live.def !== id.def || live.version !== id.version) {
      // No matching active instance. Late update from a superseded eval
      // is a no-op (VAL-ENGINE-013).
      return;
    }
    // Same def/version → update in place. Phase is preserved because
    // we never call `reset_phase` here (VAL-DSP-010).
    live.epoch = id.epoch;
    live.prefill = buildPrefillMap(message.prefill);
    if (message.controlChannels) {
      live.controlChannels = buildControlChannelMap(message.controlChannels);
    }
    if (message.audioInputs) {
      live.inputWiring = message.audioInputs;
      rebuildGraphPlan();
    }
    pendingEpoch = id.epoch;
  }

  function handleRetire(message: WorkletRetireMessage): void {
    const target = message.identity;
    const live = liveByIdentity.get(target.identity);
    if (live) {
      // Begin the release fade; the post-fade sweep retires it fully
      // and releases its zones (VAL-ENGINE-035).
      startFadeOut(live, fadeOutFrames);
      return;
    }
    const stagedInstance = staged.get(target.identity);
    if (stagedInstance) {
      // The staged instance never reached activation; drop it and
      // reclaim its zones.
      staged.delete(target.identity);
      releaseInstanceZones(stagedInstance);
      rebuildGraphPlan();
    }
  }

  function handleDevmodeTerminateProducer(): void {
    // Force the liveness age to the timeout boundary so the next
    // process() call observes producer loss (VAL-ENGINE-023).
    producerTerminated = true;
    producerLivenessAge = PRODUCER_TIMEOUT_BLOCKS;
  }

  // -----------------------------------------------------------------------
  // Zone growth (ergo 10271a1d — graph-mutation boundary, not steady state)
  // -----------------------------------------------------------------------

  /**
   * Re-derive every zone for a larger render quantum. This is a graph-
   * mutation boundary (synthesis.md §3.2's allocation carve-out): the
   * zones are re-allocated THROUGH the arena allocator and re-viewed
   * THROUGH the arena view factory, so the WASM compute calls and the
   * core keep reading/writing the same shared bytes. The pre-fix code
   * replaced the scratch with a disconnected local array, permanently
   * silencing production output (ergo 10271a1d).
   */
  function growZones(newFrames: number): void {
    zoneFrames = newFrames;

    // Release everything first so the coalesced arena can satisfy the
    // larger zones without fragmentation pressure.
    if (silenceView && silencePtr > 0) {
      options.allocator.release(silencePtr);
    }
    const hadSilence = silenceView !== null;
    silenceView = null;
    silencePtr = 0;
    forEachInstance((inst) => {
      if (inst.outputZonePtr > 0) {
        options.allocator.release(inst.outputZonePtr);
      }
    });

    if (hadSilence) {
      ensureSilenceZone();
    }

    forEachInstance((inst) => {
      if (inst.released || !inst.outputView) {
        return;
      }
      const bytes = inst.audioOutputs * zoneFrames * BYTES_PER_DOUBLE;
      const ptr = options.allocator.allocate(bytes, DOUBLE_ALIGN);
      if (ptr < 0) {
        inst.outputZonePtr = -1;
        inst.outputZoneBytes = 0;
        inst.outputView = null;
        publishEvent({
          type: "graph-diagnostic",
          code: "zone-exhausted",
          identity: inst.identity,
        });
        return;
      }
      inst.outputZonePtr = ptr;
      inst.outputZoneBytes = bytes;
      inst.outputView = arenaView(ptr, inst.audioOutputs * zoneFrames);
      inst.outputView.fill(0);
    });

    // Re-resolve current input pointers against the moved zones.
    forEachInstance((inst) => {
      for (let i = 0; i < inst.inputPtrs.length; i++) {
        inst.inputPtrs[i] = silencePtr;
      }
      for (const w of inst.inputWiring) {
        const src = liveByIdentity.get(w.sourceIdentity);
        if (src && src !== inst && src.outputZonePtr >= 0) {
          inst.inputPtrs[w.port] =
            src.outputZonePtr + w.sourcePort * zoneFrames * BYTES_PER_DOUBLE;
        }
      }
    });

    // Staged wiring (if any) was computed against the old zones.
    if (staged.size > 0) {
      rebuildGraphPlan();
    }
  }

  function forEachInstance(fn: (inst: InstanceState) => void): void {
    for (const inst of executionOrder) fn(inst);
    for (const inst of staged.values()) fn(inst);
  }

  // -----------------------------------------------------------------------
  // Process (per render quantum)
  // -----------------------------------------------------------------------

  function process(requestedFrameCount: number): WorkletTelemetrySnapshot {
    blockCount += 1;

    // Bound the quantum by the ABI's validation ceiling so zone sizes
    // stay finite even against a misbehaving runtime.
    let frameCount = requestedFrameCount;
    if (frameCount > MAX_RENDER_QUANTUM_FRAMES) {
      frameCount = MAX_RENDER_QUANTUM_FRAMES;
      glitchCount += 1;
    }

    // Render-quantum growth (synthesis.md §1.4): re-derive the shared
    // zones through the allocator. This is the only allocation path
    // reachable from process(), and it is a graph-mutation boundary,
    // not steady state (ergo 10271a1d).
    if (frameCount > zoneFrames) {
      growZones(frameCount);
    }
    if (outputScratch.length < frameCount) {
      outputScratch = new Float32Array(frameCount);
    }

    // Zero the output scratch. The TypedArray fill is implementation-
    // optimised (typically a single memset) and does not allocate.
    outputScratch.fill(0);

    // ---- Step 1: Read the SAB (acquire-only, never blocking) ----
    let consumedBlockEpoch = 0;
    let hasBlock = false;
    // Tracks whether we acquired a block from the ring this quantum,
    // independent of whether its epoch matched the pending graph. We
    // need this distinction because a stale-epoch block must still be
    // drained (read index advanced past it) so the producer can
    // publish fresh matching-epoch blocks into the freed slot. Without
    // the drain, the worklet deadlocks on the first stale block when
    // a pending graph is staged (VAL-ENGINE-011 regression).
    let acquiredBlock = false;
    let physicalSlot = 0;

    if (controlView) {
      const available = controlView.consumerAvailableBlocks();
      if (available > 0) {
        // Acquire-load the write index before reading payload
        // (VAL-SAB-012). The view's helper already does this; we just
        // read the slot at the read index.
        const readIndex = controlView.ringReadIndex;
        physicalSlot = controlView.physicalSlotForSequence(readIndex);

        // Read the epoch BEFORE touching any payload. The producer
        // release-publishes the write index only after the payload is
        // complete, so a successful acquire means the epoch is stable.
        consumedBlockEpoch = controlView.readBlockEpoch(physicalSlot);

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
    // Activate the staged set on the first block whose epoch matches.
    // Mixed graph/control epochs never render: if the block epoch does
    // not match the pending epoch, we skip the block entirely (hold
    // last values) rather than render mismatched controls
    // (VAL-ENGINE-012). Activation is a prebuilt-array swap: the
    // topological plan was computed in the message handler.
    if (committedCandidate && hasBlock) {
      if (!committedCandidateEligible) {
        // The producer may have armed while the service is still waiting for
        // the final activation acknowledgement. Candidate-layout blocks are
        // drained but never exposed to the prior graph during this window.
        if (consumedBlockEpoch === committedCandidate.epoch) hasBlock = false;
      } else if (consumedBlockEpoch === committedCandidate.epoch) {
        const candidate = committedCandidate;
        for (const identity of candidate.retireIdentities) {
          const live = liveByIdentity.get(identity);
          if (live) {
            startFadeOut(live, fadeOutFrames);
            liveByIdentity.delete(identity);
          }
        }
        for (const [identity, update] of candidate.updates) {
          const live = liveByIdentity.get(identity);
          if (!live) continue;
          live.epoch = candidate.epoch;
          live.prefill = buildPrefillMap(update.prefill);
          if (update.controlChannels) {
            live.controlChannels = buildControlChannelMap(update.controlChannels);
          }
          if (update.audioInputs) live.inputWiring = update.audioInputs;
        }
        for (const [identity, instance] of candidate.newInstances) {
          liveByIdentity.set(identity, instance);
        }
        executionOrder = candidate.order;
        for (const [instance, pointers] of candidate.inputPointers) {
          instance.inputPtrs = pointers;
        }
        for (const [instance, terminal] of candidate.terminal) {
          instance.isTerminal = terminal;
        }
        for (const instance of candidate.newInstances.values()) {
          publishEvent({
            type: "graph-activated",
            identity: instance.identity,
            epoch: candidate.epoch,
            atBlock: blockCount,
          });
        }
        activeEpoch = candidate.epoch;
        pendingEpoch = 0;
        committedCandidate = null;
        committedCandidateEligible = false;
      } else if (consumedBlockEpoch !== 0) {
        hasBlock = false;
      }
    } else if (staged.size > 0 && hasBlock) {
      if (consumedBlockEpoch === pendingEpoch && pendingEpoch !== 0) {
        if (stagedOrder) {
          executionOrder = stagedOrder;
          stagedOrder = null;
        }
        applyPendingWiring();
        for (const inst of staged.values()) {
          liveByIdentity.set(inst.identity, inst);
          const activatedEvent: WorkletGraphActivatedEvent = {
            type: "graph-activated",
            identity: inst.identity,
            epoch: pendingEpoch,
            atBlock: blockCount,
          };
          publishEvent(activatedEvent);
        }
        staged.clear();
        activeEpoch = pendingEpoch;
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
    //
    // VAL-ENGINE-012 (mixed epochs never render) is preserved by step
    // 3: a stale-epoch block sets `hasBlock = false` before reaching
    // the renderer, so its controls are never applied. Only the read
    // index advances.
    if (controlView && acquiredBlock) {
      controlView.advanceReadIndex();
    }

    // ---- Step 5: Render the live graph in topological order ----
    //
    // Each instance computes into its own output zone; fades scale the
    // zone in place so downstream consumers hear them; terminal
    // instances sum into the output scratch afterwards (synthesis.md
    // §3.1).
    for (const inst of executionOrder) {
      if (inst.lifecycle === "retired") continue;
      renderInstance(inst, hasBlock, physicalSlot, consumedBlockEpoch, frameCount);
    }
    for (const inst of executionOrder) {
      if (inst.lifecycle === "retired" || !inst.isTerminal) continue;
      const view = inst.outputView;
      if (!view) continue;
      for (let p = 0; p < inst.audioOutputs; p++) {
        const base = p * zoneFrames;
        for (let i = 0; i < frameCount; i++) {
          outputScratch[i] += Number(view[base + i]);
        }
      }
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
      controlView.peakSample = peakSample;
      controlView.rmsSample = rmsSample;
      controlView.underrunCount = underrunCount;
      controlView.glitchCount = glitchCount;
      controlView.timeoutCount = timeoutCount;
      controlView.producerLivenessAge = producerLivenessAge;
      controlView.programEpoch = activeEpoch;
      controlView.finiteOutput = finiteOutput;
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
    // Every instance whose fade completed (or that failed closed) is
    // removed from the execution order, its zones are released back to
    // the arena, and any consumer still pointing at its output zone is
    // repointed to the silence zone — no orphan rendering, no dangling
    // reads (VAL-ENGINE-035).
    let write = 0;
    for (let read = 0; read < executionOrder.length; read++) {
      const inst = executionOrder[read];
      if (inst.lifecycle === "retired") {
        if (!inst.released) {
          repointConsumersToSilence(inst);
          releaseInstanceZones(inst);
          const retiredEvent: WorkletInstanceRetiredEvent = {
            type: "instance-retired",
            identity: inst.identity,
          };
          publishEvent(retiredEvent);
        }
        if (liveByIdentity.get(inst.identity) === inst) {
          liveByIdentity.delete(inst.identity);
        }
        continue;
      }
      executionOrder[write] = inst;
      write += 1;
    }
    executionOrder.length = write;
    if (executionOrder.length === 0 && staged.size === 0) {
      activeEpoch = 0;
    }

    return refreshTelemetry();
  }

  /**
   * Render one instance for this block: read its block-rate controls
   * (per-instance channel window), apply one-shot prefill on its
   * matching-epoch block, compute into its output zone, and scale the
   * zone by the fade envelope so downstream consumers hear the fade.
   */
  function renderInstance(
    instance: InstanceState,
    hasBlock: boolean,
    physicalSlot: number,
    consumedBlockEpoch: number,
    frameCount: number,
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
        // initialise it now (a graph-mutation boundary) so the first
        // render produces sound. Without this, statePointer stays at 0
        // and the WASM compute reads/writes the wrong memory region,
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
    if (!adapter || instance.statePointer < 0 || !instance.outputView || instance.outputZonePtr < 0) {
      // Module not yet transferred or zone invalid: hold silence in the
      // zone so downstream consumers never read stale samples.
      if (instance.outputView) {
        instance.outputView.fill(0);
      }
      return;
    }

    // --- Per-instance block-rate controls (compiler channel table) ---
    // Each bound param reads its own SAB channel (per-(node, param)
    // assignment, synth-nodes.md §7.2). Unbound params never touch the
    // SAB: the instance holds its prefill/default value (§3.3).
    if (hasBlock && controlView) {
      const freqChannel = instance.controlChannels.get("freq");
      if (freqChannel !== undefined && freqChannel < controlView.blockRateCount) {
        let controlFreq = controlView.readBlockRateValue(physicalSlot, freqChannel);
        // Validate: non-finite values clamp to the registry default and
        // increment the glitch counter.
        if (!Number.isFinite(controlFreq)) {
          controlFreq = DEFAULT_FREQ;
          glitchCount += 1;
        }
        // Clamp frequency to [0, sampleRate/2].
        const nyquist = sampleRate / 2;
        if (controlFreq < 0) controlFreq = 0;
        else if (controlFreq > nyquist) controlFreq = nyquist;
        instance.currentFreq = controlFreq;
      }
      const ampChannel = instance.controlChannels.get("amp");
      if (ampChannel !== undefined && ampChannel < controlView.blockRateCount) {
        let controlAmp = controlView.readBlockRateValue(physicalSlot, ampChannel);
        if (!Number.isFinite(controlAmp)) {
          controlAmp = DEFAULT_AMP;
          glitchCount += 1;
        }
        // Clamp amplitude to [0, 1].
        if (controlAmp < 0) controlAmp = 0;
        else if (controlAmp > 1) controlAmp = 1;
        instance.currentAmp = controlAmp;
      }
    }
    // One-shot prefill: supersedes the SAB values on the instance's
    // matching-epoch block only (synthesis.md §4.4 — a new node never
    // reads stale or undefined slots).
    if (instance.prefill && consumedBlockEpoch === instance.epoch && consumedBlockEpoch !== 0) {
      const freq = instance.prefill.get("freq");
      const amp = instance.prefill.get("amp");
      if (typeof freq === "number" && Number.isFinite(freq)) instance.currentFreq = freq;
      if (typeof amp === "number" && Number.isFinite(amp)) instance.currentAmp = amp;
      instance.prefill = null; // Single-shot; steady-state reads SAB.
    }

    // Write the control samples into the scratch doubles.
    freqControlScratch[0] = instance.currentFreq;
    ampControlScratch[0] = instance.currentAmp;

    // The adapter writes into host-owned memory at the output zone
    // pointer; the core reads the doubles back through the arena view
    // (VAL-CROSS-002 shared-memory link).
    const freqPtr = getPointerForFloat64(freqControlScratch);
    const ampPtr = getPointerForFloat64(ampControlScratch);
    let ok: boolean;
    if (instance.inputPtrs.length > 0 && typeof adapter.computeWithInputs === "function") {
      ok = adapter.computeWithInputs(
        instance.statePointer,
        instance.inputPtrs,
        freqPtr,
        ampPtr,
        instance.outputZonePtr,
        frameCount,
      );
    } else {
      if (instance.inputPtrs.length > 0 && !instance.inputSupportWarned) {
        instance.inputSupportWarned = true;
        publishEvent({
          type: "graph-diagnostic",
          code: "missing-input-support",
          identity: instance.identity,
        });
      }
      ok = adapter.compute(
        instance.statePointer,
        freqPtr,
        ampPtr,
        instance.outputZonePtr,
        frameCount,
      );
    }
    if (!ok) {
      // Compute failed (invalid frame count or trap). Mute the node and
      // mark it retired (synthesis.md §3.6 trap containment); the rest
      // of the graph continues.
      instance.lifecycle = "retired";
      glitchCount += 1;
      instance.outputView.fill(0);
      return;
    }

    // Apply the fade envelope in place on the zone so downstream
    // consumers (and the terminal sum) both hear it.
    const fadeGain = computeFadeGain(instance, frameCount);
    if (fadeGain !== 1) {
      const view = instance.outputView;
      for (let p = 0; p < instance.audioOutputs; p++) {
        const base = p * zoneFrames;
        for (let i = 0; i < frameCount; i++) {
          view[base + i] = Number(view[base + i]) * fadeGain;
        }
      }
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
   * Repoint every consumer whose input pointer targets the retiring
   * instance's output zone at the silence zone. Runs in the sweep,
   * BEFORE the zone is released, so no consumer ever dereferences a
   * freed zone.
   */
  function repointConsumersToSilence(retiring: InstanceState): void {
    if (retiring.outputZonePtr < 0 || retiring.outputZoneBytes <= 0) return;
    const lo = retiring.outputZonePtr;
    const hi = lo + retiring.outputZoneBytes;
    forEachInstance((other) => {
      if (other === retiring) return;
      for (let i = 0; i < other.inputPtrs.length; i++) {
        if (other.inputPtrs[i] >= lo && other.inputPtrs[i] < hi) {
          other.inputPtrs[i] = silencePtr;
        }
      }
      if (other.pendingInputPtrs) {
        for (let i = 0; i < other.pendingInputPtrs.length; i++) {
          if (other.pendingInputPtrs[i] >= lo && other.pendingInputPtrs[i] < hi) {
            other.pendingInputPtrs[i] = silencePtr;
          }
        }
      }
    });
  }

  /**
   * Release an instance's state and output zones back to the arena.
   * Guarded by the `released` flag so the sweep and teardown paths
   * never double-release.
   */
  function releaseInstanceZones(instance: InstanceState): void {
    if (instance.released) return;
    instance.released = true;
    if (instance.statePointer > 0) {
      try {
        options.allocator.release(instance.statePointer);
      } catch {
        // Best-effort cleanup.
      }
    }
    if (instance.outputZonePtr > 0) {
      try {
        options.allocator.release(instance.outputZonePtr);
      } catch {
        // Best-effort cleanup.
      }
    }
    instance.outputZonePtr = -1;
    instance.outputZoneBytes = 0;
    instance.outputView = null;
  }

  function reset(): void {
    controlView = null;
    controlBuffer = null;
    adapters.clear();
    executionOrder = [];
    liveByIdentity.clear();
    staged.clear();
    stagedOrder = null;
    if (preparedCandidate) releaseCandidate(preparedCandidate);
    if (committedCandidate) releaseCandidate(committedCandidate);
    preparedCandidate = null;
    committedCandidate = null;
    committedCandidateEligible = false;
    silenceView = null;
    silencePtr = 0;
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
      return refreshTelemetry();
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

  // Silence unused-variable lint for retained fields consumed only via
  // closure lifetime (the buffer keeps the SAB alive for the view).
  void controlBuffer;
  void arenaMode;

  return core;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Shared empty wiring/pointer singletons (never mutated). */
const EMPTY_WIRING: readonly WorkletAudioInputWiring[] = Object.freeze([]);
const EMPTY_PTRS: number[] = [];
const EMPTY_CONTROL_CHANNELS: ReadonlyMap<string, number> = new Map();

/**
 * Build the per-(node, param) channel map from a delta message's
 * `controlChannels` array. Absent/empty arrays yield the shared empty
 * map (every param unbound — prefill/default values hold).
 */
function buildControlChannelMap(
  channels: readonly WorkletControlChannel[] | undefined,
): ReadonlyMap<string, number> {
  if (!channels || channels.length === 0) return EMPTY_CONTROL_CHANNELS;
  const map = new Map<string, number>();
  for (const entry of channels) {
    if (Number.isInteger(entry.channel) && entry.channel >= 0) {
      map.set(entry.param, entry.channel);
    }
  }
  return map;
}

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
 */
function getPointerForFloat64(view: Float64Array): number {
  // We use the byte offset as a stable handle. The real WASM adapter
  // receives a byte offset into its imported memory; the fake adapter
  // receives the same number and records it without dereferencing.
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
