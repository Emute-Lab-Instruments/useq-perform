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
import {
  createNodeDefAdapter,
  type NodeDefAdapter,
} from "./nodeDefAdapter";
import {
  NODEDEF_REGISTRY,
  type NodeDefDescriptor,
} from "../contracts/nodeDefRegistry";

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
   * Install a NodeDef module transferred from the main thread. The
   * shell instantiates the WASM module against the worklet's shared
   * memory and caches the resulting adapter.
   */
  installModule(payload: WorkletModuleTransferShim): Promise<void>;
}

// ---------------------------------------------------------------------------
// Allocator (host-owned bump arena inside a WebAssembly.Memory)
// ---------------------------------------------------------------------------

/**
 * Create a bump allocator over a fresh `WebAssembly.Memory`. M1 has
 * exactly one osc/sine instance (24-byte state zone), so the state
 * allocation itself is tiny. The memory's initial page count must
 * satisfy the NodeDef WASM module's imported `env.memory` limits
 * descriptor, which for osc/sine declares 256 initial pages
 * (16 MiB). The maximum matches so the worklet does not need to grow
 * the memory at runtime.
 */
function createWorkletAllocator(): WorkletMemoryAllocator & {
  readonly memory: WebAssembly.Memory;
} {
  // VAL-CROSS-002: the NodeDef module declares env.memory with
  // initial=256 pages. A smaller memory fails instantiation with
  // "memory import has N pages which is smaller than the declared
  // initial of 256".
  const initialPages = 256;
  const memory = new WebAssembly.Memory({ initial: initialPages, maximum: initialPages });
  let offset = 0;
  return {
    memory,
    allocate(bytes: number, align: number) {
      const mask = align - 1;
      const aligned = (offset + mask) & ~mask;
      if (aligned + bytes > memory.buffer.byteLength) return -1;
      offset = aligned + bytes;
      return aligned;
    },
    release(_pointer: number) {
      // Bump arena: release is a no-op for M1. Real zone allocators
      // return memory to a free list; the single long-lived instance
      // does not need reclamation in steady state.
    },
  };
}

// ---------------------------------------------------------------------------
// Module-transfer bridge
// ---------------------------------------------------------------------------

/**
 * Cache of instantiated NodeDef adapters keyed by `name@version`. The
 * adapter factory passed to the core looks up this cache.
 *
 * When a {@link WorkletModuleTransferShim} arrives the shell
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
 */
function createAdapterCache(
  memory: WebAssembly.Memory,
  descriptors: ReadonlyMap<string, NodeDefDescriptor>,
): {
  factory: (name: string, version: number) => NodeDefAdapter | null;
  install(payload: WorkletModuleTransferShim): Promise<void>;
} {
  const cache = new Map<string, NodeDefAdapter>();

  return {
    factory(name, version) {
      const key = `${name}@${version}`;
      return cache.get(key) ?? null;
    },
    async install(payload) {
      const key = `${payload.descriptor.name}@${payload.descriptor.version}`;
      if (cache.has(key)) return;
      const descriptor = descriptors.get(key);
      if (!descriptor) {
        // Unknown def. The main thread should not have transferred a
        // module the registry does not know about; ignore it so the
        // worklet keeps running.
        return;
      }
      // Instantiate the WASM module against the worklet's shared
      // memory. The module imports `env.memory`; we supply the
      // worklet's existing memory so per-instance state zones live
      // in the same linear memory the host adapter addresses.
      //
      // Some Chromium versions silently drop WebAssembly.Module across
      // the AudioWorklet MessagePort even though the spec permits
      // structured clone. When the module is absent but raw bytes are
      // supplied, recompile in the worklet scope.
      const importObject = { env: { memory } };
      let moduleObj: WebAssembly.Module | undefined = payload.module;
      if (!moduleObj && payload.wasmBytes) {
        moduleObj = await WebAssembly.compile(payload.wasmBytes as Uint8Array<ArrayBuffer>);
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
      const module = { lookup, runtimeDescriptor: descriptor };
      const adapter = createNodeDefAdapter(module, descriptor);
      cache.set(key, adapter);
    },
  };
}

/** Shim for the module-transfer payload (mirrors the message type). */
interface WorkletModuleTransferShim {
  readonly descriptor: { readonly name: string; readonly version: number };
  readonly module?: WebAssembly.Module;
  readonly wasmBytes?: Uint8Array;
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
  const descriptors = new Map<string, NodeDefDescriptor>();
  for (const desc of NODEDEF_REGISTRY) {
    descriptors.set(`${desc.name}@${desc.version}`, desc);
  }
  const adapterCache = createAdapterCache(allocatorWithMemory.memory, descriptors);

  const core = createWorkletCore({
    adapterFactory: (name, version) => adapterCache.factory(name, version),
    allocator: allocatorWithMemory,
    sampleRate: rate,
    publish: () => {
      // Publishing happens via the process() return value in the
      // shell; the core's publish callback is not needed here.
    },
  });

  return {
    core,
    outputScratch: new Float32Array(128),
    outputGain: 1,
    installModule: (payload) => adapterCache.install(payload),
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
          const payload = data as WorkletModuleTransferShim & { type: string };
          // Install is async (WebAssembly.instantiate returns a
          // promise) but the worklet's message handler must not block.
          // The install races against the next instantiate delta; if
          // the instantiate arrives first the adapter factory returns
          // null and the core holds the delta as pending until the
          // next matching-epoch block.
          void bag.installModule(payload);
          return;
        }
        bag.core.handleMessage(data);
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
      const snapshot = bag.core.process(frameCount);

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

      // Post telemetry back to the main thread. The struct-clone cost
      // is the one permitted per-block allocation; future work can
      // gate this on a "subscribers present" flag.
      this.port.postMessage(snapshot);
      return true;
    }
  }

  registerProcessor(SYNTHESIS_PROCESSOR_NAME, SynthesisProcessor);
}

// Auto-register when loaded in the AudioWorklet scope. In Node/Vitest
// the globals are absent and this is a no-op.
registerSynthesisProcessor();
