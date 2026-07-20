/**
 * Synthesis engine service — main-thread lifecycle and coordination.
 *
 * Fulfils (partial — see mission features
 * `m1-synthesis-service-and-devmode-contract` and
 * `m1-autoplay-indicator-and-console`):
 *   VAL-HOST-011 — capability and engine telemetry snapshots are immutable
 *                  and read-only in devmode, absent or inert outside.
 *   VAL-HOST-012 — controlled producer termination and engine
 *                  reinitialisation are explicit devmode-only actions.
 *   VAL-DSP-006  — host adapter is source-agnostic (delegated to
 *                  `src/audio/nodeDefAdapter.ts`).
 *   VAL-ENGINE-007 — exactly one AudioWorkletNode hosts the graph.
 *   VAL-ENGINE-008 — NodeDef modules are compiled/validated before
 *                    transfer to the worklet.
 *   VAL-ENGINE-016 — lifecycle transitions are finite and exact (the
 *                    matrix lives in `synthesisChannels.ts`).
 *   VAL-ENGINE-020 — there is no permanent Enable Sound command. The
 *                    suspended indicator uses `resumeOnUserActivation()`;
 *                    the error indicator uses the explicit recovery seam.
 *   VAL-ENGINE-021 — indicator and engine state flow through props via
 *                    the typed channel/store, not singletons.
 *   VAL-ENGINE-022 — suspended and error transitions post one clear
 *                    non-flooding console message through the injected
 *                    sink (deduplicated on consecutive identical pairs).
 *   VAL-ENGINE-036 — no main-thread executor or editor-to-worklet control
 *                    path is introduced.
 *
 * Architecture notes:
 *
 * - The service is the SINGLE main-thread owner of: the AudioContext, the
 *   worklet node, NodeDef module compilation, the source-agnostic adapter,
 *   the engine state machine, and the devmode telemetry surface. There is
 *   no parallel main-thread executor and no editor-to-worklet shortcut
 *   (VAL-ENGINE-036).
 *
 * - All side-effecting dependencies are injected. `AudioContextContract`,
 *   `WorkletNodeContract`, `NodeDefModuleLoader`, and `ConsoleMessageSink`
 *   are tiny interfaces the service consumes; the real implementations
 *   live in `synthesisServiceBrowser.ts` (wired by bootstrap). Tests pass
 *   fakes. The console sink bridges to `utils/consoleStore.ts` so the
 *   audio layer never imports the UI utility directly.
 *
 * - The service is created exactly once per engine session. On
 *   reinitialisation (after producer loss), the old service is disposed
 *   and a fresh one is constructed so failed resources can never resurface.
 *
 * - Audio capability is orthogonal to runtime mode (synthesis.md §6.1):
 *   when the bootstrap capability snapshot reports `audioCapable === false`,
 *   the service never constructs an AudioContext and stays in `off`.
 *
 * - Production builds do not expose the devmode fault actions. Bootstrap
 *   wiring consults `startupFlags.devmode`; only then does the service
 *   install `__useqSynthesisDev` (VAL-HOST-011/012).
 */

import {
  ENGINE_STATE_REASONS,
  type EngineStateReasonKey,
  type EngineStateSnapshot,
  type EngineTransitionTrigger,
  engineTransitionTrigger,
  isAllowedEngineTransition,
  publishEngineState,
  engineLifecycle,
  type SynthesisEngineState,
} from "../contracts/synthesisChannels";
import type {
  AudioCapabilitySnapshot,
} from "../contracts/audioCapabilities";
import {
  SYNTH_ARTIFACT_ABI_VERSION,
  isSynthArtifactsPayload,
  synthArtifactsSupportsAbi,
  type SynthArtifactsPayload,
} from "../contracts/runtimeTypes";
import type { NodeDefDescriptor } from "../contracts/nodeDefRegistry";
import {
  findNodeDefDescriptor,
} from "../contracts/nodeDefRegistry";
import type { NodeDefAdapter, NodeDefModule } from "./nodeDefAdapter";
import {
  ABI_VERSION as SYNTH_CONTROL_ABI_VERSION,
  ATTACH_CONTROL_BUFFER_ACK_TIMEOUT_MS,
  CONTROL_LOOKAHEAD_BLOCKS,
  DEFAULT_RENDER_QUANTUM_FRAMES,
  MAX_SYNTH_NODES,
  PRODUCER_FIRST_PUBLISH_DEADLINE_MS,
  attachSynthesisControlView,
  createSynthesisControlBuffer,
  type SynthesisControlView,
} from "../contracts/synthesisControlAbi";
import type {
  WorkletControlAttachAckEvent,
  WorkletModuleTransferMessage,
  WorkletProducerTimeoutEvent,
  WorkletTelemetrySnapshot,
} from "./workletGraphDelta";
import {
  buildEngineCommitPlan,
  createEpochAllocator,
  type ActiveDeclaration,
  type EngineCommitPlan,
  type EpochAllocator,
} from "./engineCommitCoordinator";

// ---------------------------------------------------------------------------
// Injected dependencies
// ---------------------------------------------------------------------------

/**
 * Contract for the AudioContext the service owns.
 *
 * The real implementation (browser) is `AudioContext`. Tests pass a fake.
 * The service NEVER constructs the AudioContext itself — it receives an
 * already-constructed one so the host page can manage lifetime across
 * full-page reloads. The capability snapshot decides whether one is
 * constructed at all.
 *
 * The `state` field includes `"interrupted"` (a Safari-specific state
 * the spec lists under AudioContextState). The synthesis service only
 * distinguishes `"running"` from anything else for the
 * running/suspended decision, so the extra state is harmless here.
 */
export interface AudioContextContract {
  readonly state: "suspended" | "running" | "closed" | "interrupted";
  readonly sampleRate: number;
  readonly currentTime: number;
  /** AudioContext.resume() — requires transient user activation in browsers. */
  resume(): Promise<void>;
  /** AudioContext.suspend() — used for the running→suspended transition. */
  suspend(): Promise<void>;
  /** AudioContext.close() — used when disposing the engine session. */
  close(): Promise<void>;
  /** Add the AudioWorklet module. The service uses this exactly once per session. */
  readonly audioWorklet?: {
    addModule(url: string): Promise<void>;
  };
  /** Connect a destination node. Used by the worklet bridge implementation. */
  readonly destination: unknown;
}

/**
 * Contract for a graph-hosting AudioWorkletNode.
 *
 * The real node is an `AudioWorkletNode`; tests pass a fake. The service
 * enforces that EXACTLY ONE is constructed per session (VAL-ENGINE-007):
 * {@link SynthesisServiceOptions.workletNodeFactory} is called at most once,
 * and the resulting node is reused for every graph delta.
 */
export interface WorkletNodeContract {
  /** Number of input channels declared on the node (typically 0 for M1). */
  readonly numberOfInputs: number;
  /** Number of output channels declared on the node (1 for osc/sine). */
  readonly numberOfOutputs: number;
  /**
   * Send a message to the worklet. The service uses this for graph deltas,
   * module transfer, and epoch arming. The worklet applies graph changes
   * only at block boundaries (between render quanta).
   */
  port: {
    postMessage(message: unknown, transfer?: Transferable[]): void;
    onmessage: ((event: { data: unknown }) => void) | null;
    close?(): void;
  };
  /** Connect the node to a destination node. */
  connect(destination: unknown): unknown;
  /** Disconnect the node from its destination(s). */
  disconnect(): void;
}

/**
 * Factory for the worklet node. The service calls this AT MOST ONCE per
 * session (VAL-ENGINE-007). Calling it again requires a full dispose +
 * re-init cycle (the recovery path).
 */
export type WorkletNodeFactory = (context: AudioContextContract) => WorkletNodeContract;

/**
 * Loader that compiles a NodeDef module OFF the audio thread and returns
 * the adapter the host will use to drive the def.
 *
 * The synthesis service owns the lifecycle: it calls the loader exactly
 * once per registered def, on the main thread (or in a Worker pool), and
 * hands the resulting module to the worklet via postMessage with a
 * transferred `WebAssembly.Module`. The worklet reuses the supplied
 * module without re-compiling (VAL-ENGINE-008).
 *
 * In tests this loader is replaced by a fake that returns a
 * {@link NodeDefModule} built from a {@link FakeNodeDefModule}.
 */
/**
 * Loader that compiles a NodeDef module OFF the audio thread and returns
 * the adapter the host will use to drive the def.
 *
 * The synthesis service owns the lifecycle: it calls the loader exactly
 * once per registered def, on the main thread (or in a Worker pool), and
 * hands the resulting module to the worklet via postMessage with a
 * transferred `WebAssembly.Module`. The worklet reuses the supplied
 * module without re-compiling (VAL-ENGINE-008).
 *
 * VAL-ENGINE-008 contract: the loader returns
 *   - `module`: the host adapter shape (always present);
 *   - `compiledWasm`: the real compiled `WebAssembly.Module` when the
 *     host compiled one. Null when the loader intentionally omitted
 *     compilation (e.g. a fake-loader test path, or when the host
 *     wants to exercise the byte-fallback path);
 *   - `wasmBytes`: the EXACT prevalidated bytes the loader compiled
 *     from. Always present when the loader actually fetched bytes;
 *     optional for legacy fake loaders.
 *
 * The synthesis service prefers the structured-cloned module path
 * (`compiledWasm`) and falls back to shipping the exact bytes
 * (`wasmBytes`) only when no compiled module is available.
 */
export type NodeDefModuleLoader = (descriptor: NodeDefDescriptor) =>
  Promise<{
    module: NodeDefModule;
    compiledWasm: WebAssembly.Module | null;
    /**
     * EXACT prevalidated bytes the loader compiled from. The host
     * ships these as the AudioWorklet MessagePort compatibility
     * fallback when no compiled module is available. The worklet
     * recompiles them ONCE in its message handler before graph
     * activation (VAL-ENGINE-008).
     */
    wasmBytes?: Uint8Array;
  }>;

// ---------------------------------------------------------------------------
// Worker producer port (for revision arming, VAL-ENGINE-010)
// ---------------------------------------------------------------------------

/**
 * Minimal subset of the WASM runtime worker port the synthesis service
 * consumes to arm the producer's program epoch after a successful
 * eval commit. The full {@link WasmRuntimePort} (see
 * `src/contracts/runtimePorts.ts`) satisfies this contract; tests pass
 * a fake.
 *
 * Only {@link producerArmEpoch} is required. The service never starts
 * or stops the producer through this seam — bootstrap wiring owns
 * producer lifecycle so the synthesis service stays focused on engine
 * state, graph lifecycle, and the eval-to-epoch commit.
 */
export interface SynthesisWorkerPort {
  /**
   * Arm the producer's program epoch. After this call the producer
   * tags every subsequently-published control block with the supplied
   * epoch (VAL-SAB-015). The worklet activates the pending graph delta
   * on the first matching-epoch block (VAL-ENGINE-011).
   */
  producerArmEpoch(epoch: number): Promise<number>;
  /**
   * Install the SharedArrayBuffer that carries the synthesis control
   * ring. The Worker attaches a typed view and stores it for the
   * producer loop. Returns `true` when the buffer passed ABI
   * validation.
   *
   * Integration bridge (VAL-CROSS-002/003): the synthesis service
   * allocates one SAB per engine session, installs it on the Worker
   * producer, and ships the same buffer to the worklet via
   * `attach-control-buffer`. Both sides then read/write the same
   * ring; the producer publishes blocks paced by the worklet's frame
   * counter.
   */
  producerInstallSab?(
    controlBuffer: SharedArrayBuffer,
    options: {
      blockRateChannels: readonly string[];
      lookaheadBlocks?: number;
      renderQuantumFrames?: number;
    },
  ): Promise<boolean>;
  /**
   * Set the current synth control values. The producer publishes these
   * on every block so the worklet receives consistent controls.
   * Called whenever the synth graph changes (VAL-CROSS-002).
   */
  producerSetControlValues?(values: Record<string, number>): Promise<boolean>;
  /**
   * Start the producer loop. The producer publishes enough blocks to
   * refill the ring up to the configured lookahead, paced by the
   * worklet's audio-frame publication. Returns `true` when the
   * producer transitioned from stopped to running.
   */
  producerStart?(options: {
    anchorFrame?: bigint;
    anchorTime?: number;
    sampleRate: number;
  }): Promise<boolean>;
  /**
   * Stop the producer loop. Returns `true` when the producer was
   * running. Used by dispose() and the recovery path so a stale
   * producer cannot keep publishing to a retired SAB.
   */
  producerStop?(): Promise<boolean>;
  /**
   * Devmode-only: terminate the producer from inside the Worker so
   * the ring stops receiving fresh publications. Used by
   * `devmodeTerminateProducer()` (VAL-HOST-012) so the simulated
   * fault actually reproduces producer loss at the worklet boundary.
   * Without this, the Worker keeps publishing blocks and the
   * worklet's `producerTerminated` flag is reset by every fresh
   * block — exactly the noisy pattern that prevented the post-
   * recovery audio-output regression (Ergo bug c7edc263) from being
   * observed in real headless Chromium.
   */
  producerTerminate?(): Promise<boolean>;
  /**
   * Clear the WASM compiler's synth declarations so the next synth
   * eval after recovery is not rejected as an over-capacity second
   * declaration. The WASM engine persists across service recovery
   * (the Worker is not recreated), so without this clear the stale
   * synth declaration would trigger the M1 single-node capacity
   * diagnostic on the first post-recovery eval, causing the commit
   * pipeline to reject the response as a failed eval
   * (VAL-CROSS-009 post-recovery eval-pipeline fix).
   */
  clearSynthDeclarations?(): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Console message sink (VAL-ENGINE-022)
// ---------------------------------------------------------------------------

/**
 * Sink the service calls when a state transition should surface a
 * console message (synthesis.md §6.4). The browser wiring bridges this
 * to `utils/consoleStore.ts`; tests pass a recorder.
 *
 * The sink receives a plain string and a severity hint. The service
 * deduplicates: consecutive calls with the same `(message, type)` pair
 * are suppressed, so repeated suspended self-loops or recovery-failed
 * self-loops do NOT flood the console (VAL-ENGINE-022:
 * "non-flooding").
 */
export type ConsoleMessageSink = (message: string, type: "log" | "warn" | "error") => void;

// ---------------------------------------------------------------------------
// Engine session options
// ---------------------------------------------------------------------------

/**
 * Options passed to {@link createSynthesisService}.
 *
 * All browser-global dependencies are injected; the service never touches
 * `window` or `globalThis` directly. Bootstrap wiring constructs the
 * concrete dependencies.
 */
export interface SynthesisServiceOptions {
  /** Immutable audio-capability snapshot captured during bootstrap. */
  readonly capabilities: AudioCapabilitySnapshot;
  /**
   * Factory that constructs the AudioContext when audio is capable. The
   * service calls this lazily on the first transition out of `off`.
   */
  readonly audioContextFactory: () => AudioContextContract;
  /**
   * URL of the synthesis AudioWorklet processor script. The service adds
   * the module exactly once per session via `audioWorklet.addModule`.
   */
  readonly workletScriptUrl: string;
  /**
   * Factory that constructs the SINGLE AudioWorkletNode. Called at most
   * once per session (VAL-ENGINE-007).
   */
  readonly workletNodeFactory: WorkletNodeFactory;
  /**
   * Loader that compiles NodeDef WASM modules off the audio thread. The
   * service hands the compiled module to the worklet via `postMessage`
   * with transfer, so the worklet reuses the module without recompiling.
   */
  readonly nodeDefModuleLoader: NodeDefModuleLoader;
  /**
   * Descriptors the host should load on engine bring-up. Defaults to the
   * static M1 registry; future features will add more defs.
   */
  readonly nodeDefDescriptors?: readonly NodeDefDescriptor[];
  /**
   * Wall-clock function, used for transition timestamps and telemetry.
   * Defaults to `Date.now`. Tests inject a controllable clock.
   */
  readonly now?: () => number;
  /**
   * True when devmode is active. Only devmode installs the read-only
   * telemetry global and exposes the fault actions (VAL-HOST-011/012).
   * Production builds pass `false` (or omit — defaults to `false`).
   */
  readonly devmode?: boolean;
  /**
   * Telemetry global installer. The browser wiring passes a function that
   * assigns `window.__useqSynthesisDev`; tests pass a recorder. The
   * service calls it only when {@link SynthesisServiceOptions.devmode}
   * is `true`, and only with frozen (immutable) snapshots.
   */
  readonly installTelemetryGlobal?: (snapshot: SynthesisTelemetrySnapshot) => void;
  /**
   * Console message sink called on suspended/error transitions. The
   * browser wiring passes a function that bridges to
   * `utils/consoleStore.ts`. The service deduplicates consecutive
   * identical messages so state self-loops do not flood the console
   * (VAL-ENGINE-022). Optional: when omitted, no console messages are
   * emitted (useful for unit tests that do not assert on console
   * output).
   */
  readonly consoleMessageSink?: ConsoleMessageSink;
  /**
   * Worker producer port used to arm the program epoch after a
   * successful eval commit (VAL-ENGINE-010). Optional: when omitted,
   * the service still computes the graph diff and posts worklet
   * messages, but the producer does not tag blocks with the new epoch.
   * Tests use the omission to verify the diff/prefill path in
   * isolation; production wiring always supplies the live port.
   */
  readonly workerPort?: SynthesisWorkerPort;
}

// ---------------------------------------------------------------------------
// Telemetry (VAL-HOST-011, VAL-ENGINE-029 subset)
// ---------------------------------------------------------------------------

/**
 * Read-only synthesis telemetry snapshot installed on `window.__useqSynthesisDev`
 * in devmode. Frozen at every publication so consumers cannot mutate it.
 *
 * Production builds never install this global. Outside devmode the
 * surface is inert.
 *
 * VAL-ENGINE-029: the snapshot exposes the complete objective contract
 * — capabilities, engine/AudioContext state, audio frame, ABI version,
 * ring read/write sequences and fill depth, program revision, pending
 * and active program epochs, current DSP instance id, producer liveness,
 * peak/RMS, finite-output status, and the underrun/glitch/timeout
 * counters. The worklet-side fields arrive through the worklet → service
 * telemetry bridge (see `handleWorkletEvent`); they are 0 / empty until
 * the worklet has published its first snapshot.
 */
export interface SynthesisTelemetrySnapshot {
  /** Schema version of the telemetry shape (bumped when fields change). */
  readonly schemaVersion: number;
  /** Immutable audio-capability snapshot captured during bootstrap. */
  readonly capabilities: AudioCapabilitySnapshot;
  /** Current four-state engine state. */
  readonly engineState: SynthesisEngineState;
  /** AudioContext state mirror, or `null` when no context has been created. */
  readonly audioContextState: "suspended" | "running" | "closed" | "interrupted" | null;
  /** Current AudioContext sample rate, or `null` when no context exists. */
  readonly sampleRate: number | null;
  /**
   * Number of worklet nodes currently held by this service. Always 0 or
   * 1. VAL-ENGINE-007 / VAL-ENGINE-027: recovery disposes the failed
   * node before constructing a fresh one so the count never accumulates
   * across repeated recovery within a single service instance.
   */
  readonly workletNodeCount: number;
  /** Number of NodeDef modules the service has compiled and transferred. */
  readonly compiledModuleCount: number;
  /** Names of NodeDef modules that have been compiled. */
  readonly compiledModuleNames: readonly string[];
  /**
   * SAB ABI version the engine was built against. Always non-null once
   * the engine has been brought up; the contract module is the single
   * source of truth (VAL-SAB-001).
   */
  readonly sabAbiVersion: number | null;
  /** Number of times the engine has transitioned state. */
  readonly transitionCount: number;
  /** True when the devmode fault actions (termination / reinitialise) are exposed. */
  readonly faultActionsExposed: boolean;

  // ---- Worklet-side objective telemetry (VAL-ENGINE-029) ----

  /**
   * Latest audio frame counter reported by the worklet (monotonic).
   * Stays at 0n until the worklet publishes its first snapshot.
   */
  readonly audioFrame: bigint;
  /** Latest ring write sequence observed by the worklet. */
  readonly ringWriteSequence: number;
  /** Latest ring read sequence observed by the worklet. */
  readonly ringReadSequence: number;
  /** Latest ring fill depth (write - read, bounded by ring capacity). */
  readonly ringFillDepth: number;
  /** Latest program (compiler) revision armed on the engine. */
  readonly programRevision: number;
  /** Latest active program epoch (the epoch of the running graph). */
  readonly activeEpoch: number;
  /** Latest pending program epoch (the epoch awaiting first activation). */
  readonly pendingEpoch: number;
  /**
   * Stable identity of the currently-active DSP instance, or the empty
   * string when no instance is active. Comes from the editor sidecar.
   */
  readonly instanceId: string;
  /** Latest output peak (absolute) reported by the worklet. */
  readonly peakSample: number;
  /** Latest output RMS reported by the worklet. */
  readonly rmsSample: number;
  /** 1 while every output sample is finite, 0 after a NaN/Inf trap. */
  readonly finiteOutput: number;
  /** Monotonic underrun counter (VAL-ENGINE-033). */
  readonly underrunCount: number;
  /** Monotonic glitch counter (deadline misses). */
  readonly glitchCount: number;
  /** Monotonic producer-timeout counter (VAL-ENGINE-024/026). */
  readonly timeoutCount: number;
  /** Current producer-liveness age in blocks. */
  readonly producerLivenessAge: number;
  /** True while the worklet has detected producer loss and is fading out. */
  readonly producerTimeoutActive: boolean;
}

/** Telemetry schema version. Bumped only when the field shape changes. */
export const SYNTHESIS_TELEMETRY_SCHEMA_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Engine commit result (VAL-ENGINE-010/013/014/015)
// ---------------------------------------------------------------------------

/**
 * Outcome categories for {@link SynthesisService.commitSynthArtifacts}.
 *
 * The union is exhaustive so callers (the eval pipeline, tests) can
 * distinguish a real commit from every documented no-op path.
 */
export type EngineCommitOutcome =
  | "committed"
  | "rejected-failed-eval"
  | "rejected-superseded"
  | "rejected-invalid-payload";

/**
 * Result of {@link SynthesisService.commitSynthArtifacts}.
 *
 * `outcome` is always present; the remaining fields are meaningful only
 * when `outcome === "committed"`. The shape is structural-cloneable so
 * devmode dashboards can post it across workers if needed.
 */
export interface EngineCommitResult {
  /** The outcome category. */
  readonly outcome: EngineCommitOutcome;
  /**
   * The committed program epoch, or zero when the call was a no-op.
   * The worklet activates the pending graph on the first block
   * carrying this epoch (VAL-ENGINE-011).
   */
  readonly epoch: number;
  /**
   * The committed compiler revision, or zero when the call was a
   * no-op. Equals `payload.revision` on a real commit.
   */
  readonly revision: number;
  /**
   * The worklet delta messages the service posted. Empty when the
   * call was a no-op. Order is retire → instantiate → update
   * (VAL-ENGINE-010).
   */
  readonly workletDeltas: readonly EngineCommitPlan["workletDeltas"][number][];
}

/**
 * Canonical invalid-payload commit result, frozen and returned by
 * reference so callers can reference-compare without unpacking the
 * union. Other rejection outcomes (failed eval, superseded revision)
 * carry per-commit epoch/revision data and are constructed per call.
 */
const NOOP_COMMIT_RESULT = Object.freeze({
  outcome: "rejected-invalid-payload",
  epoch: 0,
  revision: 0,
  workletDeltas: Object.freeze([]),
}) satisfies EngineCommitResult;

/**
 * Internal mutable telemetry accumulator. The service writes to this
 * object and publishes frozen snapshots via {@link snapshotTelemetry}.
 */
interface TelemetryAccumulator {
  workletNodeCount: number;
  compiledModuleCount: number;
  compiledModuleNames: string[];
  sabAbiVersion: number | null;
  transitionCount: number;
  audioContextState: "suspended" | "running" | "closed" | "interrupted" | null;
  sampleRate: number | null;
  // Worklet-side telemetry (VAL-ENGINE-029). Updated by the worklet →
  // service telemetry bridge (handleWorkletEvent).
  audioFrame: bigint;
  ringWriteSequence: number;
  ringReadSequence: number;
  ringFillDepth: number;
  programRevision: number;
  activeEpoch: number;
  pendingEpoch: number;
  instanceId: string;
  peakSample: number;
  rmsSample: number;
  finiteOutput: number;
  underrunCount: number;
  glitchCount: number;
  timeoutCount: number;
  producerLivenessAge: number;
  producerTimeoutActive: boolean;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Synthesis engine service — the single main-thread owner of audio
 * lifecycle, NodeDef module compilation, and engine state.
 *
 * Construct via {@link createSynthesisService}. Dispose via
 * {@link SynthesisService.dispose}. The service is NOT re-entrant across
 * dispose boundaries; reinitialisation constructs a fresh service.
 */
export interface SynthesisService {
  /** Current engine state (the four-state lifecycle). */
  readonly state: SynthesisEngineState;
  /** Latest published telemetry snapshot (frozen, immutable). */
  readonly telemetry: SynthesisTelemetrySnapshot;

  /**
   * Attempt to resume audio. Requires transient user activation in real
   * browsers (the contract is enforced by AudioContext.resume()).
   *
   * Transitions `suspended → running` on success. No-op in any other
   * state — `off` requires engine bring-up, `error` requires recovery,
   * `running` is already there.
   *
   * Returns `true` iff the transition to `running` succeeded.
   */
  resumeOnUserActivation(): Promise<boolean>;

  /**
   * Rebuild failed engine resources and leave the engine suspended.
   * This is the explicit error-indicator action; unlike autoplay, it is
   * never invoked by ambient interactions. Calls are single-flight.
   */
  recoverFromError(): Promise<boolean>;

  /**
   * Devmode-only: terminate the producer to exercise the worklet-side
   * timeout path. Outside devmode this is a no-op that returns `false`.
   *
   * VAL-HOST-012: this action is the controlled fault surface; it must
   * be absent or inert in production builds.
   */
  devmodeTerminateProducer(): boolean;

  /**
   * Devmode-only: reinitialise the engine after a fault. Outside devmode
   * this is a no-op that returns `false`.
   *
   * Replaces failed AudioContext + worklet resources exactly once and
   * transitions to `suspended` so the autoplay path can resume on the
   * next trusted user input.
   *
   * VAL-HOST-012 / VAL-ENGINE-027: this action is the recovery affordance;
   * it must be absent or inert in production builds.
   */
  devmodeReinitialise(): Promise<boolean>;

  /**
   * Dispose the engine session. Closes the AudioContext, disconnects the
   * worklet, and clears all telemetry accumulators. The service is
   * unusable after dispose; reinitialisation constructs a fresh one.
   *
   * Used by:
   *   - devmode "shut down" buttons;
   *   - hot-reload during development;
   *   - the recovery path before constructing a new service.
   */
  dispose(): Promise<void>;

  /**
   * Apply a successful exact-eval synth artefact payload to the engine.
   *
   * Implements the eval-to-engine commit pipeline
   * (architecture.md §5.6; VAL-ENGINE-010):
   *
   *   1. Reject failed evals (`hasErrors === true`) before any engine
   *      mutation — failed evals change diagnostics only
   *      (VAL-ENGINE-015).
   *   2. Reject superseded responses whose `revision` is older than
   *      the latest committed revision — superseded responses are
   *      no-ops (VAL-ENGINE-013).
   *   3. Validate the ABI version (VAL-COMP-015) and NodeDef
   *      references.
   *   4. Build the identity-keyed graph diff.
   *   5. Allocate a fresh program epoch.
   *   6. Resolve prefill values from the NodeDef registry defaults.
   *   7. Post the ordered worklet delta messages (retire → instantiate
   *      → update) to the worklet so the worklet core stages the
   *      pending graph for the first matching-epoch block
   *      (VAL-ENGINE-011).
   *   8. Arm the Worker producer for the new epoch so the next
   *      produced block carries it.
   *
   * Returns the {@link EngineCommitResult}. The service records the
   * incoming declarations as the new active set and the incoming
   * revision as the latest committed revision on success.
   */
  commitSynthArtifacts(
    payload: SynthArtifactsPayload,
    hasErrors: boolean,
  ): EngineCommitResult;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class SynthesisServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SynthesisServiceError";
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the synthesis service.
 *
 * The factory does NOT bring audio up immediately. It transitions to
 * `suspended` lazily, on the first call to {@link SynthesisService.resumeOnUserActivation}
 * or when the bootstrap wiring explicitly calls the (private) bring-up
 * path. This keeps the autoplay contract clean: no AudioContext is
 * constructed until the user has activated the page OR the bootstrap
 * explicitly preallocates one (which is allowed only when the capability
 * snapshot says audio is available).
 */
export function createSynthesisService(
  options: SynthesisServiceOptions,
): SynthesisService {
  const now = options.now ?? Date.now;
  const devmode = options.devmode === true;

  if (!options.capabilities.audioCapable) {
    // Audio is unavailable. Stay in `off` forever; resume is a no-op.
    return createUnavailableService(options, now, devmode);
  }

  return createCapableService(options, now, devmode);
}

// ---------------------------------------------------------------------------
// Unavailable service — audio capability absent
// ---------------------------------------------------------------------------

function createUnavailableService(
  options: SynthesisServiceOptions,
  now: () => number,
  devmode: boolean,
): SynthesisService {
  const initialSnapshot: EngineStateSnapshot = Object.freeze({
    state: "off" as const,
    reasonKey: "NO_AUDIO_CAPABILITY" as EngineStateReasonKey,
    reasonMessage: ENGINE_STATE_REASONS.NO_AUDIO_CAPABILITY,
    transitionCount: 0,
    transitionedAt: now(),
  });

  publishEngineState(initialSnapshot);

  const telemetry: SynthesisTelemetrySnapshot = Object.freeze({
    schemaVersion: SYNTHESIS_TELEMETRY_SCHEMA_VERSION,
    capabilities: options.capabilities,
    engineState: "off",
    audioContextState: null,
    sampleRate: null,
    workletNodeCount: 0,
    compiledModuleCount: 0,
    compiledModuleNames: Object.freeze([]),
    sabAbiVersion: null,
    transitionCount: 0,
    faultActionsExposed: false,
    // Worklet-side objective telemetry (all zero / inert until the
    // worklet publishes).
    audioFrame: 0n,
    ringWriteSequence: 0,
    ringReadSequence: 0,
    ringFillDepth: 0,
    programRevision: 0,
    activeEpoch: 0,
    pendingEpoch: 0,
    instanceId: "",
    peakSample: 0,
    rmsSample: 0,
    finiteOutput: 1,
    underrunCount: 0,
    glitchCount: 0,
    timeoutCount: 0,
    producerLivenessAge: 0,
    producerTimeoutActive: false,
  });

  if (devmode) {
    options.installTelemetryGlobal?.(telemetry);
  }

  return {
    get state() {
      return "off" as const;
    },
    get telemetry() {
      return telemetry;
    },
    async resumeOnUserActivation() {
      // Audio is unavailable; resume is a no-op.
      return false;
    },
    async recoverFromError() {
      return false;
    },
    devmodeTerminateProducer() {
      // No producer exists; nothing to terminate.
      return false;
    },
    async devmodeReinitialise() {
      // No engine to reinitialise.
      return false;
    },
    commitSynthArtifacts(
      _payload: SynthArtifactsPayload,
      _hasErrors: boolean,
    ): EngineCommitResult {
      // Audio capability is absent; the engine never activates. The
      // eval pipeline still calls this method (so the editor can run
      // synth forms without audio), but the commit is a no-op.
      return NOOP_COMMIT_RESULT;
    },
    async dispose() {
      // Nothing to dispose.
    },
  };
}

// ---------------------------------------------------------------------------
// Capable service — audio capability present
// ---------------------------------------------------------------------------

function createCapableService(
  options: SynthesisServiceOptions,
  now: () => number,
  devmode: boolean,
): SynthesisService {
  // The accumulator is the mutable internal state. Reads against it go
  // through frozen snapshots published via {@link publishTelemetry}.
  const acc: TelemetryAccumulator = {
    workletNodeCount: 0,
    compiledModuleCount: 0,
    compiledModuleNames: [],
    sabAbiVersion: null,
    transitionCount: 0,
    audioContextState: null,
    sampleRate: null,
    audioFrame: 0n,
    ringWriteSequence: 0,
    ringReadSequence: 0,
    ringFillDepth: 0,
    programRevision: 0,
    activeEpoch: 0,
    pendingEpoch: 0,
    instanceId: "",
    peakSample: 0,
    rmsSample: 0,
    finiteOutput: 1,
    underrunCount: 0,
    glitchCount: 0,
    timeoutCount: 0,
    producerLivenessAge: 0,
    producerTimeoutActive: false,
  };

  let currentState: SynthesisEngineState = "off";
  let currentReasonKey: EngineStateReasonKey | null = null;
  let currentReasonMessage: string | null = null;
  let audioContext: AudioContextContract | null = null;
  let workletNode: WorkletNodeContract | null = null;
  let disposed = false;
  let recoveryPromise: Promise<boolean> | null = null;
  let workletAdded = false;
  const compiledAdapters = new Map<string, NodeDefAdapter>();
  // VAL-ENGINE-008: track which NodeDef modules have already been
  // shipped to the worklet so repeated resume / recovery paths send
  // EXACTLY ONE installation payload per def. The set is cleared on
  // dispose / recovery so the fresh worklet receives a fresh payload.
  const installedWorkletModules = new Set<string>();

  // VAL-ENGINE-027: the service stamps every worklet node it constructs
  // with a monotonically-increasing generation counter. The worklet →
  // service bridge rejects events whose generation is stale, so a
  // retired (failed) worklet cannot affect telemetry or state after
  // recovery has replaced it.
  let activeWorkletGeneration = 0;
  // VAL-ENGINE-029: track the SAB ABI version once the control buffer
  // has been attached. The constant comes from the dependency-free
  // contract module (VAL-SAB-001).
  let sabAbiVersionKnown: number | null = null;
  // VAL-CROSS-002/003 bridge: one SAB per engine session, shared
  // between the Worker producer and the AudioWorklet. Allocated in
  // `installProducerControlBridge`, detached on dispose/recovery.
  let producerControlBuffer: SharedArrayBuffer | null = null;
  // Service-side view over the control SAB, attached once per engine
  // session (b3895dbe). Telemetry reads go through this view; it is
  // replaced on recovery together with the buffer it wraps.
  let sabView: SynthesisControlView | null = null;
  let producerInstalled = false;
  let producerRunning = false;
  let firstPublishTimer: ReturnType<typeof setTimeout> | null = null;
  let attachAckTimer: ReturnType<typeof setTimeout> | null = null;
  // Lifetime fault-counter bases (VAL-ENGINE-030). The SAB header
  // counters are per-engine-session (a recovery allocates a fresh
  // zeroed buffer), while the published counters are lifetime for this
  // service instance. Each new bridge records the lifetime totals at
  // session start; published counter = base + current header value.
  let underrunCountBase = 0;
  let glitchCountBase = 0;
  let timeoutCountBase = 0;

  function clearProducerTimers(): void {
    if (firstPublishTimer) {
      clearTimeout(firstPublishTimer);
      firstPublishTimer = null;
    }
    if (attachAckTimer) {
      clearTimeout(attachAckTimer);
      attachAckTimer = null;
    }
  }

  // --- Eval-to-engine commit state (VAL-ENGINE-010/013/014/015) ---
  //
  // The active-declaration map is keyed by stable editor identity. The
  // latest applied compiler revision guards against superseded
  // responses (VAL-ENGINE-013). The epoch allocator issues fresh
  // program epochs so the worklet activates each commit on the first
  // matching-epoch block (VAL-ENGINE-011).
  const activeDeclarations = new Map<string, ActiveDeclaration>();
  let lastAppliedRevision = 0;
  const epochAllocator: EpochAllocator = createEpochAllocator();

  // VAL-ENGINE-022 dedup state: the last (message, type) pair posted to
  // the console sink. Consecutive identical pairs are suppressed so
  // state self-loops (suspended → suspended via failed resume, or
  // error → error via failed recovery) cannot flood the console.
  let lastConsoleMessage: { message: string; type: "log" | "warn" | "error" } | null = null;

  function postConsoleMessage(message: string, type: "log" | "warn" | "error"): void {
    const sink = options.consoleMessageSink;
    if (!sink) return;
    if (
      lastConsoleMessage !== null &&
      lastConsoleMessage.message === message &&
      lastConsoleMessage.type === type
    ) {
      // Dedup: consecutive identical pairs are suppressed.
      return;
    }
    lastConsoleMessage = { message, type };
    try {
      sink(message, type);
    } catch {
      // The console sink is best-effort; never let it propagate.
      // Reset dedup so a subsequent different message can post.
      lastConsoleMessage = null;
    }
  }

  /**
   * Map a transition into the console message it should post, if any.
   *
   * VAL-ENGINE-022: `suspended` and `error` transitions post one clear
   * state-appropriate message. `off` (capability-absent or dispose) and
   * `running` (silent success) post nothing. The dedup logic in
   * {@link postConsoleMessage} suppresses consecutive identical pairs.
   */
  function consoleMessageForTransition(
    nextState: SynthesisEngineState,
    reasonKey: EngineStateReasonKey | null,
    reasonMessage: string | null,
  ): { message: string; type: "log" | "warn" | "error" } | null {
    if (nextState === "suspended") {
      // The suspended indicator is clickable; the message points the
      // user at it (and gamepad-only sessions at any key/click).
      const message =
        reasonMessage ??
        ENGINE_STATE_REASONS.AWAITING_USER_ACTIVATION;
      return {
        message: `Audio suspended: ${message}`,
        type: "log",
      };
    }
    if (nextState === "error") {
      const message = reasonMessage ?? ENGINE_STATE_REASONS.RECOVERY_FAILED;
      return {
        message: `Synthesis engine error: ${message}`,
        type: "error",
      };
    }
    return null;
  }

  function snapshotTelemetry(): SynthesisTelemetrySnapshot {
    // Steady-state telemetry comes straight from the SAB header the
    // worklet writes every block (b3895dbe); the view is attached once
    // per engine session in `installProducerControlBridge`. Discrete
    // events (producer-timeout, graph-activated, attach ack) still
    // arrive via the port and are merged elsewhere.
    if (sabView) {
      acc.audioFrame = sabView.audioFrame;
      acc.peakSample = sabView.peakSample;
      acc.rmsSample = sabView.rmsSample;
      acc.finiteOutput = sabView.finiteOutput;
      acc.underrunCount = underrunCountBase + sabView.underrunCount;
      acc.glitchCount = glitchCountBase + sabView.glitchCount;
      acc.timeoutCount = timeoutCountBase + sabView.timeoutCount;
      acc.producerLivenessAge = sabView.producerLivenessAge;
      acc.activeEpoch = sabView.programEpoch;
      acc.ringWriteSequence = sabView.ringWriteIndex;
      acc.ringReadSequence = sabView.ringReadIndex;
      acc.ringFillDepth = sabView.ringFillDepth();
      if (sabView.ringWriteIndex > 0 && firstPublishTimer) {
        clearTimeout(firstPublishTimer);
        firstPublishTimer = null;
      }
    }
    const snapshot: SynthesisTelemetrySnapshot = Object.freeze({
      schemaVersion: SYNTHESIS_TELEMETRY_SCHEMA_VERSION,
      capabilities: options.capabilities,
      engineState: currentState,
      audioContextState: acc.audioContextState,
      sampleRate: acc.sampleRate,
      workletNodeCount: acc.workletNodeCount,
      compiledModuleCount: acc.compiledModuleCount,
      compiledModuleNames: Object.freeze([...acc.compiledModuleNames]),
      sabAbiVersion: acc.sabAbiVersion,
      transitionCount: acc.transitionCount,
      faultActionsExposed: devmode,
      // Worklet-side objective telemetry (VAL-ENGINE-029).
      audioFrame: acc.audioFrame,
      ringWriteSequence: acc.ringWriteSequence,
      ringReadSequence: acc.ringReadSequence,
      ringFillDepth: acc.ringFillDepth,
      programRevision: acc.programRevision,
      activeEpoch: acc.activeEpoch,
      pendingEpoch: acc.pendingEpoch,
      instanceId: acc.instanceId,
      peakSample: acc.peakSample,
      rmsSample: acc.rmsSample,
      finiteOutput: acc.finiteOutput,
      underrunCount: acc.underrunCount,
      glitchCount: acc.glitchCount,
      timeoutCount: acc.timeoutCount,
      producerLivenessAge: acc.producerLivenessAge,
      producerTimeoutActive: acc.producerTimeoutActive,
    });
    return snapshot;
  }

  function publishTelemetry() {
    if (devmode) {
      options.installTelemetryGlobal?.(snapshotTelemetry());
    }
  }

  function publishCurrentState() {
    const snapshot: EngineStateSnapshot = Object.freeze({
      state: currentState,
      reasonKey: currentReasonKey,
      reasonMessage: currentReasonMessage,
      transitionCount: acc.transitionCount,
      transitionedAt: now(),
    });
    publishEngineState(snapshot);
    publishTelemetry();
  }

  /**
   * Read the current engine state without TypeScript narrowing the local
   * `currentState` variable across `await` boundaries. The narrowed type
   * of `currentState` does not get widened by side effects (a transition
   * inside `bringUpAudio` may change the value), so every cross-await
   * read goes through this helper to defeat the narrow.
   */
  function readState(): SynthesisEngineState {
    return currentState;
  }

  function transition(
    next: SynthesisEngineState,
    reasonKey: EngineStateReasonKey | null,
    reasonMessage: string | null,
  ): boolean {
    if (disposed) {
      throw new SynthesisServiceError(
        "synthesis service is disposed; construct a new one to reinitialise",
      );
    }
    if (currentState === next) return false;
    const trigger = engineTransitionTrigger(currentState, next);
    if (trigger === null) {
      // Forbidden transition. The caller is misusing the service; surface
      // the contract violation rather than silently dropping the call.
      throw new SynthesisServiceError(
        `forbidden engine transition: ${currentState} → ${next}`,
      );
    }
    const from = currentState;
    currentState = next;
    currentReasonKey = reasonKey;
    currentReasonMessage = reasonMessage;
    acc.transitionCount += 1;
    publishCurrentState();
    // VAL-ENGINE-022: post a clear non-flooding console message on the
    // suspended and error transitions. Dedup happens inside
    // postConsoleMessage so consecutive identical pairs are suppressed.
    const consoleMessage = consoleMessageForTransition(next, reasonKey, reasonMessage);
    if (consoleMessage !== null) {
      postConsoleMessage(consoleMessage.message, consoleMessage.type);
    }
    engineLifecycle.publish({
      transitionCount: acc.transitionCount,
      from,
      to: next,
      trigger,
      at: now(),
    });
    return true;
  }

  async function bringUpAudio(): Promise<boolean> {
    if (audioContext !== null) return true;
    if (disposed) return false;

    audioContext = options.audioContextFactory();
    acc.audioContextState = audioContext.state;
    acc.sampleRate = audioContext.sampleRate;

    // Transition into 'suspended' the moment the AudioContext exists. Both
    // legal entry points ('off' and 'error') take their respective
    // 'engine-create' / 'recovery-succeeded' edges into 'suspended'. Every
    // subsequent failure during bring-up then goes through 'suspended → error'.
    if (currentState === "off") {
      transition("suspended", "AWAITING_USER_ACTIVATION",
        ENGINE_STATE_REASONS.AWAITING_USER_ACTIVATION);
    } else if (currentState === "error") {
      transition("suspended", "AWAITING_USER_ACTIVATION",
        ENGINE_STATE_REASONS.AWAITING_USER_ACTIVATION);
    }

    // Add the worklet processor module exactly once per AudioContext.
    if (audioContext.audioWorklet && !workletAdded) {
      try {
        await audioContext.audioWorklet.addModule(options.workletScriptUrl);
        workletAdded = true;
      } catch (err) {
        // Failed to add the worklet module — fail closed into error.
        // We are in 'suspended' here, so 'suspended → error' is allowed.
        await safeCloseAudioContext();
        transition("error", "RECOVERY_FAILED",
          `Failed to load worklet processor: ${(err as Error).message}`);
        return false;
      }
    }

    // Construct the SINGLE worklet node. The factory enforces one node.
    if (workletNode === null) {
      try {
        workletNode = options.workletNodeFactory(audioContext);
        // VAL-ENGINE-007 / VAL-ENGINE-027: exactly one worklet node is
        // held at any time. Recovery disposes the previous node first,
        // so the counter never accumulates across repeated recovery in
        // a single service instance.
        acc.workletNodeCount = 1;
        activeWorkletGeneration += 1;
        const generation = activeWorkletGeneration;
        // Wire the worklet → service telemetry + fault bridge. The
        // listener captures the current generation so events from a
        // retired (failed) worklet cannot affect state after recovery
        // has replaced it (VAL-ENGINE-027).
        workletNode.port.onmessage = (event: { data: unknown }) => {
          if (generation !== activeWorkletGeneration) return;
          handleWorkletEvent(event.data);
        };
        // Connect to the AudioContext destination (VAL-ENGINE-037).
        workletNode.connect(audioContext.destination);
        // The SAB ABI version is the contract module's frozen constant
        // (VAL-SAB-001). Recording it on first bring-up lets the
        // telemetry surface report it before the worklet publishes.
        if (sabAbiVersionKnown === null) {
          sabAbiVersionKnown = SYNTH_CONTROL_ABI_VERSION;
          acc.sabAbiVersion = sabAbiVersionKnown;
        }
      } catch (err) {
        transition("error", "RECOVERY_FAILED",
          `Failed to construct worklet node: ${(err as Error).message}`);
        return false;
      }
    }

    // VAL-CROSS-002/003 bridge: allocate the SAB once per engine
    // session, install it on the Worker producer, and ship the same
    // buffer to the worklet via `attach-control-buffer`. The producer
    // and worklet then share one ring; the producer publishes blocks
    // paced by the worklet's frame counter. This is the integration
    // step that ties the producer feature (m1-audio-clocked-worker-
    // producer) to the worklet host feature (m1-worklet-host-and-
    // epoch-consumer). Without it the producer has nothing to write
    // to and the worklet has nothing to read.
    try {
      await installProducerControlBridge();
    } catch (err) {
      transition("error", "RECOVERY_FAILED",
        `Failed to install producer control bridge: ${(err as Error).message}`);
      return false;
    }

    // Compile/transfer NodeDef modules (off the audio thread). The
    // worklet reuses the supplied module without recompiling (VAL-ENGINE-008).
    try {
      await loadNodeDefModules();
    } catch (err) {
      // loadNodeDefModules already transitioned to 'error'; rethrow is
      // unnecessary, the resume path returns false below.
      void err;
      return false;
    }

    return true;
  }

  /**
   * Allocate the synthesis control SAB, install it on the Worker
   * producer, and ship the same buffer to the worklet via
   * `attach-control-buffer`.
   *
   * The bridge is allocated exactly once per service instance. On
   * recovery the old SAB is discarded and a fresh one is created so
   * stale producer state cannot leak into the new engine session.
   *
   * The SAB is created by replicating the dependency-free
   * `createSynthesisControlBuffer` layout against a real
   * `SharedArrayBuffer` (when `crossOriginIsolated` is true, which the
   * capability snapshot has already verified before this service is
   * constructed).
   */
  async function installProducerControlBridge(): Promise<void> {
    if (producerControlBuffer !== null) return;
    if (typeof SharedArrayBuffer === "undefined") {
      throw new Error("SharedArrayBuffer is unavailable; cannot install producer control bridge");
    }

    // Use the dependency-free layout helper to size and initialise the
    // buffer, then copy its bytes into a same-sized SharedArrayBuffer.
    // The layout is the single source of truth (VAL-SAB-001), so the
    // producer and worklet agree on offsets, strides, and capacity by
    // construction.
    const layout = createSynthesisControlBuffer({
      renderQuantumFrames: DEFAULT_RENDER_QUANTUM_FRAMES,
    });
    const sab = new SharedArrayBuffer(layout.byteLength);
    new Uint8Array(sab).set(new Uint8Array(layout));
    producerControlBuffer = sab;
    sabView = attachSynthesisControlView(sab);
    // Fresh session: bank the lifetime fault totals so the zeroed
    // header continues the count instead of regressing it.
    underrunCountBase = acc.underrunCount;
    glitchCountBase = acc.glitchCount;
    timeoutCountBase = acc.timeoutCount;

    // Ship the SAB to the worklet. The worklet core's
    // `attach-control-buffer` handler validates ABI magic/version and
    // attaches its typed view. The worklet's audio-thread-side
    // consumer reads control blocks from this ring every render
    // quantum.
    if (workletNode !== null) {
      workletNode.port.postMessage({
        type: "attach-control-buffer",
        controlBuffer: sab,
      });
      // Fail closed if the worklet never acks the attach (synthesis.md
      // §4.8): without the ack the worklet's controlView stays null and
      // its liveness timeout is gated off, so silence would otherwise
      // be indefinite and undiagnosed (c84c125f). The attach happens
      // during bring-up while the engine is `suspended`, so the guard
      // is "not already terminal", NOT "running".
      attachAckTimer = setTimeout(() => {
        attachAckTimer = null;
        if (disposed || currentState === "error") return;
        transition("error", "WORKLET_CONTROL_ATTACH_FAILED",
          ENGINE_STATE_REASONS.WORKLET_CONTROL_ATTACH_FAILED);
      }, ATTACH_CONTROL_BUFFER_ACK_TIMEOUT_MS);
    }

    // Install the SAB on the Worker producer. The producer attaches
    // its own typed view and starts publishing blocks paced by the
    // worklet's frame counter.
    const workerPort = options.workerPort;
    if (workerPort && typeof workerPort.producerInstallSab === "function") {
      try {
        await workerPort.producerInstallSab(sab, {
          blockRateChannels: ["freq", "amp"],
          lookaheadBlocks: CONTROL_LOOKAHEAD_BLOCKS,
          renderQuantumFrames: DEFAULT_RENDER_QUANTUM_FRAMES,
        });
        producerInstalled = true;
      } catch (err) {
        // The producer could not attach (ABI mismatch, OOM, etc.).
        // Fail closed: the worklet's timeout path will silence output
        // if no blocks arrive, but we surface the failure as an error
        // transition so the user sees it.
        throw new Error(`producerInstallSab failed: ${(err as Error).message}`);
      }
    }
  }

  /**
   * Start the Worker producer loop. Called when the engine transitions
   * to `running`. The producer publishes blocks to fill the ring up to
   * the configured lookahead; the worklet consumes them on every
   * render quantum.
   *
   * No-op when the producer bridge has not been installed or when the
   * worker port does not expose `producerStart` (older Worker
   * revisions, unit tests).
   */
  async function startProducer(): Promise<void> {
    if (producerRunning) return;
    if (!producerInstalled) return;
    const workerPort = options.workerPort;
    if (!workerPort || typeof workerPort.producerStart !== "function") return;
    if (audioContext === null) return;
    try {
      await workerPort.producerStart({
        sampleRate: audioContext.sampleRate,
      });
      producerRunning = true;
      armFirstPublishDeadline();
    } catch (err) {
      // A producerStart throw was previously swallowed with a comment
      // claiming the worklet timeout path covers it — it does not: the
      // worklet only ages liveness after a first publish (5f4de6d8).
      transition("error", "PRODUCER_FIRST_PUBLISH_TIMEOUT",
        `The control producer failed to start: ${(err as Error).message}`);
    }
  }

  /**
   * Deadline for the producer's FIRST ring publication (5f4de6d8). The
   * worklet's liveness timeout only ages once `producerEverPublished`,
   * so a producer that starts but never publishes would otherwise leave
   * the engine `running` over eternal silence. While the engine is not
   * `running` the worklet publishes no frames to pace against, so the
   * deadline re-arms instead of firing a false positive.
   */
  function armFirstPublishDeadline(): void {
    if (firstPublishTimer) clearTimeout(firstPublishTimer);
    firstPublishTimer = setTimeout(() => {
      firstPublishTimer = null;
      if (disposed || !producerRunning || sabView === null) return;
      if (sabView.ringWriteIndex > 0) return;
      if (currentState !== "running") {
        armFirstPublishDeadline();
        return;
      }
      transition("error", "PRODUCER_FIRST_PUBLISH_TIMEOUT",
        ENGINE_STATE_REASONS.PRODUCER_FIRST_PUBLISH_TIMEOUT);
    }, PRODUCER_FIRST_PUBLISH_DEADLINE_MS);
  }

  /**
   * Stop the Worker producer loop. Called on transition out of
   * `running` and during dispose so a stale producer cannot keep
   * publishing to a retired SAB.
   */
  async function stopProducer(): Promise<void> {
    if (!producerRunning) return;
    producerRunning = false;
    if (firstPublishTimer) {
      clearTimeout(firstPublishTimer);
      firstPublishTimer = null;
    }
    const workerPort = options.workerPort;
    if (!workerPort || typeof workerPort.producerStop !== "function") return;
    try {
      await workerPort.producerStop();
    } catch {
      // Best-effort; the producer will be replaced on recovery anyway.
    }
  }

  async function loadNodeDefModules(): Promise<void> {
    const descriptors = options.nodeDefDescriptors ?? defaultNodeDefDescriptors();
    for (const descriptor of descriptors) {
      const key = `${descriptor.name}@${descriptor.version}`;
      if (compiledAdapters.has(key)) continue;
      // VAL-ENGINE-008: exactly one installation payload per def is
      // sent before rendering or graph activation. Track the
      // installation state on the service so repeated calls (recovery,
      // repeated resume) cannot re-send the payload. The
      // `compiledAdapters.has(key)` check above guards the host-side
      // adapter cache; this guards the worklet-side transfer.
      if (installedWorkletModules.has(key)) continue;
      try {
        const { module, compiledWasm, wasmBytes } = await options.nodeDefModuleLoader(descriptor);
        // Adapter validates descriptor equality before instantiation so a
        // stale bundle cannot slip past the asset pipeline.
        const adapter = await import("./nodeDefAdapter").then(({ createNodeDefAdapter }) =>
          createNodeDefAdapter(module, descriptor),
        );
        compiledAdapters.set(key, adapter);
        acc.compiledModuleCount += 1;
        acc.compiledModuleNames.push(descriptor.name);
        // VAL-ENGINE-008: ship exactly one installation payload to the
        // worklet. The preferred path is a structured-cloned
        // `WebAssembly.Module` — the spec lists it as cloneable and
        // Chromium preserves it across most AudioWorklet ports. When
        // the loader did not produce a compiled module (e.g. tests
        // that inject only a fake adapter), or when the host elects
        // the Chromium fallback explicitly, the payload carries the
        // EXACT prevalidated bytes the main thread compiled from.
        //
        // The two fields are mutually exclusive: exactly one is set
        // per {@link WorkletModuleTransferMessage} contract. The
        // worklet refuses malformed payloads that carry both or
        // neither.
        if (workletNode) {
          const payload = buildModuleTransferPayload(descriptor, compiledWasm, wasmBytes);
          if (payload !== null) {
            workletNode.port.postMessage(payload);
            installedWorkletModules.add(key);
          }
        }
      } catch (err) {
        // Module compilation failed. The worklet has not received the
        // module, so it cannot render this def. Surface as an error
        // transition so the user sees the failure.
        transition("error", "RECOVERY_FAILED",
          `Failed to compile NodeDef ${key}: ${(err as Error).message}`);
        throw err;
      }
    }
    publishTelemetry();
  }

  // -------------------------------------------------------------------------
  // Worklet → service bridge (VAL-ENGINE-026 / VAL-ENGINE-029 / VAL-ENGINE-030)
  // -------------------------------------------------------------------------
  //
  // The AudioWorkletProcessor publishes three event kinds back to the
  // main thread via `port.postMessage`:
  //
  //   1. `WorkletTelemetrySnapshot` — published every render quantum.
  //      Carries audio frame, ring sequences, peak/RMS, finite-output,
  //      underrun / glitch / timeout counters, instance id, and
  //      liveness. The service merges these into its devmode telemetry
  //      so VAL-ENGINE-029's full objective contract is observable
  //      from a single snapshot.
  //   2. `WorkletProducerTimeoutEvent` — published once when the
  //      worklet independently detects producer loss (VAL-ENGINE-023).
  //      The service transitions `running → error` so the engine
  //      surfaces the fault through the indicator and console
  //      (VAL-ENGINE-026). This path is independent of any main-thread
  //      Worker error: the worklet is the authority on producer
  //      liveness while audio runs.
  //   3. `WorkletInstanceRetiredEvent` / `WorkletGraphActivatedEvent` —
  //      lifecycle audit events; they refresh telemetry but do not
  //      drive state transitions on their own.
  //
  // The handler also enforces VAL-ENGINE-030: fault counters change
  // only when the corresponding fault arrives. Healthy telemetry
  // snapshots never bump counters; the timeout counter increments
  // exactly once per `producer-timeout` event.
  //
  // Generation guard (VAL-ENGINE-027): the listener installed at
  // bring-up captures `activeWorkletGeneration`. Events whose captured
  // generation no longer matches are dropped at the listener boundary,
  // so a retired (failed) worklet cannot affect telemetry or state
  // after recovery has constructed a fresh node.

  function handleWorkletEvent(data: unknown): void {
    if (!data || typeof data !== "object") return;
    const evt = data as { type?: string };

    if (evt.type === "producer-timeout") {
      handleProducerTimeout(data as WorkletProducerTimeoutEvent);
      return;
    }
    if (evt.type === "attach-control-buffer-ack") {
      if (attachAckTimer) clearTimeout(attachAckTimer);
      attachAckTimer = null;
      const ack = evt as WorkletControlAttachAckEvent;
      if (!ack.ok && !disposed && currentState !== "error") {
        // Negative ack: the worklet rejected the SAB header (ABI
        // mismatch — typically a stale cached worklet bundle after an
        // ABI bump). Fatal startup error per synthesis.md §4.8.
        const detail = ack.reason ? ` (${ack.reason})` : "";
        transition("error", "WORKLET_CONTROL_ATTACH_FAILED",
          `${ENGINE_STATE_REASONS.WORKLET_CONTROL_ATTACH_FAILED}${detail}`);
      }
      return;
    }

    if (typeof (evt as { schemaVersion?: unknown }).schemaVersion === "number") {
      // Legacy WorkletTelemetrySnapshot. Steady-state telemetry is
      // SAB-header-authoritative (b3895dbe); the production worklet no
      // longer posts snapshots and any that arrive are ignored.
      return;
    }

    if (evt.type === "graph-activated") {
      // Lifecycle audit event (no state transition — the service owns
      // the four-state lifecycle). With per-quantum snapshots gone,
      // this event is also the authoritative source for the active
      // instance identity the devmode telemetry exposes.
      const activated = evt as { identity?: unknown };
      if (typeof activated.identity === "string") {
        acc.instanceId = activated.identity;
      }
      publishTelemetry();
      return;
    }
    if (evt.type === "instance-retired") {
      const retired = evt as { identity?: unknown };
      if (typeof retired.identity === "string" && retired.identity === acc.instanceId) {
        acc.instanceId = "";
      }
      publishTelemetry();
      return;
    }
    if (evt.type === "graph-diagnostic") {
      // Host resource-limit / capability diagnostic (synthesis.md
      // §3.5, epic M2.1): zone exhaustion, node limit, or a wiring
      // capability gap. The graph keeps running; the diagnostic is
      // surfaced on the console like a compile-style warning.
      const diag = evt as { code?: unknown; identity?: unknown };
      const code = typeof diag.code === "string" ? diag.code : "unknown";
      const identity = typeof diag.identity === "string" ? diag.identity : "?";
      postConsoleMessage(
        `Synthesis engine diagnostic (${code}) for node ${identity}`,
        "warn",
      );
      return;
    }

    // Unknown event shapes are silently ignored so a forward-compatible
    // worklet cannot crash the main thread.
  }

  /**
   * Merge a worklet-published telemetry snapshot into the service
   * accumulator. Every objective VAL-ENGINE-029 field the worklet
   * reports lands here.
   *
   * The merger enforces monotonicity for the counters (the accumulator
   * only ever increases them) and monotonicity for the audio frame.
   * Non-monotonic values from a buggy or racing worklet are clamped
   * rather than corrupting the published telemetry.
   */
  /**
   * Handle the producer-timeout event. VAL-ENGINE-026: the engine
   * transitions `running → error` with the `PRODUCER_TIMEOUT` reason,
   * the timeout counter increments, and peak/RMS are no longer
   * authoritative (the worklet will report zero once the fade
   * completes).
   *
   * VAL-ENGINE-030: the timeout counter increments exactly once per
   * event. Repeated events (e.g. from a worklet that keeps firing
   * after the first transition) are deduplicated by the
   * `running → error` transition guard — once the engine is in
   * `error`, subsequent timeout events do not re-transition.
   */
  function handleProducerTimeout(event: WorkletProducerTimeoutEvent): void {
    // The timeout COUNTER is SAB-authoritative: the worklet core
    // increments its header counter when it detects the loss, and
    // `snapshotTelemetry` publishes base + header. This handler only
    // owns the state transition and the timeout-active flag.
    acc.producerTimeoutActive = true;
    // Peak/RMS will reach zero once the emergency fade completes; we
    // do NOT zero them here because the worklet will publish the
    // post-fade silence snapshot (VAL-ENGINE-025). Doing so would
    // mask an in-progress fade from the telemetry surface.
    if (currentState === "running") {
      // running → error is the canonical producer-loss transition
      // (synthesisChannels.ts: trigger "producer-loss").
      transition("error", "PRODUCER_TIMEOUT",
        ENGINE_STATE_REASONS.PRODUCER_TIMEOUT);
    } else if (currentState === "suspended") {
      // The producer died while we were suspended (rare, but possible
      // if the Worker crashed between user activation and resume).
      // Transition through the documented fatal-before-running edge.
      transition("error", "PRODUCER_TIMEOUT",
        ENGINE_STATE_REASONS.PRODUCER_TIMEOUT);
    }
    // Capture the atBlock / livenessAge for debugging if a sink is
    // wired. This is best-effort; the transition above already posted
    // the user-facing message.
    void event;
    publishTelemetry();
  }

  const service: SynthesisService = {
    get state() {
      return currentState;
    },
    get telemetry() {
      return snapshotTelemetry();
    },

    async resumeOnUserActivation() {
      if (disposed) return false;
      // If we are still off but audio is capable, bring the engine up
      // (constructs the AudioContext + worklet). The actual `resume()`
      // call below requires the user activation that the caller is
      // asserting was just received.
      if (readState() === "off") {
        const ok = await bringUpAudio();
        // After the await, currentState may have transitioned (the
        // bring-up path emits a 'suspended' transition on success or an
        // 'error' transition on failure). Re-read and compare against
        // the union of possible post-bring-up states.
        const postBringUp = readState();
        if (!ok || (postBringUp !== "suspended" && postBringUp !== "error")) {
          return false;
        }
        if (postBringUp === "error") return false;
      }
      if (readState() !== "suspended" || audioContext === null) {
        return false;
      }
      try {
        await audioContext.resume();
        acc.audioContextState = audioContext.state;
        transition("running", null, null);
        // VAL-CROSS-002 bridge: now that audio is actually running,
        // start the Worker producer loop. The producer publishes
        // control blocks paced by the worklet's audio-frame counter;
        // without this step the ring stays empty and the worklet
        // times out within ~64 ms.
        await startProducer();
        return true;
      } catch {
        // Resume was rejected (browser did not see activation, or
        // hardware rejected the request). Stay suspended.
        if (readState() === "suspended") {
          transition("suspended", "AWAITING_USER_ACTIVATION",
            ENGINE_STATE_REASONS.AWAITING_USER_ACTIVATION);
        }
        return false;
      }
    },

    devmodeTerminateProducer() {
      if (!devmode) return false;
      if (currentState !== "running") return false;
      // Simulate producer loss. VAL-HOST-012 requires the devmode
      // fault action to reproduce real producer loss end to end:
      //   1. Terminate the Worker producer so it stops publishing
      //      fresh control blocks to the SAB.
      //   2. Arm the worklet-side liveness observer so the next
      //      process() call observes producer loss, fades to exact
      //      silence over 10 ms, and publishes `producer-timeout`.
      // Pre-fix, only step 2 fired, so the Worker kept publishing
      // blocks. Each fresh block reset the worklet's liveness age
      // and `producerTimeoutActive` flag, causing the timeout event
      // to re-fire on every block. The engine never stabilised in
      // `error`, which masked the post-recovery audio-output bug
      // (Ergo bug c7edc263).
      const workerPort = options.workerPort;
      if (workerPort && typeof workerPort.producerTerminate === "function") {
        // Fire-and-forget: the Worker-side termination is bounded
        // (wasmRuntime.worker.ts: `producer?.stop()` and
        // `producerLoopDriver?.stop()` are synchronous), and the
        // error transition arrives through the worklet-side timeout
        // path on the next process() call. Awaiting here would add
        // no safety and would block the devmode action's return.
        void workerPort.producerTerminate().catch(() => {
          // Best-effort: the worklet-side timeout will still fire.
        });
        // The producer is no longer running; mark it locally so
        // post-recovery `startProducer()` actually restarts it.
        producerRunning = false;
      }
      if (workletNode) {
        workletNode.port.postMessage({ type: "devmode-terminate-producer" });
      }
      // The actual `error` transition is published by the worklet-side
      // liveness observer; this method only arms the fault. Tests
      // transition directly through `simulateFaultForTests` if they
      // need to drive the state synchronously.
      return true;
    },

    recoverFromError() {
      if (currentState !== "error") return Promise.resolve(false);
      if (recoveryPromise !== null) return recoveryPromise;
      recoveryPromise = (async () => {
        await disposeResources("error");
        const ok = await bringUpAudio();
        return ok && readState() === "suspended";
      })().finally(() => {
        recoveryPromise = null;
      });
      return recoveryPromise;
    },

    async devmodeReinitialise() {
      if (!devmode) return false;
      return service.recoverFromError();
    },

    commitSynthArtifacts(
      payload: SynthArtifactsPayload,
      hasErrors: boolean,
    ): EngineCommitResult {
      return runEngineCommit(payload, hasErrors);
    },

    async dispose() {
      if (disposed) return;
      // IMPORTANT: disposeResources() must run BEFORE we set disposed=true
      // so the final state transition ('running → off' or 'error → off')
      // is published through the normal channel/store pipeline. Once
      // disposed is true, transition() refuses to publish.
      await disposeResources("off");
      disposed = true;
    },
  };

  async function safeCloseAudioContext(): Promise<void> {
    if (audioContext) {
      try {
        await audioContext.close();
      } catch {
        // Best-effort cleanup.
      }
    }
    audioContext = null;
    acc.audioContextState = null;
    acc.sampleRate = null;
  }

  async function disposeResources(finalState: SynthesisEngineState): Promise<void> {
    // VAL-ENGINE-027 / Ergo bug c7edc263: stop the Worker producer
    // FIRST so it stops publishing to the SAB we are about to retire.
    // Without this stop, the dead producer kept "running" against the
    // retired SAB and the post-recovery `startProducer()` no-op'd
    // because `producerRunning` was still `true`. The fresh worklet
    // never received an `attach-control-buffer` because the SAB
    // pointer was never cleared, so its `controlView` stayed null and
    // the published `audioFrame` stayed at 0 — exactly the
    // `engineState=running, audioFrame=0` signature c7edc263 captured.
    await stopProducer();
    // VAL-CROSS-009 post-recovery eval-pipeline fix: clear the WASM
    // compiler's synth declarations so the next synth eval after
    // recovery is not rejected as an over-capacity second declaration.
    // The WASM engine persists across service recovery (the Worker is
    // not recreated), so without this clear the stale synth declaration
    // triggers the M1 single-node capacity diagnostic on the first
    // post-recovery eval, causing the commit pipeline to reject the
    // response as a failed eval. This is the root cause of the
    // "post-recovery eval-pipeline gap" that prior evidence masked.
    const workerPortForClear = options.workerPort;
    if (workerPortForClear && typeof workerPortForClear.clearSynthDeclarations === "function") {
      try {
        await workerPortForClear.clearSynthDeclarations();
      } catch {
        // Best-effort: if the clear fails, the user will see a
        // capacity diagnostic on the next eval, which they can clear
        // manually with (useq-clear).
      }
    }
    // Disconnect the worklet first so no further graph mutations are
    // applied to a dying context.
    if (workletNode) {
      try {
        workletNode.disconnect();
        workletNode.port.close?.();
      } catch {
        // Best-effort cleanup.
      }
      // VAL-ENGINE-027: bump the generation guard so any in-flight
      // event from the retired (failed) worklet is dropped by the
      // listener boundary. The next bring-up constructs a fresh node
      // with a new generation, so the failed worklet cannot affect
      // telemetry or state after recovery.
      activeWorkletGeneration += 1;
      // The currently-held node count drops to zero. The next bring-up
      // (recovery) sets it back to 1 by constructing exactly one fresh
      // node, so the count never accumulates across repeated recovery
      // (VAL-ENGINE-007 / VAL-ENGINE-027).
      acc.workletNodeCount = 0;
      workletNode = null;
    }
    if (audioContext) {
      try {
        await audioContext.close();
      } catch {
        // Best-effort cleanup.
      }
      audioContext = null;
    }
    // Reset worklet-add-module tracking so reinitialisation re-adds the
    // processor script to the next AudioContext. Without this the recovery
    // path would skip addModule and the new worklet node would have no
    // processor registered.
    workletAdded = false;
    acc.audioContextState = null;
    acc.sampleRate = null;
    compiledAdapters.clear();
    // VAL-ENGINE-008: clear the installed-module set so the recovered
    // worklet receives a fresh installation payload on its next bring-
    // up. Without this clear, the recovered worklet would never get a
    // module transfer and instantiation would fail with "no adapter".
    installedWorkletModules.clear();
    // Reset the eval-to-engine commit state so the recovered session
    // starts fresh. The active-declaration map is cleared so the next
    // commit treats every declaration as added (the worklet re-
    // instantiates from scratch after recovery).
    activeDeclarations.clear();
    lastAppliedRevision = 0;
    // Reset the worklet-side objective telemetry so the recovered
    // session starts from a clean baseline. The fresh worklet will
    // repopulate these fields with its first published snapshot
    // (VAL-ENGINE-029). Without the reset, stale peak/RMS / counters
    // from the failed session would leak into the recovered telemetry.
    acc.audioFrame = 0n;
    acc.ringWriteSequence = 0;
    acc.ringReadSequence = 0;
    acc.ringFillDepth = 0;
    acc.programRevision = 0;
    acc.activeEpoch = 0;
    acc.pendingEpoch = 0;
    acc.instanceId = "";
    acc.peakSample = 0;
    acc.rmsSample = 0;
    acc.finiteOutput = 1;
    // VAL-ENGINE-027 / Ergo bug c7edc263: clear the producer bridge
    // state so the next bring-up re-installs a FRESH SAB on the
    // Worker producer AND ships `attach-control-buffer` to the new
    // worklet. Pre-fix, `producerControlBuffer` stayed non-null after
    // recovery, so `installProducerControlBridge()` early-returned
    // and the new worklet never received an SAB. With `controlView`
    // null in the worklet core, `audioFrame` was hard-coded to 0 in
    // every published telemetry snapshot — exactly the
    // `engineState=running, audioFrame=0` signature c7edc263 reports.
    producerControlBuffer = null;
    sabView = null;
    producerInstalled = false;
    producerRunning = false;
    // Pending deadline/ack timers belong to the session being torn
    // down; a late firing against the fresh session would be a
    // spurious error transition.
    clearProducerTimers();
    // Note: fault counters (underrun/glitch/timeout) are NOT reset
    // here. They are lifetime counters for the current service
    // instance. A full dispose (final state "off") resets them via
    // the accumulator going out of scope; recovery keeps the counters
    // so dashboards can observe the cumulative fault history.
    acc.producerLivenessAge = 0;
    acc.producerTimeoutActive = false;
    if (currentState !== finalState) {
      const reasonKey: EngineStateReasonKey | null =
        finalState === "error" ? "RECOVERY_FAILED" : null;
      const reasonMessage: string | null =
        finalState === "error" ? ENGINE_STATE_REASONS.RECOVERY_FAILED : null;
      try {
        transition(finalState, reasonKey, reasonMessage);
      } catch {
        // Transition may be forbidden when the service is already in a
        // terminal state; fall through to clear telemetry.
      }
    } else if (finalState === "error") {
      // error → error self-loop: emit a fresh lifecycle event so
      // dashboards can count distinct recovery attempts.
      try {
        transition("error", "RECOVERY_FAILED", ENGINE_STATE_REASONS.RECOVERY_FAILED);
      } catch {
        // Swallow — emit is best-effort.
      }
    }
    publishTelemetry();
  }

  // -----------------------------------------------------------------------
  // Eval-to-engine commit (VAL-ENGINE-010/013/014/015)
  // -----------------------------------------------------------------------
  //
  // Implements the canonical commit pipeline (architecture.md §5.6):
  //   1. Reject failed evals before any mutation (VAL-ENGINE-015).
  //   2. Reject superseded responses before any mutation (VAL-ENGINE-013).
  //   3. Validate ABI + NodeDef references (VAL-COMP-015).
  //   4. Build the identity-keyed graph diff.
  //   5. Allocate a fresh program epoch.
  //   6. Resolve prefill values from the registry defaults.
  //   7. Post the ordered worklet delta messages.
  //   8. Arm the Worker producer for the new epoch.
  //
  // The function is synchronous through step 7 (the worklet post is a
  // non-blocking postMessage). Step 8 (producerArmEpoch) is async but
  // the service does NOT await it before returning — the worklet
  // activation is gated on the epoch tag the producer writes into the
  // SAB, and the producer writes that tag on its next iteration. Awaiting
  // the arm call would block the eval pipeline on the Worker's
  // microtask queue, which is exactly the starvation pattern
  // VAL-ENGINE-006 forbids. The arm call is fire-and-forget; failures
  // surface through producer telemetry (the next produced block will
  // not carry the new epoch, so the worklet will keep the prior graph).

  function runEngineCommit(
    payload: SynthArtifactsPayload,
    hasErrors: boolean,
  ): EngineCommitResult {
    if (disposed) {
      return NOOP_COMMIT_RESULT;
    }

    // Step 1: VAL-ENGINE-015 — failed evals change diagnostics only.
    if (hasErrors) {
      return {
        outcome: "rejected-failed-eval",
        epoch: 0,
        revision: 0,
        workletDeltas: Object.freeze([]),
      };
    }

    // Step 2: VAL-ENGINE-013 — superseded responses are no-ops.
    // The Worker handler returns the LAST successful synth artefact
    // payload on a failed eval; the `revision` field lets us detect
    // whether this response is older than the one we already committed.
    // A strictly-older revision means a later eval already won. A
    // zero revision response is a pre-commit Worker probe; once a real
    // commit has landed (lastAppliedRevision > 0), the zero-revision
    // response is stale and must not regress engine state.
    if (payload.revision < lastAppliedRevision) {
      return {
        outcome: "rejected-superseded",
        epoch: 0,
        revision: 0,
        workletDeltas: Object.freeze([]),
      };
    }

    // Step 3: ABI + NodeDef validation.
    if (!isSynthArtifactsPayload(payload)) {
      return NOOP_COMMIT_RESULT;
    }
    if (!synthArtifactsSupportsAbi(payload.abi)) {
      throw new SynthesisServiceError(
        `synth artefact ABI version ${payload.abi} does not match consumer ABI ${SYNTH_ARTIFACT_ABI_VERSION}`,
      );
    }
    for (const decl of payload.declarations) {
      if (!findNodeDefDescriptor(decl.def, decl.version)) {
        throw new SynthesisServiceError(
          `synth artefact references unknown NodeDef ${decl.def} v${decl.version}`,
        );
      }
    }
    // Resource limit (synthesis.md §3.5): checked at eval-commit with a
    // compile-style diagnostic on breach; the eval is rejected before
    // any worklet delta or producer arm is issued — never a glitch.
    if (payload.declarations.length > MAX_SYNTH_NODES) {
      throw new SynthesisServiceError(
        `synth program declares ${payload.declarations.length} nodes, exceeding MAX_SYNTH_NODES (${MAX_SYNTH_NODES})`,
      );
    }

    // Steps 4–6: build the commit plan (diff, epoch, prefills, deltas).
    const prior = Array.from(activeDeclarations.values());
    const plan = buildEngineCommitPlan(prior, payload, epochAllocator);

    // Step 7: post the ordered worklet delta messages. The worklet
    // stages the pending graph for the first matching-epoch block
    // (VAL-ENGINE-011). If the worklet has not been brought up yet
    // (engine in 'off' or 'suspended'), the messages are still safe
    // to post — the AudioWorkletProcessor queues them until its
    // event loop runs.
    if (workletNode) {
      for (const delta of plan.workletDeltas) {
        if (delta.type === "instantiate") {
          // The worklet core allocates the state zone between quanta
          // when statePointer/stateBytes are zero. The service does
          // not preallocate (the host-owned shared memory lives inside
          // the worklet global scope). The M2.1 graph fields (control
          // window, port counts, audio-input wiring) pass through to
          // the worklet unchanged.
          workletNode.port.postMessage({
            type: "instantiate",
            identity: delta.identity,
            prefill: delta.prefill,
            statePointer: 0,
            stateBytes: 0,
            controlChannelBase: delta.controlChannelBase,
            audioOutputs: delta.audioOutputs,
            audioInputs: delta.audioInputs,
          });
        } else {
          // retire / update pass through unchanged.
          workletNode.port.postMessage(delta);
        }
      }
    }

    // Step 8: arm the Worker producer for the new epoch. Fire-and-
    // forget — see the rationale above. The producer writes the epoch
    // into its pendingEpoch header field; the next produced block
    // carries it; the worklet activates the pending graph on the
    // first matching-epoch block (VAL-ENGINE-011).
    const workerPort = options.workerPort;
    if (workerPort && plan.epoch !== 0) {
      // The producer arm is async but we deliberately do NOT await
      // it: the eval pipeline must not block on Worker round-trips
      // (VAL-ENGINE-006). Errors surface through producer telemetry.
      void workerPort.producerArmEpoch(plan.epoch).then(
        () => {
          // Arm succeeded; the next produced block carries the epoch.
        },
        (err) => {
          // Best-effort: log to the console sink if wired. The worklet
          // will hold the pending graph until a matching block lands
          // or the producer times out (VAL-ENGINE-024).
          postConsoleMessage(
            `Synthesis producer arm failed for epoch ${plan.epoch}: ${(err as Error).message}`,
            "warn",
          );
        },
      );
    }

    // VAL-CROSS-002: send the resolved control values to the producer.
    // For M1 the block-rate channels (freq, amp) are static per-eval
    // values resolved from the NodeDef registry defaults and the user's
    // synth form bindings. The producer publishes these on every block
    // so the worklet receives consistent controls. This is fire-and-
    // forget like the epoch arm above.
    if (workerPort && typeof workerPort.producerSetControlValues === "function") {
      const controlValues: Record<string, number> = {};
      for (const [, paramTable] of plan.prefills) {
        for (const [paramName, value] of paramTable) {
          // For M1 there is only one synth instance, so channel
          // name collisions are impossible. Future features that
          // support multiple simultaneous instances will need a
          // namespaced channel scheme.
          controlValues[paramName] = value;
        }
      }
      void workerPort.producerSetControlValues(controlValues).then(
        () => { /* control values updated */ },
        () => { /* best-effort */ },
      );
    }

    // Update the active-declaration map from the incoming payload. The
    // map is the source of truth for the next diff; it is keyed by
    // stable identity so update-in-place preserves instance and phase
    // (VAL-ENGINE-014).
    activeDeclarations.clear();
    for (const decl of payload.declarations) {
      activeDeclarations.set(decl.identity, {
        identity: decl.identity,
        def: decl.def,
        version: decl.version,
      });
    }
    lastAppliedRevision = payload.revision;
    // VAL-CROSS-002/003: publish the committed revision and pending
    // epoch into telemetry so the devmode surface reflects the latest
    // successful commit. The worklet merges its own pendingEpoch /
    // activeEpoch snapshots on every telemetry publication; setting
    // them here lets the dashboard correlate the commit with the
    // about-to-activate graph.
    acc.programRevision = payload.revision;
    acc.pendingEpoch = plan.epoch;
    for (const delta of plan.workletDeltas) {
      if (delta.type === "instantiate" && delta.identity?.identity) {
        acc.instanceId = delta.identity.identity;
        break;
      }
    }
    publishTelemetry();

    return {
      outcome: "committed",
      epoch: plan.epoch,
      revision: payload.revision,
      workletDeltas: plan.workletDeltas,
    };
  }

  // Publish the initial `off` state (with capability present, so no reason).
  publishCurrentState();
  publishTelemetry();

  return service;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build the EXACT ONE installation payload for a NodeDef module transfer
 * to the worklet (VAL-ENGINE-008).
 *
 * The contract is:
 *
 *   - When the loader produced a compiled `WebAssembly.Module`, the
 *     payload carries it as `module` (the structured-cloned fast path).
 *     The worklet instantiates the module against its shared memory
 *     without recompiling.
 *
 *   - Otherwise (tests that inject only a fake adapter, or environments
 *     where the loader deliberately omitted the compiled module to
 *     exercise the fallback), the payload carries the EXACT
 *     prevalidated bytes the loader returned. The worklet compiles
 *     these ONCE in its message handler before graph activation.
 *
 * Returns `null` when neither path is available (e.g. the loader
 * produced neither a compiled module nor stashed bytes). The caller
 * MUST skip the transfer in that case — the worklet cannot install
 * "nothing".
 *
 * The returned payload NEVER carries both `module` and `wasmBytes`;
 * that would violate the EXACTLY ONE rule and the worklet would
 * refuse installation.
 *
 * Exported for direct unit testing.
 */
export function buildModuleTransferPayload(
  descriptor: NodeDefDescriptor,
  compiledWasm: WebAssembly.Module | null,
  wasmBytes?: Uint8Array,
): WorkletModuleTransferMessage | null {
  const header = {
    type: "nodedef-module" as const,
    descriptor: {
      name: descriptor.name,
      version: descriptor.version,
    },
  };

  // VAL-CROSS-002 integration fix: prefer `wasmBytes` when available.
  // While WebAssembly.Module is structured-cloneable per the Web IDL
  // spec, some Chromium/headless AudioWorklet implementations silently
  // drop messages whose payload includes a WebAssembly.Module object.
  // Sending the EXACT prevalidated bytes lets the worklet compile them
  // once in its own scope (VAL-ENGINE-008 fallback path), which is
  // reliable across all browser implementations. The bytes are already
  // validated by the main-thread compile; the worklet's compile is a
  // pure re-compilation of the same artefact.
  if (typeof wasmBytes !== "undefined" && wasmBytes !== null) {
    return { ...header, wasmBytes };
  }

  if (compiledWasm !== null) {
    // Structured-cloned compiled module path. Used only when the
    // loader did not return source bytes (e.g. a test loader that
    // injects only a compiled module). The worklet reuses the
    // supplied module without recompiling (VAL-ENGINE-008).
    return { ...header, module: compiledWasm };
  }

  // Neither path available; caller must skip the transfer.
  return null;
}

/**
 * Default NodeDef descriptors loaded on engine bring-up. The M1 vertical
 * slice loads only `osc/sine`; future features extend the static registry.
 */
function defaultNodeDefDescriptors(): readonly NodeDefDescriptor[] {
  const oscSine = findNodeDefDescriptor("osc/sine", 1);
  if (oscSine === null) {
    throw new SynthesisServiceError(
      "osc/sine v1 is missing from the NodeDef registry",
    );
  }
  return [oscSine];
}

// ---------------------------------------------------------------------------
// Devmode-only fault surface (re-exported for the bootstrap wiring)
// ---------------------------------------------------------------------------

/**
 * Install the synthesis devmode surface on `globalThis` (window). The
 * wiring calls this only when `startupFlags.devmode === true`.
 *
 * The installed object exposes:
 *   - `getTelemetry()` — returns the latest frozen telemetry snapshot;
 *   - `terminateProducer()` — controlled fault action (VAL-HOST-012);
 *   - `reinitialise()` — recovery affordance (VAL-HOST-012).
 *
 * Outside devmode, the surface is never installed and the global stays
 * `undefined`. Production builds ship no fault actions.
 */
export interface SynthesisDevmodeSurface {
  getTelemetry(): SynthesisTelemetrySnapshot;
  terminateProducer(): boolean;
  reinitialise(): Promise<boolean>;
}

/**
 * Build the devmode surface around a synthesis service.
 *
 * Bootstrap wiring calls this when `devmode === true` and installs the
 * result on `window.__useqSynthesisDev`. Tests use the same factory to
 * assert that the fault actions are exposed exactly when devmode is on.
 */
export function createSynthesisDevmodeSurface(
  service: SynthesisService,
): SynthesisDevmodeSurface {
  return Object.freeze({
    getTelemetry() {
      return service.telemetry;
    },
    terminateProducer() {
      return service.devmodeTerminateProducer();
    },
    reinitialise() {
      return service.devmodeReinitialise();
    },
  });
}

/**
 * Re-export the artefact payload type so callers can avoid reaching into
 * `runtimeTypes` directly.
 */
export type { SynthArtifactsPayload };
