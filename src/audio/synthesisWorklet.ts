/**
 * AudioWorkletProcessor shell for the synthesis engine.
 *
 * Fulfils (see mission feature `m1-worklet-host-and-epoch-consumer`):
 *   VAL-ENGINE-037 — the single synthesis AudioWorkletNode connects
 *                    through the declared engine output path to
 *                    `AudioContext.destination`.
 *   VAL-ENGINE-009 — graph changes happen at block boundaries. The
 *                    processor delegates all logic to the testable
 *                    {@link WorkletCore}; this file is a thin shell
 *                    that bridges Web Audio globals to the core.
 *
 * Architecture notes:
 *
 * - This file is loaded by `audioContext.audioWorklet.addModule()`.
 *   It runs in the `AudioWorkletGlobalScope` and has access to
 *   `sampleRate`, `currentFrame`, and the `AudioWorkletProcessor` base
 *   class. It does NOT have access to `window`, `document`, or
 *   `performance.now()`.
 *
 * - The shell constructs a {@link WorkletCore} on instantiation and
 *   delegates every `process()` call to it. The core is browser-global-
 *   free, so the same logic runs unchanged in Vitest.
 *
 * - All allocation happens at construction (between quanta). The
 *   steady-state `process()` path performs zero allocation.
 *
 * - The processor exposes the SAB to the core via the injected
 *   allocator; NodeDef WASM modules arrive via port messages and are
 *   compiled off-thread before transfer.
 *
 * Build pipeline:
 *
 * - The asset pipeline bundles this file plus its dependencies
 *   (`workletCore.ts`, `synthesisControlAbi.ts`, `nodeDefAdapter.ts`)
 *   into a single self-contained script emitted at
 *   `public/wasm/synthesisWorklet.js`.
 * - The bundle is consumed by `audioContext.audioWorklet.addModule()`
 *   which evaluates it in the AudioWorkletGlobalScope.
 * - In tests, the same module is imported with mocked
 *   `AudioWorkletProcessor`/`registerProcessor` globals.
 */

/// <reference lib="webworker" />

import {
  createWorkletCore,
  type WorkletCore,
  type WorkletMemoryAllocator,
} from "./workletCore";
import { createZoneAllocator } from "./workletZoneAllocator";
import { SYNTH_MEMORY_MAX_BYTES } from "../contracts/synthesisControlAbi";
import {
  createNodeDefAdapter,
  readNodeDefRuntimeDescriptor,
  type NodeDefAdapter,
} from "./nodeDefAdapter";
import {
  NODEDEF_REGISTRY,
  type NodeDefDescriptor,
} from "../contracts/nodeDefRegistry";
import {
  classifyModuleTransfer,
  type WorkletModuleTransferMessage,
  type WorkletModuleTransferKind,
  type WorkletOutboundEvent,
} from "./workletGraphDelta";

// ---------------------------------------------------------------------------
// Ambient worklet-scope globals
// ---------------------------------------------------------------------------

/**
 * The `AudioWorkletProcessor` base class available only inside the
 * AudioWorkletGlobalScope. Outside the worklet (e.g. in Vitest) this
 * is `undefined`; the self-registration call below is a no-op in that
 * case.
 */
declare const AudioWorkletProcessor: {
  new (options?: AudioWorkletNodeOptions): AudioWorkletProcessorInstance;
};

/**
 * The `registerProcessor` global available only inside the
 * AudioWorkletGlobalScope.
 */
declare const registerProcessor: (
  name: string,
  ctor: new (options?: AudioWorkletNodeOptions) => AudioWorkletProcessorInstance,
) => void;

/**
 * The `sampleRate` global available inside the AudioWorkletGlobalScope.
 */
declare const sampleRate: number | undefined;

/** Minimal processor instance shape the shell uses. */
interface AudioWorkletProcessorInstance {
  readonly port: {
    postMessage(message: unknown, transfer?: Transferable[]): void;
    onmessage: ((event: { data: unknown }) => void) | null;
    close?(): void;
  };
}

// ---------------------------------------------------------------------------
// Processor name
// ---------------------------------------------------------------------------

/** The AudioWorkletNode processor name the synthesis service registers. */
export const SYNTHESIS_PROCESSOR_NAME = "synthesis-processor";

/**
 * Drain the pending outbound-event queue by posting each event and
 * truncating IN PLACE. The worklet core's `publish` closure captures
 * the exact array instance, so replacing the array (`bag.pendingEvents
 * = []`) would silently orphan every event published after the first
 * drain — producer-timeout would never reach the service (the c7edc263
 * class of bug). Exported so tests can pin the in-place semantics.
 */
export function drainPendingEvents(
  pending: WorkletOutboundEvent[],
  post: (event: WorkletOutboundEvent) => void,
): void {
  if (pending.length === 0) return;
  for (const evt of pending) {
    post(evt);
  }
  pending.length = 0;
}

/**
 * Build the descriptor lookup map from the static M1 registry. Exposed
 * so tests can construct a cache against the same map without touching
 * worklet-global scope.
 */
export function buildNodeDefDescriptorMap(): ReadonlyMap<string, NodeDefDescriptor> {
  const descriptors = new Map<string, NodeDefDescriptor>();
  for (const desc of NODEDEF_REGISTRY) {
    descriptors.set(`${desc.name}@${desc.version}`, desc);
  }
  return descriptors;
}

// ---------------------------------------------------------------------------
// Per-processor bag (the state the shell threads through every process())
// ---------------------------------------------------------------------------

/**
 * Per-processor mutable state. Allocated once at construction (between
 * quanta); reused on every process() call.
 *
 * - `core` is the testable worklet core that owns all process logic.
 * - `outputScratch` is the Float32Array the core writes into; the
 *   shell copies it into the Web Audio output channel.
 */
interface ProcessorBag {
  readonly core: WorkletCore;
  readonly outputScratch: Float32Array;
  outputGain: number;
  /**
   * Outbound discrete-event queue. The worklet core publishes events
   * (e.g. `producer-timeout`, `graph-activated`, `instance-retired`)
   * via its `publish` callback. The shell accumulates them here and
   * drains the queue on every `process()` call alongside the
   * telemetry snapshot, so the main-thread synthesis service receives
   * the same evidence in real Chromium that the simulated worklet
   * core delivers in tests.
   *
   * VAL-ENGINE-026 / Ergo bug c7edc263: pre-fix the shell's publish
   * callback was a no-op, so the discrete `producer-timeout` event
   * never reached the main thread and the engine never transitioned
   * to `error` in real headless Chromium. The snapshot-driven
   * detection added to `synthesisService.ts` makes the transition
   * provable without depending on this queue, but forwarding the
   * events preserves the documented audit trail for dashboards.
   */
  pendingEvents: WorkletOutboundEvent[];
  /**
   * Install a NodeDef module transferred from the main thread. The
   * shell instantiates the WASM module against the worklet's shared
   * memory and caches the resulting adapter. VAL-ENGINE-008:
   * compilation (when the payload carries the exact-byte fallback)
   * happens here, in the message handler, before graph activation —
   * NEVER inside `process()`.
   */
  installModule(payload: WorkletModuleTransferMessage): Promise<void>;
  /**
   * Number of WebAssembly.compile invocations recorded for a def.
   * Used by tests to prove the fallback path fires at most once per
   * def and that steady state never compiles.
   */
  compileCountFor(name: string, version: number): number;
  /**
   * Number of installation payloads received for a def. Used by
   * tests to prove the VAL-ENGINE-008 exactly-one rule.
   */
  installCountFor(name: string, version: number): number;
  /**
   * Classification of the most recent transfer for a def. Used by
   * tests to assert structured-cloned module vs exact-byte fallback.
   */
  lastTransferKindFor(name: string, version: number): WorkletModuleTransferKind | null;
}

// ---------------------------------------------------------------------------
// Allocator (host-owned zone arena inside a WebAssembly.Memory)
// ---------------------------------------------------------------------------

/**
 * Create the host-owned zone allocator over a fresh `WebAssembly.Memory`
 * (synthesis epic M2.1; `synthesis.md` §2.3, §3.5). Per-instance state
 * and output zones are allocated on instantiate and released by the
 * retire-sweep; freed zones coalesce and are reused, and the arena is
 * bounded by `SYNTH_MEMORY_MAX_BYTES` — exhaustion yields a diagnostic,
 * never unbounded growth.
 *
 * The memory's initial page count must satisfy the NodeDef WASM
 * module's imported `env.memory` limits descriptor, which for osc/sine
 * declares 256 initial pages (16 MiB). The maximum matches so the
 * worklet does not need to grow the memory at runtime.
 */
export function createWorkletAllocator(): WorkletMemoryAllocator & {
  readonly memory: WebAssembly.Memory;
} {
  // VAL-CROSS-002: the NodeDef module declares env.memory with
  // initial=256 pages. A smaller memory fails instantiation with
  // "memory import has N pages which is smaller than the declared
  // initial of 256".
  const initialPages = 256;
  const memory = new WebAssembly.Memory({ initial: initialPages, maximum: initialPages });
  const zones = createZoneAllocator({
    limitBytes: Math.min(memory.buffer.byteLength, SYNTH_MEMORY_MAX_BYTES),
  });
  return {
    memory,
    allocate: (bytes: number, align: number) => zones.allocate(bytes, align),
    release: (pointer: number) => zones.release(pointer),
  };
}

// ---------------------------------------------------------------------------
// Module-transfer bridge
// ---------------------------------------------------------------------------

/**
 * Adapter cache return type — exposed for direct unit testing of the
 * VAL-ENGINE-008 contract (compile counts, install counts, transfer
 * classification) without spinning up an AudioWorkletProcessor.
 */
export interface AdapterCache {
  factory: (name: string, version: number) => NodeDefAdapter | null;
  install(payload: WorkletModuleTransferMessage): Promise<void>;
  compileCount(name: string, version: number): number;
  installCount(name: string, version: number): number;
  lastTransferKind(name: string, version: number): WorkletModuleTransferKind | null;
}

/**
 * Cache of instantiated NodeDef adapters keyed by `name@version`. The
 * adapter factory passed to the core looks up this cache.
 *
 * When a {@link WorkletModuleTransferMessage} arrives the shell
 * instantiates the transferred `WebAssembly.Module` against the
 * worklet's shared memory, builds the adapter via
 * {@link createNodeDefAdapter}, and caches it.
 *
 * VAL-CROSS-002 integration: this bridge was stubbed in the worklet
 * host feature. The integration worker wires it end-to-end so the
 * `(synth "osc/sine" :freq 440)` form actually drives DSP output.
 *
 * VAL-ENGINE-008: the WASM module is compiled on the main thread and
 * transferred to the worklet via postMessage; the worklet reuses the
 * supplied module without recompiling. Instantiation happens here,
 * between quanta, in the message handler — never inside `process()`.
 *
 * The contract permits EXACTLY ONE installation payload per def. The
 * payload carries EITHER a structured-cloned `WebAssembly.Module` OR
 * the EXACT prevalidated bytes the main thread compiled from (never
 * both, never neither). When bytes are supplied, the worklet compiles
 * them ONCE in this message handler before graph activation; the
 * resulting module is reused for every subsequent instantiation.
 *
 * Compilation counters are tracked per-def so tests can prove the
 * fallback path fires at most once and that process() / steady state
 * never invoke WebAssembly.compile.
 */
export function createAdapterCache(
  memory: WebAssembly.Memory,
  descriptors: ReadonlyMap<string, NodeDefDescriptor>,
  renderSampleRate: number,
): AdapterCache {
  const cache = new Map<string, NodeDefAdapter>();
  const compiles = new Map<string, number>();
  const installs = new Map<string, number>();
  const transferKinds = new Map<string, WorkletModuleTransferKind>();

  const keyFor = (name: string, version: number) => `${name}@${version}`;

  return {
    factory(name, version) {
      return cache.get(keyFor(name, version)) ?? null;
    },
    async install(payload) {
      const key = keyFor(payload.descriptor.name, payload.descriptor.version);
      // VAL-ENGINE-008: exactly ONE installation payload per def is
      // honoured. Receiving a second payload for the same def is a
      // contract violation by the main thread; the worklet refuses
      // the duplicate so the cached adapter (built from the first,
      // prevalidated payload) stays authoritative.
      installs.set(key, (installs.get(key) ?? 0) + 1);
      if (cache.has(key)) return;
      const descriptor = descriptors.get(key);
      if (!descriptor) {
        // Unknown def. The main thread should not have transferred a
        // module the registry does not know about; ignore it so the
        // worklet keeps running.
        return;
      }
      // VAL-ENGINE-008: enforce EXACTLY ONE of (module | bytes). A
      // payload that carries both or neither is malformed; refuse
      // installation so the worklet keeps running with no def rather
      // than crashing the audio thread.
      const kind = classifyModuleTransfer({
        module: payload.module,
        wasmBytes: payload.wasmBytes,
      });
      transferKinds.set(key, kind);
      if (kind === "malformed") {
        // Malformed payload: refuse installation.
        return;
      }
      // Instantiate the WASM module against the worklet's shared
      // memory. The module imports `env.memory`; we supply the
      // worklet's existing memory so per-instance state zones live
      // in the same linear memory the host adapter addresses.
      const importObject = { env: { memory } };
      let moduleObj: WebAssembly.Module | undefined = payload.module;
      if (!moduleObj && payload.wasmBytes) {
        // VAL-ENGINE-008 fallback path: the main thread could not
        // (or chose not to) ship a structured-cloned
        // WebAssembly.Module. Compile the EXACT prevalidated bytes
        // ONCE here, in the message handler, before graph
        // activation. The resulting module is cached on `cache` via
        // the adapter factory so subsequent instantiations reuse it
        // without recompiling.
        compiles.set(key, (compiles.get(key) ?? 0) + 1);
        moduleObj = await WebAssembly.compile(
          payload.wasmBytes as Uint8Array<ArrayBuffer>,
        );
      }
      if (!moduleObj) {
        return;
      }
      const instance = await WebAssembly.instantiate(moduleObj, importObject);
      const exports = instance.exports as Record<string, WebAssembly.ExportValue>;
      const defPrefix = `${descriptor.name.replace("/", "_")}_`;
      const lookup = (name: string): ((...args: number[]) => number) | undefined => {
        const prefixed = exports[`${defPrefix}${name}`];
        if (typeof prefixed === "function") {
          return prefixed as (...args: number[]) => number;
        }
        const direct = exports[name];
        if (typeof direct === "function") {
          return direct as (...args: number[]) => number;
        }
        const underscored = exports[`_${name}`];
        if (typeof underscored === "function") {
          return underscored as (...args: number[]) => number;
        }
        return undefined;
      };
      // Re-read the exact transferred module's own descriptor inside this
      // WebAssembly.Instance. The static registry selects the expected def;
      // it is not a fallback for missing or malformed module metadata.
      const runtimeDescriptor = readNodeDefRuntimeDescriptor(memory, lookup);
      const module = { lookup, runtimeDescriptor };
      const adapter = createNodeDefAdapter(module, descriptor, renderSampleRate);
      cache.set(key, adapter);
    },
    compileCount(name, version) {
      return compiles.get(keyFor(name, version)) ?? 0;
    },
    installCount(name, version) {
      return installs.get(keyFor(name, version)) ?? 0;
    },
    lastTransferKind(name, version) {
      return transferKinds.get(keyFor(name, version)) ?? null;
    },
  };
}

// ---------------------------------------------------------------------------
// Shell factory
// ---------------------------------------------------------------------------

/**
 * Construct the per-processor bag. Called once from the processor
 * constructor (between quanta). Allocates the core, the output scratch,
 * the shared-memory allocator, and the NodeDef adapter cache.
 *
 * The adapter cache is wired to the core's `adapterFactory`. When the
 * main thread posts a `nodedef-module` message the shell instantiates
 * the WASM module against the worklet's shared memory, builds an
 * adapter via {@link createNodeDefAdapter}, and caches it so the
 * adapter factory can resolve it on the next instantiate delta.
 */
function createProcessorBag(): ProcessorBag {
  const allocatorWithMemory = createWorkletAllocator();
  const rate = typeof sampleRate === "number" ? sampleRate : 48000;

  // Build a descriptor lookup keyed by `name@version` from the static
  // M1 registry. Future features that dynamically register defs will
  // extend this map.
  const descriptors = buildNodeDefDescriptorMap();
  const adapterCache = createAdapterCache(
    allocatorWithMemory.memory,
    descriptors,
    rate,
  );

  // VAL-CROSS-002 integration: control scratch buffers live INSIDE the
  // host-owned WebAssembly.Memory. The WASM compute call receives these
  // views' byte offsets as pointers; the adapter reads the control
  // doubles directly from the same memory the core writes into.
  //
  // Per-instance DSP output zones are allocated by the worklet core
  // itself through the zone allocator (synthesis epic M2.1) and viewed
  // through `createArenaView` below — the core owns zone sizing, growth
  // (ergo 10271a1d), and release; the shell no longer preallocates a
  // fixed single-instance scratch.
  const freqControlScratchPtr = allocatorWithMemory.allocate(8, 8);
  const ampControlScratchPtr = allocatorWithMemory.allocate(8, 8);
  if (freqControlScratchPtr < 0 || ampControlScratchPtr < 0) {
    throw new Error(
      "synthesisWorklet: failed to allocate control scratch regions in host WebAssembly.Memory",
    );
  }
  const wasmBuffer = allocatorWithMemory.memory.buffer;
  const freqControlScratch = new Float64Array(wasmBuffer, freqControlScratchPtr, 1);
  const ampControlScratch = new Float64Array(wasmBuffer, ampControlScratchPtr, 1);

  // Outbound discrete-event queue. The worklet core publishes events
  // via its `publish` callback; the shell drains the queue on every
  // process() call alongside the telemetry snapshot. The queue is
  // declared before the core so the closure captures the same
  // reference the bag returns.
  const pendingEvents: WorkletOutboundEvent[] = [];

  const core = createWorkletCore({
    adapterFactory: (name, version) => adapterCache.factory(name, version),
    allocator: allocatorWithMemory,
    sampleRate: rate,
    publish: (msg) => {
      // Per-quantum telemetry snapshots are posted by process() via
      // its return value (the shell reads `core.telemetry`). Discrete
      // events (producer-timeout, graph-activated, instance-retired)
      // land here and are queued for the next process() drain so the
      // main-thread service receives the same evidence in real
      // Chromium that the simulated worklet core delivers in tests.
      //
      // VAL-ENGINE-026 / Ergo bug c7edc263: pre-fix this callback was
      // a no-op, so producer-loss events never reached the main
      // thread in production. Forwarding them here preserves the
      // audit trail even though the snapshot-driven transition in
      // synthesisService.ts is the authoritative source.
      pendingEvents.push(msg as WorkletOutboundEvent);
    },
    createArenaView: (byteOffset, lengthDoubles) =>
      new Float64Array(allocatorWithMemory.memory.buffer, byteOffset, lengthDoubles),
    freqControlScratch,
    ampControlScratch,
  });

  return {
    core,
    outputScratch: new Float32Array(128),
    outputGain: 1,
    pendingEvents,
    installModule: (payload) => adapterCache.install(payload),
    compileCountFor: (name, version) => adapterCache.compileCount(name, version),
    installCountFor: (name, version) => adapterCache.installCount(name, version),
    lastTransferKindFor: (name, version) => adapterCache.lastTransferKind(name, version),
  };
}

// ---------------------------------------------------------------------------
// Registration (runs at worklet load)
// ---------------------------------------------------------------------------

/**
 * Register the synthesis processor when running in the AudioWorklet
 * scope. No-op in Node/Vitest.
 *
 * Exposed as an exported function so tests can assert it does not throw
 * when the globals are absent.
 */
export function registerSynthesisProcessor(): void {
  if (typeof registerProcessor !== "function") return;
  if (typeof AudioWorkletProcessor !== "function") return;

  class SynthesisProcessor extends AudioWorkletProcessor {
    private bag: ProcessorBag | null;
    private moduleInstallChain: Promise<void> = Promise.resolve();

    constructor(options?: AudioWorkletNodeOptions) {
      super(options);
      this.bag = createProcessorBag();

      this.port.onmessage = (event: { data: unknown }) => {
        const bag = this.bag;
        if (!bag) return;
        const data = event.data;
        // Intercept NodeDef module transfers. The main thread posts
        // these after compiling the WASM off-thread (VAL-ENGINE-008);
        // the shell instantiates the module against the worklet's
        // shared memory and caches the resulting adapter. The core's
        // adapter factory resolves the cache on the next instantiate
        // delta. Other messages flow through to the core unchanged.
        if (
          data &&
          typeof data === "object" &&
          (data as { type?: string }).type === "nodedef-module"
        ) {
          const payload = data as WorkletModuleTransferMessage;
          // Install is async (WebAssembly.instantiate returns a
          // promise) but the worklet's message handler must not block.
          // The install races against the next instantiate delta; if
          // the instantiate arrives first the adapter factory returns
          // null and the core holds the delta as pending until the
          // next matching-epoch block.
          //
          // VAL-ENGINE-008: this is the ONLY site where
          // WebAssembly.compile may run in the worklet scope. The
          // fallback path compiles the EXACT prevalidated bytes ONCE
          // before graph activation; subsequent process() calls reuse
          // the cached adapter without recompiling.
          this.moduleInstallChain = this.moduleInstallChain.then(() => bag.installModule(payload));
          return;
        }
        if (
          data &&
          typeof data === "object" &&
          (data as { type?: string }).type === "prepare-graph"
        ) {
          // A prepare acknowledgement is meaningful only after every earlier
          // module transfer is installed. Serialising here closes the async
          // module-transfer race without ever compiling in process().
          void this.moduleInstallChain.then(() => {
            const currentBag = this.bag;
            if (!currentBag) return;
            currentBag.core.handleMessage(data);
            drainPendingEvents(currentBag.pendingEvents, (evt) => this.port.postMessage(evt));
          });
          return;
        }
        bag.core.handleMessage(data);
        // Flush events the handler just published (notably the
        // `attach-control-buffer-ack`, synthesis.md §4.8) immediately.
        // Waiting for the next process() drain would deadlock the ack
        // against a suspended AudioContext: attach happens during
        // bring-up, before any render quantum runs, and the service
        // fails closed into `error` when the ack misses its deadline.
        // This runs between quanta, so posting here does not touch the
        // steady-state render path.
        drainPendingEvents(bag.pendingEvents, (evt) => this.port.postMessage(evt));
      };
    }

    process(
      _inputs: Float32Array[][],
      outputs: Float32Array[][],
      _parameters: Record<string, Float32Array>,
    ): boolean {
      const bag = this.bag;
      if (!bag) return true;

      const output = outputs[0];
      if (!output || output.length === 0) return true;
      const channel = output[0];
      if (!channel) return true;

      const frameCount = channel.length;
      bag.core.process(frameCount);

      // VAL-ENGINE-037: copy the core's rendered output into the Web
      // Audio channel that connects to `AudioContext.destination`. The
      // core writes its DSP output into an internal scratch buffer; the
      // shell reads it back through `readOutput()` and copies the
      // samples into the Web Audio output channel.
      //
      // Web Audio zero-fills the channel before each process() call, so
      // when the core produces silence (no active instance, post-fade,
      // or producer timeout) the destination receives exact zero
      // without any special handling.
      const coreOutput = bag.core.readOutput();
      const gain = bag.outputGain;
      if (gain === 1) {
        // Fast path: straight copy, no per-sample multiply.
        for (let i = 0; i < frameCount; i++) {
          channel[i] = coreOutput[i];
        }
      } else {
        for (let i = 0; i < frameCount; i++) {
          channel[i] = coreOutput[i] * gain;
        }
      }

      // Steady-state telemetry is written into the shared control
      // header by the core (process() step 8) and read by the service
      // via `attachSynthesisControlView`; no per-quantum snapshot is
      // allocated or posted here (b3895dbe). Only discrete events
      // cross the port.

      // Drain discrete events (producer-timeout, graph-activated,
      // instance-retired) that the core queued via its `publish`
      // callback since the last process(). The queue length is bounded
      // by the worklet core's own dedup guards.
      //
      // VAL-ENGINE-026 / Ergo bug c7edc263: pre-fix the shell dropped
      // these events, so producer-loss never reached the main thread
      // in real Chromium. With per-quantum snapshots gone (b3895dbe)
      // this event path IS the service's producer-loss signal.
      drainPendingEvents(bag.pendingEvents, (evt) => this.port.postMessage(evt));
      return true;
    }
  }

  registerProcessor(SYNTHESIS_PROCESSOR_NAME, SynthesisProcessor);
}

// Auto-register when loaded in the AudioWorklet scope. In Node/Vitest
// the globals are absent and this is a no-op.
registerSynthesisProcessor();
