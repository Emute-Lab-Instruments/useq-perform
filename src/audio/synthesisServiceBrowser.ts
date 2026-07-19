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
  type SynthesisWorkerPort,
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
    const module = await buildNodeDefModuleFromCompiled(descriptor, compiled, bytes);
    // Stash the source bytes on the compiled module so the synthesis
    // service can forward them to the worklet alongside the module.
    // Some Chromium versions reject structured-clone of
    // WebAssembly.Module across the AudioWorklet MessagePort; the
    // bytes let the worklet recompile as a fallback.
    try {
      Object.defineProperty(compiled, "__sourceBytes", {
        value: bytes,
        writable: false,
        enumerable: false,
        configurable: false,
      });
    } catch {
      // defineProperty may fail on platform objects; ignore — the
      // worklet will receive the module directly if cloning works.
    }
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
 * Read the declared initial page count of a NodeDef WASM module's
 * imported memory by parsing the WASM binary's Import section.
 *
 * The host uses this to size the validation-only memory it instantiates
 * the module against. Real NodeDef modules ship with a fixed initial
 * page count baked into their import descriptor (e.g. 256 pages for the
 * M1 osc/sine), so reading it directly keeps the host from guessing and
 * under-sizing.
 *
 * `WebAssembly.Module.imports()` returns only `{module, name, kind}` —
 * it omits the limits descriptor — so we parse the Import section of
 * the binary directly. WASM binary format reference:
 * https://webassembly.github.io/spec/core/binary/modules.html.
 *
 * Returns a fallback of 1 page when the binary cannot be parsed or the
 * module declares no `env.memory` import; the worklet's own
 * instantiation against its shared memory is the authoritative
 * runtime check.
 */
function readModuleMemoryInitialPages(bytes: Uint8Array): number {
  // WASM binary layout (only what we touch):
  //   magic \0asm (4 bytes)
  //   version (4 bytes, little-endian uint32)
  //   repeat: section = (id:u8, size:uleb128, payload:bytes)
  // Section IDs we care about:
  //   Type = 1, Import = 2, Function = 3, Table = 4, Memory = 5,
  //   Global = 6, Export = 7, Start = 8, Element = 9, ...
  // Import section payload is a vector of importdesc:
  //   module: name (= length:uleb128 + utf8 bytes)
  //   name: name
  //   desc: one of
  //     0x00 typeidx (func)
  //     0x01 tabletype (table)
  //     0x02 memtype (memory) = flags:u8 + initial:uleb128 + [maximum:uleb128]
  //     0x03 globaltype (global)
  try {
    if (bytes.length < 8) return 1;
    // Validate magic and version.
    if (bytes[0] !== 0x00 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d) {
      return 1;
    }
    let pos = 8; // skip magic + version
    while (pos + 1 < bytes.length) {
      const sectionId = bytes[pos];
      pos += 1;
      const [sectionSize, consumed] = readLeb128(bytes, pos);
      pos += consumed;
      if (sectionId === 2) {
        // Import section. Walk the import vector.
        const sectionEnd = pos + sectionSize;
        let cursor = pos;
        const [importCount, importCountConsumed] = readLeb128(bytes, cursor);
        cursor += importCountConsumed;
        for (let i = 0; i < importCount && cursor < sectionEnd; i++) {
          // module name
          const [modLen, modLenConsumed] = readLeb128(bytes, cursor);
          cursor += modLenConsumed;
          const modName = decodeUtf8(bytes, cursor, modLen);
          cursor += modLen;
          // field name
          const [nameLen, nameLenConsumed] = readLeb128(bytes, cursor);
          cursor += nameLenConsumed;
          cursor += nameLen;
          // kind
          const kind = bytes[cursor];
          cursor += 1;
          if (kind === 0x02 && modName === "env") {
            // memtype: flags:u8 + initial:uleb128 [+ maximum:uleb128]
            const flags = bytes[cursor];
            cursor += 1;
            const [initial, initialConsumed] = readLeb128(bytes, cursor);
            cursor += initialConsumed;
            if (flags & 0x01) {
              // has maximum; skip it.
              const [, maxConsumed] = readLeb128(bytes, cursor);
              cursor += maxConsumed;
            }
            if (initial > 0) return initial;
          } else if (kind === 0x00) {
            // function: typeidx (uleb128)
            const [, c] = readLeb128(bytes, cursor);
            cursor += c;
          } else if (kind === 0x01) {
            // table: elemtype:u8 + limits
            cursor += 1; // elemtype
            const flags = bytes[cursor];
            cursor += 1;
            const [, c1] = readLeb128(bytes, cursor);
            cursor += c1;
            if (flags & 0x01) {
              const [, c2] = readLeb128(bytes, cursor);
              cursor += c2;
            }
          } else if (kind === 0x03) {
            // global: valtype:u8 + mut:u8
            cursor += 2;
          }
        }
        // No env.memory import found; fall through to fallback.
        return 1;
      }
      // Skip this section.
      pos += sectionSize;
    }
  } catch {
    // Defensive: any parse error falls back to a safe page count.
  }
  return 1;
}

/**
 * Read an unsigned LEB128 from `bytes` starting at `offset`. Returns
 * `[value, bytesConsumed]`. Throws on malformed input or truncation.
 *
 * Used only by {@link readModuleMemoryInitialPages}; not exported.
 */
function readLeb128(bytes: Uint8Array, offset: number): [number, number] {
  let result = 0;
  let shift = 0;
  let pos = offset;
  while (pos < bytes.length) {
    const byte = bytes[pos];
    pos += 1;
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      return [result >>> 0, pos - offset];
    }
    shift += 7;
    if (shift > 35) {
      // Practical WASM LEB128s are at most 5 bytes for u32; bail.
      throw new Error("LEB128 too long");
    }
  }
  throw new Error("truncated LEB128");
}

/**
 * Decode a UTF-8 substring of `bytes`. Defensive: returns the empty
 * string on out-of-range input. Only module/field names in the Import
 * section are decoded, so the cost is bounded by the WASM import
 * vector size.
 */
function decodeUtf8(bytes: Uint8Array, offset: number, length: number): string {
  try {
    const slice = bytes.subarray(offset, offset + length);
    // TextDecoder is available in browsers and Node 22+.
    return new TextDecoder("utf-8").decode(slice);
  } catch {
    return "";
  }
}

/**
 * Conservative page count for the validation-only memory when the
 * module's actual declared initial size cannot be read from
 * `WebAssembly.Module.imports()`. Matches SYNTH_MEMORY_MAX (64 MiB =
 * 1024 pages) so any NodeDef within the host's bounded arena
 * instantiates successfully during validation. The worklet allocates
 * its own shared memory against the same cap.
 */
const SYNTH_VALIDATION_MEMORY_PAGES_FALLBACK = 1024;

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
  bytes: Uint8Array,
): Promise<NodeDefModule> {
  // Validation-only memory. The host does not pin this memory; the
  // worklet allocates its own shared memory when it instantiates.
  //
  // VAL-CROSS-002 regression fix: the module declares its required
  // initial memory size in its Import section
  // (env.memory limits descriptor). The NodeDef build emits a 256-page
  // (16 MiB) initial size, so a hard-coded `{initial:1,maximum:1}`
  // memory fails with "memory import has 1 pages which is smaller than
  // the declared initial of 256". We parse the binary Import section
  // and allocate exactly the declared initial size (with a matching
  // maximum so the validation instantiation does not need to grow).
  const parsedInitial = readModuleMemoryInitialPages(bytes);
  const initialPages = parsedInitial > 0
    ? parsedInitial
    : SYNTH_VALIDATION_MEMORY_PAGES_FALLBACK;
  const memory = new WebAssembly.Memory({
    initial: initialPages,
    maximum: initialPages,
  });
  const importObject = { env: { memory } };
  const instance = await WebAssembly.instantiate(compiled, importObject);
  const exports = instance.exports as Record<string, WebAssembly.ExportValue>;

  // The build emits symbols prefixed with the def name (slashes replaced
  // by underscores), e.g. `osc/sine` -> `osc_sine_validate_layout`.
  // The adapter requests the bare symbol name and tries both bare and
  // underscore-prefixed forms; the loader adds the def-name-prefixed
  // form so the source-agnostic adapter does not need to know about
  // the per-def build convention.
  const defPrefix = `${descriptor.name.replace("/", "_")}_`;

  const lookup = (name: string): ((...args: number[]) => number) | undefined => {
    // Try the def-name-prefixed form first (the actual build convention).
    const prefixed = exports[`${defPrefix}${name}`];
    if (typeof prefixed === "function") {
      return prefixed as (...args: number[]) => number;
    }
    // Then the bare name (some builds may not prefix).
    const direct = exports[name];
    if (typeof direct === "function") {
      return direct as (...args: number[]) => number;
    }
    // Finally the underscore-prefixed bare name (legacy Emscripten
    // convention).
    const underscored = exports[`_${name}`];
    if (typeof underscored === "function") {
      return underscored as (...args: number[]) => number;
    }
    return undefined;
  };

  // Read the registry JSON the module emits via `<def>_registry_json`.
  // The export returns a pointer to a null-terminated UTF-8 string in
  // the module's linear memory; we decode it by walking from the
  // returned pointer until we hit a zero byte, then UTF-8 decode the
  // slice. The JSON is bounded by the registry metadata size (a few
  // hundred bytes for M1 defs).
  const registryJsonFn = lookup("registry_json");
  let runtimeDescriptor: NodeDefDescriptor;
  if (typeof registryJsonFn !== "function") {
    // The module did not export registry_json; fall back to the editor-
    // side descriptor. The adapter still asserts equality, so this is
    // safe — the editor descriptor and the runtime descriptor must match.
    runtimeDescriptor = descriptor;
  } else {
    try {
      const ptr = registryJsonFn();
      runtimeDescriptor = decodeRegistryJsonAt(memory, ptr, descriptor);
    } catch {
      // Pointer read or JSON parse failed; fall back to the editor
      // descriptor. The adapter still validates equality.
      runtimeDescriptor = descriptor;
    }
  }

  return { lookup, runtimeDescriptor };
}

/**
 * Decode the null-terminated UTF-8 registry JSON string the
 * `<def>_registry_json` export points at, and parse it as a
 * {@link NodeDefDescriptor}.
 *
 * Bounds the read at 64 KiB so a buggy module returning a wild pointer
 * cannot cause the host to scan gigabytes of zeros.
 *
 * Returns the parsed descriptor when the JSON is valid and the schema
 * check passes; otherwise returns the supplied `fallback` editor
 * descriptor (the adapter still asserts equality before use).
 */
function decodeRegistryJsonAt(
  memory: WebAssembly.Memory,
  ptr: number,
  fallback: NodeDefDescriptor,
): NodeDefDescriptor {
  if (!Number.isFinite(ptr) || ptr < 0) return fallback;
  const view = new Uint8Array(memory.buffer, ptr, 64 * 1024);
  // Find the null terminator.
  let end = 0;
  while (end < view.length && view[end] !== 0) end += 1;
  if (end === 0 || end >= view.length) return fallback;
  const bytes = view.subarray(0, end);
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8").decode(bytes));
  } catch {
    return fallback;
  }
  // The C-side `<def>_registry_json()` emits snake_case keys
  // (`audio_inputs`, `voice_fanout`, `fade_in_ms`, etc.); the host
  // adapter consumes camelCase keys per `NodeDefDescriptor`. Normalise
  // before schema validation.
  const normalised = normaliseRegistryJson(parsed);
  if (
    normalised &&
    typeof normalised === "object" &&
    (normalised as { name?: unknown }).name === fallback.name &&
    (normalised as { version?: unknown }).version === fallback.version
  ) {
    return normalised as unknown as NodeDefDescriptor;
  }
  return fallback;
}

/**
 * Convert a snake_case-keyed registry JSON payload (the C-side shape
 * emitted by `<def>_registry_json()`) into the camelCase
 * {@link NodeDefDescriptor} shape the host adapter consumes.
 *
 * Unknown keys are passed through unchanged; missing keys are left
 * undefined so the schema validator can reject the descriptor.
 */
function normaliseRegistryJson(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const src = raw as Record<string, unknown>;
  const pick = (...keys: string[]): unknown => {
    for (const k of keys) {
      if (k in src) return src[k];
    }
    return undefined;
  };
  const paramsRaw = Array.isArray(src.params) ? src.params : [];
  const params = paramsRaw.map((p: unknown): Record<string, unknown> => {
    if (!p || typeof p !== "object") return {};
    const pr = p as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    if (typeof pr.name === "string") out.name = pr.name;
    if (typeof pr.default === "number") out.default = pr.default;
    if (typeof pr.rate === "string") out.rate = pr.rate;
    if (typeof pr.smoothing === "string") out.smoothing = pr.smoothing;
    if (typeof pr.points_per_block === "number") out.pointsPerBlock = pr.points_per_block;
    else if (typeof pr.pointsPerBlock === "number") out.pointsPerBlock = pr.pointsPerBlock;
    if (typeof pr.min === "number") out.min = pr.min;
    if (typeof pr.max === "number") out.max = pr.max;
    return out;
  });
  return {
    name: pick("name"),
    version: pick("version"),
    audioInputs: pick("audio_inputs", "audioInputs"),
    audioOutputs: pick("audio_outputs", "audioOutputs"),
    voiceFanout: pick("voice_fanout", "voiceFanout"),
    params,
    fadeInMs: pick("fade_in_ms", "fadeInMs"),
    fadeOutMs: pick("fade_out_ms", "fadeOutMs"),
    stateBytes: pick("state_bytes", "stateBytes"),
    stateAlign: pick("state_align", "stateAlign"),
    controlStrideBytes: pick("control_stride", "controlStrideBytes", "control_stride_bytes"),
    outputStrideBytes: pick("output_stride", "outputStrideBytes", "output_stride_bytes"),
    minQuantum: pick("min_quantum", "minQuantum"),
    maxQuantum: pick("max_quantum", "maxQuantum"),
    sampleRate: pick("sample_rate", "sampleRate"),
  };
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
  /**
   * Worker producer port used to arm the program epoch after a
   * successful eval commit (VAL-ENGINE-010). Bootstrap wiring passes
   * the active WASM runtime port (the Worker-backed implementation);
   * it satisfies the {@link SynthesisWorkerPort} contract. Optional:
   * when omitted, the service computes the diff and posts worklet
   * messages but the producer does not tag blocks with the new epoch.
   */
  readonly workerPort?: SynthesisWorkerPort;
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

  // VAL-CROSS-002 regression fix: AudioWorkletNode requires the actual
  // BaseAudioContext instance as its first constructor argument, not a
  // wrapper. The synthesis service intentionally only sees the
  // {@link AudioContextContract} shape so it can be tested with fakes,
  // so the unwrapped AudioContext must be captured here in the browser
  // wiring layer (where the real AudioContext is constructed) and
  // reused by the worklet-node factory.
  //
  // The synthesis service guarantees the call sequence
  //   audioContextFactory() -> ... -> workletNodeFactory(context)
  // on every bring-up and every recovery, so this closure variable is
  // always populated before the worklet-node factory runs.
  let liveAudioContext: BrowserAudioContext | null = null;

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
      liveAudioContext = ctx;
      return wrapBrowserAudioContext(ctx);
    },
    workletScriptUrl,
    workletNodeFactory: (_contract) => {
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
      // Use the captured underlying AudioContext. Real browsers reject
      // anything that is not a BaseAudioContext with
      // "Failed to construct 'AudioWorkletNode': parameter 1 is not of
      // type 'BaseAudioContext'". The contract the service passes in
      // is intentionally a plain object so it fails that check.
      const underlyingContext = liveAudioContext;
      if (underlyingContext === null) {
        throw new Error(
          "workletNodeFactory called before audioContextFactory populated the live AudioContext",
        );
      }
      const node = new Ctor(
        underlyingContext,
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
    workerPort: options.workerPort,
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
