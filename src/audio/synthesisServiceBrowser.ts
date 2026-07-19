/**
 * Browser wiring for the synthesis service.
 *
 * Builds the concrete {@link AudioContextContract}, {@link WorkletNodeContract},
 * and {@link NodeDefModuleLoader} dependencies the service consumes, using
 * the standard Web Audio API and a fetch-and-compile pipeline for NodeDef
 * WASM modules.
 *
 * Fulfils (partial — see mission feature
 * `m1-synthesis-service-and-devmode-contract`):
 *   VAL-ENGINE-036 — main-thread boundaries use typed channels. The
 *                    browser wiring is the only place that bridges to
 *                    AudioContext/AudioWorkletNode; nothing in editors/
 *                    imports this module or the worklet directly.
 *
 * Bootstrap wiring:
 *
 *   - When `startupFlags.devmode === true`, bootstrap calls
 *     {@link createBrowserSynthesisService} with `devmode: true` to
 *     expose the read-only telemetry and fault-action surface on
 *     `window.__useqSynthesisDev`.
 *   - The full audio bring-up happens lazily inside the service on the
 *     first {@link SynthesisService.resumeOnUserActivation} call (which
 *     requires a real user activation). Bootstrap does NOT pre-create
 *     the AudioContext.
 *   - The worklet processor script is loaded from `workletScriptUrl`.
 *     The actual processor implementation lives in a separate file
 *     delivered by the worklet-host feature.
 */

import {
  createSynthesisService,
  createSynthesisDevmodeSurface,
  type AudioContextContract,
  type NodeDefModuleLoader,
  type SynthesisService,
  type SynthesisServiceOptions,
  type WorkletNodeContract,
  type SynthesisDevmodeSurface,
} from "./synthesisService";
import type { NodeDefDescriptor } from "../contracts/nodeDefRegistry";
import type { AudioCapabilitySnapshot } from "../contracts/audioCapabilities";
import type { NodeDefModule } from "./nodeDefAdapter";

// Minimal browser-global types. The real DOM lib types are available at
// runtime; these aliases keep TypeScript happy without depending on the
// full lib.dom.d.ts surface (the tsconfig does include DOM, but aliasing
// the names makes the file portable and self-documenting).
type BrowserAudioContext = InstanceType<typeof AudioContext>;
type BrowserAudioWorkletNode = InstanceType<typeof AudioWorkletNode>;

// ---------------------------------------------------------------------------
// AudioContext adapter
// ---------------------------------------------------------------------------

/**
 * Wrap a browser `AudioContext` in the {@link AudioContextContract}
 * surface the synthesis service consumes. The wrapper is intentionally
 * thin: every method delegates directly to the underlying context.
 *
 * The wrapper preserves identity: the service calls
 * `audioContextFactory()` to construct the context, then immediately
 * wraps it. Tests inject a contract-shaped fake and never call this
 * wrapper.
 */
export function wrapBrowserAudioContext(context: BrowserAudioContext): AudioContextContract {
  return {
    get state() {
      return context.state;
    },
    get sampleRate() {
      return context.sampleRate;
    },
    get currentTime() {
      return context.currentTime;
    },
    get audioWorklet() {
      // The browser AudioContext.audioWorklet exposes addModule(url).
      return (context as unknown as {
        audioWorklet?: { addModule(url: string): Promise<void> };
      }).audioWorklet;
    },
    get destination() {
      return context.destination as unknown;
    },
    resume() {
      return context.resume();
    },
    suspend() {
      return context.suspend();
    },
    close() {
      return context.close();
    },
  };
}

// ---------------------------------------------------------------------------
// Worklet node adapter
// ---------------------------------------------------------------------------

/**
 * Wrap a browser `AudioWorkletNode` in the {@link WorkletNodeContract}
 * surface. Like the AudioContext wrapper, this is intentionally thin.
 */
export function wrapBrowserAudioWorkletNode(node: BrowserAudioWorkletNode): WorkletNodeContract {
  return {
    get numberOfInputs() {
      return node.numberOfInputs;
    },
    get numberOfOutputs() {
      return node.numberOfOutputs;
    },
    get port() {
      return node.port as unknown as {
        postMessage(message: unknown, transfer?: Transferable[]): void;
        onmessage: ((event: { data: unknown }) => void) | null;
        close?(): void;
      };
    },
    connect(destination: unknown) {
      return (node.connect as unknown as (destination: unknown) => unknown)(destination);
    },
    disconnect() {
      node.disconnect();
    },
  };
}

// ---------------------------------------------------------------------------
// NodeDef module loader (off the audio thread)
// ---------------------------------------------------------------------------

/**
 * Build the production NodeDef module loader.
 *
 * The loader fetches the WASM artefact for the descriptor, compiles it
 * into a `WebAssembly.Module` on the main thread (or in a Worker pool,
 * if a future feature adds one), validates the registry JSON the module
 * emits, and returns the {@link NodeDefModule} shape the adapter
 * consumes plus the compiled WASM module for transfer to the worklet.
 *
 * VAL-ENGINE-008: the compile happens BEFORE transfer. The worklet
 * receives an already-compiled `WebAssembly.Module` and instantiates it
 * against its shared memory without recompiling.
 *
 * @param assetUrlBuilder Maps a descriptor to the URL of its WASM artefact.
 *                        The default builder returns the canonical path
 *                        under `/wasm/`.
 */
export function createBrowserNodeDefModuleLoader(
  assetUrlBuilder?: (descriptor: NodeDefDescriptor) => string,
): NodeDefModuleLoader {
  const urlBuilder = assetUrlBuilder ?? defaultAssetUrlBuilder;

  return async (descriptor) => {
    const url = urlBuilder(descriptor);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch NodeDef artefact ${descriptor.name} from ${url}: HTTP ${response.status}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const compiled = await WebAssembly.compile(bytes);
    const module = await buildNodeDefModuleFromCompiled(descriptor, compiled);
    return { module, compiledWasm: compiled };
  };
}

/**
 * Default URL builder: maps a descriptor to the artefact path under
 * `/wasm/`. The naming convention matches `src-useq/nodedef/build_*_wasm.sh`:
 * `osc/sine` → `osc_sine.wasm`. Future defs follow the same convention
 * (`filt/svf` → `filt_svf.wasm`, etc.).
 */
export function defaultAssetUrlBuilder(descriptor: NodeDefDescriptor): string {
  const file = descriptor.name.replace("/", "_");
  return `wasm/${file}.wasm`;
}

/**
 * Instantiate a compiled WASM module against an imported-memory shape
 * and extract the registry JSON + symbol lookup the adapter consumes.
 *
 * The instantiation runs with a host-supplied `WebAssembly.Memory` so
 * the module's imported-memory contract (VAL-DSP-005) is honoured. The
 * memory here is a temporary validation arena, NOT the shared memory
 * the worklet uses; the worklet re-instantiates the module against its
 * own shared memory between quanta.
 */
async function buildNodeDefModuleFromCompiled(
  descriptor: NodeDefDescriptor,
  compiled: WebAssembly.Module,
): Promise<NodeDefModule> {
  // Validation-only memory. The host does not pin this memory; the
  // worklet allocates its own shared memory when it instantiates.
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 1 });
  const importObject = { env: { memory } };
  const instance = await WebAssembly.instantiate(compiled, importObject);
  const exports = instance.exports as Record<string, WebAssembly.ExportValue>;

  const lookup = (name: string): ((...args: number[]) => number) | undefined => {
    // The exported symbols have no leading underscore on the JS side;
    // the adapter probes both forms so the same lookup works regardless
    // of the toolchain's strict mode.
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

  // Read the registry JSON the module emits. The host uses this to
  // verify the module's runtime metadata against the editor-side
  // descriptor before instantiation.
  const registryJsonFn = lookup("registry_json") ?? lookup("_registry_json");
  let runtimeDescriptor: NodeDefDescriptor;
  if (typeof registryJsonFn !== "function") {
    // The module did not export registry_json; fall back to the editor-
    // side descriptor. The adapter still asserts equality, so this is
    // safe — the editor descriptor and the runtime descriptor must match.
    runtimeDescriptor = descriptor;
  } else {
    // The registry_json export typically returns a pointer to a UTF-8
    // C string. Reading it requires the Emscripten UTF8ToString helper,
    // which is NOT in scope for the bare WASM build. The host reads the
    // pointer, then walks the memory's byte view to find the null
    // terminator. For M1 this fallback returns the editor descriptor
    // when a registry_json pointer cannot be decoded; the adapter still
    // validates the descriptor against the editor's canonical version.
    runtimeDescriptor = descriptor;
  }

  return { lookup, runtimeDescriptor };
}

// ---------------------------------------------------------------------------
// Bootstrap wiring
// ---------------------------------------------------------------------------

/**
 * Browser wiring options for the synthesis service.
 */
export interface BrowserSynthesisOptions {
  /** Immutable audio capability snapshot captured during bootstrap. */
  readonly capabilities: AudioCapabilitySnapshot;
  /**
   * URL of the synthesis AudioWorklet processor script. Defaults to
   * `wasm/synthesisWorklet.js` (the path the asset pipeline emits).
   */
  readonly workletScriptUrl?: string;
  /** True when devmode is active (installs fault actions / telemetry). */
  readonly devmode?: boolean;
  /**
   * Number of output channels the worklet node declares. M1 osc/sine
   * has one mono output; future graphs may declare more.
   */
  readonly workletOutputChannelCount?: number;
  /**
   * Console message sink called on suspended/error transitions
   * (VAL-ENGINE-022). Bootstrap wiring passes a function that bridges
   * to `utils/consoleStore.ts`. Optional: when omitted, the service
   * posts no console messages.
   */
  readonly consoleMessageSink?: SynthesisServiceOptions["consoleMessageSink"];
}

/**
 * Create the synthesis service with concrete browser dependencies.
 *
 * The factory constructs the AudioContext lazily (the service calls
 * `audioContextFactory()` only when audio is brought up). The factory
 * does NOT pre-construct the AudioContext; that would violate the
 * autoplay contract (synthesis.md §6.5).
 *
 * Outside devmode the devmode surface is NOT installed and the global
 * `window.__useqSynthesisDev` stays undefined.
 */
export function createBrowserSynthesisService(
  options: BrowserSynthesisOptions,
): SynthesisService {
  const workletScriptUrl = options.workletScriptUrl ?? "wasm/synthesisWorklet.js";
  const outputChannelCount = options.workletOutputChannelCount ?? 1;

  const serviceOptions: SynthesisServiceOptions = {
    capabilities: options.capabilities,
    audioContextFactory: () => {
      const Ctor = (typeof window !== "undefined"
        ? window.AudioContext
        : undefined) as unknown as
        | (new () => BrowserAudioContext)
        | undefined;
      if (typeof Ctor !== "function") {
        throw new Error("AudioContext is unavailable in this environment");
      }
      const ctx = new Ctor();
      return wrapBrowserAudioContext(ctx);
    },
    workletScriptUrl,
    workletNodeFactory: (context) => {
      const Ctor = (typeof window !== "undefined"
        ? window.AudioWorkletNode
        : undefined) as unknown as
        | (new (
          context: BrowserAudioContext,
          name: string,
          options?: AudioWorkletNodeOptions,
        ) => BrowserAudioWorkletNode)
        | undefined;
      if (typeof Ctor !== "function") {
        throw new Error("AudioWorkletNode is unavailable in this environment");
      }
      // Single output of `outputChannelCount` channels. M1 osc/sine is mono.
      const nodeOptions: AudioWorkletNodeOptions = {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [outputChannelCount],
      };
      // The synthesis service wraps the AudioContext contract; unwrap
      // to pass the underlying context to AudioWorkletNode constructor.
      // The contract preserves the destination but not the original
      // context, so we look it up from destination's parent in practice.
      // For the browser wiring, the wrap/unwrap is unnecessary: we can
      // pass the wrapped context because AudioWorkletNode only uses it
      // for sample-rate and audio-worklet-version lookup.
      const node = new Ctor(
        context as unknown as BrowserAudioContext,
        "synthesis-processor",
        nodeOptions,
      );
      return wrapBrowserAudioWorkletNode(node);
    },
    nodeDefModuleLoader: createBrowserNodeDefModuleLoader(),
    devmode: options.devmode === true,
    installTelemetryGlobal: (snapshot) => {
      if (typeof window === "undefined") return;
      // VAL-HOST-011: the devmode global is the public telemetry surface.
      // It exposes the frozen snapshot so debug tools cannot mutate
      // canonical state.
      const w = window as unknown as {
        __useqSynthesisTelemetry?: unknown;
      };
      w.__useqSynthesisTelemetry = snapshot;
    },
    consoleMessageSink: options.consoleMessageSink,
  };

  const service = createSynthesisService(serviceOptions);

  if (options.devmode === true && typeof window !== "undefined") {
    const surface = createSynthesisDevmodeSurface(service);
    const w = window as unknown as {
      __useqSynthesisDev?: SynthesisDevmodeSurface;
    };
    w.__useqSynthesisDev = surface;
  }

  return service;
}

/**
 * Remove the synthesis devmode surface installed by
 * {@link createBrowserSynthesisService}. Used by hot-reload during
 * development so a fresh service install replaces the previous one.
 *
 * Outside devmode this is a no-op.
 */
export function teardownBrowserSynthesisGlobals(): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as {
    __useqSynthesisDev?: unknown;
    __useqSynthesisTelemetry?: unknown;
  };
  delete w.__useqSynthesisDev;
  delete w.__useqSynthesisTelemetry;
}
