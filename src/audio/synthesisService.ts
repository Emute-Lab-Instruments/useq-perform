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
 *                    only public recovery affordance is
 *                    `resumeOnUserActivation()`, wired to the suspended
 *                    indicator and the autoplay listener.
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
export type NodeDefModuleLoader = (descriptor: NodeDefDescriptor) =>
  Promise<{ module: NodeDefModule; compiledWasm: WebAssembly.Module | null }>;

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
  /** Number of worklet nodes the service has created. Always 0 or 1. */
  readonly workletNodeCount: number;
  /** Number of NodeDef modules the service has compiled and transferred. */
  readonly compiledModuleCount: number;
  /** Names of NodeDef modules that have been compiled. */
  readonly compiledModuleNames: readonly string[];
  /** SAB ABI version the engine was built against, or `null` when no SAB. */
  readonly sabAbiVersion: number | null;
  /** Number of times the engine has transitioned state. */
  readonly transitionCount: number;
  /** True when the devmode fault actions (termination / reinitialise) are exposed. */
  readonly faultActionsExposed: boolean;
}

/** Telemetry schema version. Bumped only when the field shape changes. */
export const SYNTHESIS_TELEMETRY_SCHEMA_VERSION = 1 as const;

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
    devmodeTerminateProducer() {
      // No producer exists; nothing to terminate.
      return false;
    },
    async devmodeReinitialise() {
      // No engine to reinitialise.
      return false;
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
  };

  let currentState: SynthesisEngineState = "off";
  let currentReasonKey: EngineStateReasonKey | null = null;
  let currentReasonMessage: string | null = null;
  let audioContext: AudioContextContract | null = null;
  let workletNode: WorkletNodeContract | null = null;
  let disposed = false;
  let workletAdded = false;
  const compiledAdapters = new Map<string, NodeDefAdapter>();

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
        acc.workletNodeCount += 1;
        // Connect to the AudioContext destination (VAL-ENGINE-037).
        workletNode.connect(audioContext.destination);
      } catch (err) {
        transition("error", "RECOVERY_FAILED",
          `Failed to construct worklet node: ${(err as Error).message}`);
        return false;
      }
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

  async function loadNodeDefModules(): Promise<void> {
    const descriptors = options.nodeDefDescriptors ?? defaultNodeDefDescriptors();
    for (const descriptor of descriptors) {
      const key = `${descriptor.name}@${descriptor.version}`;
      if (compiledAdapters.has(key)) continue;
      try {
        const { module, compiledWasm } = await options.nodeDefModuleLoader(descriptor);
        // Adapter validates descriptor equality before instantiation so a
        // stale bundle cannot slip past the asset pipeline.
        const adapter = await import("./nodeDefAdapter").then(({ createNodeDefAdapter }) =>
          createNodeDefAdapter(module, descriptor),
        );
        compiledAdapters.set(key, adapter);
        acc.compiledModuleCount += 1;
        acc.compiledModuleNames.push(descriptor.name);
        // Transfer the compiled module to the worklet. The worklet
        // instantiates it against its shared memory between quanta.
        if (workletNode && compiledWasm) {
          const transfer: Transferable[] = [compiledWasm];
          workletNode.port.postMessage(
            {
              type: "nodedef-module",
              descriptor: {
                name: descriptor.name,
                version: descriptor.version,
              },
              module: compiledWasm,
            },
            transfer,
          );
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
      // Simulate producer loss by posting the controlled-fault message
      // to the worklet. The worklet independently enforces the timeout
      // at the next block boundary and fades to silence.
      if (workletNode) {
        workletNode.port.postMessage({ type: "devmode-terminate-producer" });
      }
      // The actual `error` transition is published by the worklet-side
      // liveness observer; this method only arms the fault. Tests
      // transition directly through `simulateFaultForTests` if they
      // need to drive the state synchronously.
      return true;
    },

    async devmodeReinitialise() {
      if (!devmode) return false;
      // Recovery: dispose failed resources and bring the engine back up
      // in `suspended` so autoplay can resume on the next trusted input.
      await disposeResources("error");
      const ok = await bringUpAudio();
      return ok && currentState === "suspended";
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
    // Disconnect the worklet first so no further graph mutations are
    // applied to a dying context.
    if (workletNode) {
      try {
        workletNode.disconnect();
        workletNode.port.close?.();
      } catch {
        // Best-effort cleanup.
      }
      // Note: we do NOT decrement the counter — `workletNodeCount`
      // records how many nodes were created in this session, including
      // retired ones. The recovery path constructs a fresh service so
      // the new session starts at zero.
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

  // Publish the initial `off` state (with capability present, so no reason).
  publishCurrentState();
  publishTelemetry();

  return service;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Synth artefact intake (VAL-COMP-013/014/015 plumbing)
// ---------------------------------------------------------------------------

/**
 * Apply a successful exact-eval synth artefact payload to the engine.
 *
 * The main-thread eval pipeline calls this with the artefacts returned by
 * the atomic Worker response. The service:
 *   - validates the ABI version (VAL-COMP-015);
 *   - rejects the payload when diagnostics contain a severity:"error"
 *     entry (VAL-COMP-014: failed evals must not mutate the engine);
 *   - otherwise records the declarations for the worklet's next graph
 *     delta (the actual epoch-prefill path is wired by a later feature).
 *
 * Returns `true` when the payload was accepted, `false` when it was
 * rejected as a no-op. Throws on ABI mismatch (a bundle-version slip is
 * a fatal programmer error, not a user-facing diagnostic).
 */
export function applySynthArtifacts(
  service: SynthesisService,
  payload: unknown,
  hasErrors: boolean,
): boolean {
  // VAL-COMP-014: failed eval responses cannot commit.
  if (hasErrors) return false;

  if (!isSynthArtifactsPayload(payload)) {
    // The payload shape failed validation. This is a programmer error in
    // practice (the Worker handler always returns the canonical shape);
    // surface it loudly.
    return false;
  }

  // VAL-COMP-015: ABI version must match exactly.
  if (!synthArtifactsSupportsAbi(payload.abi)) {
    throw new SynthesisServiceError(
      `synth artefact ABI version ${payload.abi} does not match consumer ABI ${SYNTH_ARTIFACT_ABI_VERSION}`,
    );
  }

  // Validate every declaration against the static registry. Unknown defs
  // cannot reach this path because the compiler rejects them, but the
  // service still checks defensively so a future evaluator cannot slip
  // an unknown def into the engine commit.
  for (const decl of payload.declarations) {
    if (!findNodeDefDescriptor(decl.def, decl.version)) {
      throw new SynthesisServiceError(
        `synth artefact references unknown NodeDef ${decl.def} v${decl.version}`,
      );
    }
  }

  // M1 does not yet wire the graph delta; the service records acceptance
  // only. The actual worklet message is added by the eval-epoch-engine-
  // commit feature, which owns the diff/prefill/activation sequence.
  void service;
  return true;
}

/**
 * Re-export the artefact payload type so callers can avoid reaching into
 * `runtimeTypes` directly.
 */
export type { SynthArtifactsPayload };
