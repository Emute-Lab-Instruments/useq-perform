/**
 * Source-agnostic NodeDef adapter.
 *
 * Fulfils (partial — see mission feature
 * `m1-synthesis-service-and-devmode-contract`):
 *   VAL-DSP-006 — the normalized host adapter can instantiate and render
 *                 a NodeDef using registry metadata alone, without hand-
 *                 written C++ implementation knowledge.
 *
 * The adapter is the host-side face of the source-agnostic contract: it
 * calls the WASM module's `_init` / `_compute` exports using only the
 * offsets and strides declared by the {@link NodeDefDescriptor}, and it
 * never names a specific def in its source. Adding a new NodeDef is a
 * matter of registering a descriptor plus its WASM artefact; the adapter
 * does not change.
 *
 * Architecture notes:
 *
 * - The adapter is constructed against a {@link NodeDefModule}, an
 *   abstraction over the underlying compiled `WebAssembly.Module`. In
 *   production, the synthesis service compiles the module off-thread,
 *   validates the registry JSON, and hands the adapter a thin wrapper
 *   that owns the instantiated `WebAssembly.Instance` plus its shared
 *   memory. In tests, callers inject a fake module that records calls.
 *
 * - The adapter never reads or writes to global singletons. All
 *   per-instance state lives inside the host-allocated shared memory at
 *   offsets declared by the descriptor. The adapter holds no per-instance
 *   state of its own — instances are addressed by their state pointer.
 *
 * - Lifecycle is the host's responsibility (synthesis.md §3.2). The
 *   adapter exposes `init`, `compute`, `validateLayout`, and the read-
 *   back helpers (`getPhase`, `getSmoothedAmp`); the host decides when to
 *   call them (between render quanta only; never inside `process()`).
 *
 * - Nothing here is browser-specific. The same adapter runs in the
 *   AudioWorklet, in the main thread (for off-thread instantiation
 *   validation), and in Vitest (against a fake module).
 */

import {
  isNodeDefDescriptor,
  nodeDefDescriptorsEqual,
  type NodeDefDescriptor,
  type NodeDefParamTable,
  buildNodeDefParamTable,
} from "../contracts/nodeDefRegistry";

// ---------------------------------------------------------------------------
// Module surface — what the adapter needs from the compiled WASM artefact
// ---------------------------------------------------------------------------

/**
 * Symbol lookup interface for a NodeDef WASM module.
 *
 * This mirrors the C ABI exported by `osc_sine.cpp` (and, in the future,
 * every other NodeDef build). The adapter looks up symbols by name; the
 * host supplies the lookup closure backed by a `WebAssembly.Instance`
 * exports object.
 *
 * The returned functions are intentionally typed as `(...args: number[]) => number`
 * — that is the most permissive signature that still maps cleanly onto
 * Emscripten's strict C calling convention. The adapter validates the
 * return values where their meaning matters (e.g. `validate_layout`
 * returning `0` rejects the zone).
 */
export type NodeDefSymbolLookup = (name: string) => ((...args: number[]) => number) | undefined;

/**
 * Normalized module shape the adapter consumes.
 *
 * The host wraps the raw `WebAssembly.Instance` exports in this shape so
 * the adapter does not couple to `WebAssembly` directly. That keeps the
 * adapter testable in Node (no Wasm runtime required) and in the
 * AudioWorklet (where the global `WebAssembly` is available but the
 * instance lifecycle is owned by the host).
 */
export interface NodeDefModule {
  /**
   * Look up an exported symbol by name (without the leading `_`). The
   * adapter uses the stable C ABI names (`init`, `compute`,
   * `validate_layout`, `get_phase`, `get_smoothed_amp`,
   * `reset_phase`, `state_bytes`, `state_align`, etc.).
   *
   * Returns `undefined` when the export is absent; the adapter surfaces a
   * descriptive error rather than dereferencing undefined.
   */
  readonly lookup: NodeDefSymbolLookup;

  /**
   * The registry JSON the module emits via its `*_registry_json` export.
   * The host parses this once, immediately after compilation, and hands
   * the parsed descriptor to the adapter. The adapter asserts descriptor
   * equality with the editor-side descriptor before any instantiation.
   */
  readonly runtimeDescriptor: NodeDefDescriptor;
}

/**
 * Read and validate the registry descriptor emitted by the module itself.
 * Missing exports, wild pointers, malformed JSON, and incomplete schemas all
 * fail closed; callers must never substitute editor registry metadata for a
 * module that could not describe its own ABI.
 */
export function readNodeDefRuntimeDescriptor(
  memory: WebAssembly.Memory,
  lookup: NodeDefSymbolLookup,
): NodeDefDescriptor {
  const registryJsonFn = lookup("registry_json") ?? lookup("_registry_json");
  if (typeof registryJsonFn !== "function") {
    throw new NodeDefAdapterError(
      'NodeDef module is missing required export "registry_json"',
    );
  }

  const ptr = registryJsonFn();
  if (!Number.isSafeInteger(ptr) || ptr < 0 || ptr >= memory.buffer.byteLength) {
    throw new NodeDefAdapterError(
      `NodeDef module returned invalid registry_json pointer ${ptr}`,
    );
  }
  const maxBytes = Math.min(64 * 1024, memory.buffer.byteLength - ptr);
  const view = new Uint8Array(memory.buffer, ptr, maxBytes);
  let end = 0;
  while (end < view.length && view[end] !== 0) end += 1;
  if (end === 0 || end === view.length) {
    throw new NodeDefAdapterError(
      "NodeDef module returned an empty or unterminated registry_json payload",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8").decode(view.subarray(0, end)));
  } catch {
    throw new NodeDefAdapterError(
      "NodeDef module returned malformed registry_json",
    );
  }
  const normalised = normaliseNodeDefRegistryJson(parsed);
  if (!isNodeDefDescriptor(normalised)) {
    throw new NodeDefAdapterError(
      "NodeDef module registry_json failed schema validation",
    );
  }
  return normalised;
}

function normaliseNodeDefRegistryJson(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const src = raw as Record<string, unknown>;
  const pick = (...keys: string[]): unknown => {
    for (const key of keys) {
      if (key in src) return src[key];
    }
    return undefined;
  };
  const paramsRaw = Array.isArray(src.params) ? src.params : [];
  const params = paramsRaw.map((value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== "object") return {};
    const param = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    if (typeof param.name === "string") out.name = param.name;
    if (typeof param.default === "number") out.default = param.default;
    if (typeof param.rate === "string") out.rate = param.rate;
    if (typeof param.smoothing === "string") out.smoothing = param.smoothing;
    if (typeof param.points_per_block === "number") {
      out.pointsPerBlock = param.points_per_block;
    } else if (typeof param.pointsPerBlock === "number") {
      out.pointsPerBlock = param.pointsPerBlock;
    }
    if (typeof param.min === "number") out.min = param.min;
    if (typeof param.max === "number") out.max = param.max;
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
    controlStrideBytes: pick(
      "control_stride",
      "controlStrideBytes",
      "control_stride_bytes",
    ),
    outputStrideBytes: pick(
      "output_stride",
      "outputStrideBytes",
      "output_stride_bytes",
    ),
    minQuantum: pick("min_quantum", "minQuantum"),
    maxQuantum: pick("max_quantum", "maxQuantum"),
    sampleRate: pick("sample_rate", "sampleRate"),
  };
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

/**
 * Source-agnostic NodeDef adapter.
 *
 * The adapter is created once per compiled module and is reused for every
 * instance of that def. Per-instance state lives inside the host-allocated
 * shared memory; the adapter is stateless apart from the module reference
 * and the descriptor.
 *
 * Use {@link createNodeDefAdapter} to construct one. The factory validates
 * the module's runtime descriptor against the editor-side descriptor so a
 * stale bundle cannot slip past the contract.
 */
export interface NodeDefAdapter {
  /** Descriptor the adapter was constructed against (the public contract surface). */
  readonly descriptor: NodeDefDescriptor;
  /** Parameter table for fast channel routing. */
  readonly params: NodeDefParamTable;
  /** Render sample rate verified against the module's own exports. */
  readonly sampleRate: number;

  /**
   * Validate that a host-allocated zone is large enough and correctly
   * aligned for a per-instance state block. The host MUST call this
   * before {@link init} so an undersized or misaligned zone fails closed.
   *
   * Returns `true` when the zone is usable. On `false` the host surfaces
   * a compile-style diagnostic and rejects the eval.
   */
  validateLayout(statePtr: number, stateBytes: number): boolean;

  /**
   * Reset per-instance state to the registry defaults (440 Hz, amp 0.2,
   * phase 0). The state pointer must already satisfy
   * {@link validateLayout}. No allocation is performed inside the module.
   *
   * Returns `true` on success, `false` on invalid layout.
   */
  init(statePtr: number, stateBytes: number): boolean;

  /**
   * Render exactly `frameCount` samples into `outputPtr`. The state
   * pointer must previously have been initialised; `freqPtr` and
   * `ampPtr` point to block-rate control samples (one double each).
   *
   * Guarantees (delegated to the underlying DSP, see osc_sine.h):
   *   - exactly `frameCount` frames are written;
   *   - phase advances continuously across blocks;
   *   - NaN/Inf/extreme values are clamped to finite output;
   *   - recursive subnormals flush to zero;
   *   - no allocation or blocking inside compute.
   *
   * Returns `true` on success, `false` on invalid frame count or pointers.
   * On failure no output samples are written.
   */
  compute(
    statePtr: number,
    freqPtr: number,
    ampPtr: number,
    outputPtr: number,
    frameCount: number,
  ): boolean;

  /**
   * Optional graph-capable compute for defs with audio inputs
   * (synthesis epic M2.1). `inputPtrs` carries one byte-offset pointer
   * per declared audio input port — each pointing at an upstream
   * node's output zone (or the shared silence zone) inside the
   * host-owned memory. The vector is preallocated per instance at
   * graph-mutation time and mutated in place, so the steady-state call
   * allocates nothing.
   *
   * M1's osc/sine (zero inputs) does not implement this; the host
   * calls {@link compute} for input-less defs. Real WASM-backed
   * adapters gain this entry point in M2.2/M3 when the first def with
   * audio inputs ships (the Faust `compute(count, inputs, outputs)`
   * shape maps directly onto it).
   */
  computeWithInputs?(
    statePtr: number,
    inputPtrs: readonly number[],
    freqPtr: number,
    ampPtr: number,
    outputPtr: number,
    frameCount: number,
  ): boolean;

  /** Read back the per-instance phase. Used by conformance tests only. */
  getPhase(statePtr: number): number;

  /** Read back the per-instance smoothed amplitude. Conformance tests only. */
  getSmoothedAmp(statePtr: number): number;

  /** Reset phase to zero and smoothed amplitude to default. Conformance tests only. */
  resetPhase(statePtr: number): void;
}

/**
 * Build a source-agnostic adapter for a compiled NodeDef module.
 *
 * The host calls this exactly once per module after compilation, after
 * validating the module's runtime registry JSON against the editor-side
 * descriptor. The returned adapter is reused for every instance of that
 * def; per-instance state is addressed by pointer.
 *
 * Throws when:
 *   - the runtime descriptor fails the schema check;
 *   - the runtime descriptor does not equal the editor-side descriptor
 *     (a stale bundle has slipped past the asset pipeline);
 *   - a required C ABI symbol is missing from the module.
 */
export function createNodeDefAdapter(
  module: NodeDefModule,
  editorDescriptor: NodeDefDescriptor,
  renderSampleRate: number = editorDescriptor.sampleRate,
): NodeDefAdapter {
  if (!isNodeDefDescriptor(module.runtimeDescriptor)) {
    throw new NodeDefAdapterError(
      "runtime descriptor failed schema validation",
    );
  }
  if (!nodeDefDescriptorsEqual(module.runtimeDescriptor, editorDescriptor)) {
    throw new NodeDefAdapterError(
      `runtime descriptor does not match editor descriptor for ${editorDescriptor.name} v${editorDescriptor.version}; the WASM bundle is stale or mis-versioned`,
    );
  }

  // Required symbols. The leading underscore is the Emscripten C ABI
  // convention; the adapter normalises both forms (with and without) when
  // probing so callers can use whichever their wasm toolchain emits.
  const requireSymbol = (name: string): ((...args: number[]) => number) => {
    const fn = module.lookup(name) ?? module.lookup(`_${name}`);
    if (typeof fn !== "function") {
      throw new NodeDefAdapterError(
        `NodeDef module is missing required export "${name}"`,
      );
    }
    return fn;
  };
  const optionalSymbol = (name: string): ((...args: number[]) => number) | undefined =>
    module.lookup(name) ?? module.lookup(`_${name}`);

  if (
    !Number.isSafeInteger(renderSampleRate) ||
    renderSampleRate <= 0 ||
    renderSampleRate > 0xffff_ffff
  ) {
    throw new NodeDefAdapterError(
      `invalid render sample rate ${renderSampleRate}`,
    );
  }

  // `sample_rate` is module-owned metadata. Never substitute the registry's
  // value when the export is missing or incompatible: that would make a stale
  // module appear valid while its phase increment still used another rate.
  const sampleRateFn = requireSymbol("sample_rate");
  const moduleDeclaredSampleRate = sampleRateFn();
  if (
    !Number.isSafeInteger(moduleDeclaredSampleRate) ||
    moduleDeclaredSampleRate <= 0 ||
    moduleDeclaredSampleRate !== editorDescriptor.sampleRate
  ) {
    throw new NodeDefAdapterError(
      `NodeDef module reports sample rate ${moduleDeclaredSampleRate}, expected descriptor rate ${editorDescriptor.sampleRate}`,
    );
  }

  // Optional, paired capability. Version 1 passes the AudioContext rate into
  // every compute call. This stays safe when a WebAssembly.Instance hosts many
  // NodeDef state zones and avoids mutable configuration in shared memory.
  const sampleRateAbiVersionFn = optionalSymbol("sample_rate_abi_version");
  const computeAtSampleRateFn = optionalSymbol("compute_at_sample_rate");
  if (
    (sampleRateAbiVersionFn === undefined) !==
    (computeAtSampleRateFn === undefined)
  ) {
    throw new NodeDefAdapterError(
      "NodeDef module exposes an incomplete sample-rate capability; sample_rate_abi_version and compute_at_sample_rate must appear together",
    );
  }
  if (sampleRateAbiVersionFn && computeAtSampleRateFn) {
    const version = sampleRateAbiVersionFn();
    if (version !== NODEDEF_SAMPLE_RATE_ABI_VERSION) {
      throw new NodeDefAdapterError(
        `unsupported NodeDef sample-rate ABI version ${version}; expected ${NODEDEF_SAMPLE_RATE_ABI_VERSION}`,
      );
    }
  } else if (renderSampleRate !== moduleDeclaredSampleRate) {
    throw new NodeDefAdapterError(
      `NodeDef module is fixed at ${moduleDeclaredSampleRate} Hz and cannot render at ${renderSampleRate} Hz`,
    );
  }

  const validateLayoutFn = requireSymbol("validate_layout");
  const initFn = requireSymbol("init");
  const computeFn = requireSymbol("compute");
  const getPhaseFn = requireSymbol("get_phase");
  const getSmoothedAmpFn = requireSymbol("get_smoothed_amp");
  const resetPhaseFn = requireSymbol("reset_phase");

  const adapter: NodeDefAdapter = {
    descriptor: editorDescriptor,
    params: buildNodeDefParamTable(editorDescriptor),
    sampleRate: renderSampleRate,

    validateLayout(statePtr: number, stateBytes: number): boolean {
      return validateLayoutFn(statePtr, stateBytes) !== 0;
    },

    init(statePtr: number, stateBytes: number): boolean {
      return initFn(statePtr, stateBytes) !== 0;
    },

    compute(
      statePtr: number,
      freqPtr: number,
      ampPtr: number,
      outputPtr: number,
      frameCount: number,
    ): boolean {
      if (computeAtSampleRateFn) {
        return computeAtSampleRateFn(
          statePtr,
          freqPtr,
          ampPtr,
          outputPtr,
          frameCount,
          renderSampleRate,
        ) !== 0;
      }
      return computeFn(statePtr, freqPtr, ampPtr, outputPtr, frameCount) !== 0;
    },

    getPhase(statePtr: number): number {
      return getPhaseFn(statePtr);
    },

    getSmoothedAmp(statePtr: number): number {
      return getSmoothedAmpFn(statePtr);
    },

    resetPhase(statePtr: number): void {
      resetPhaseFn(statePtr);
    },
  };

  return Object.freeze(adapter);
}

/**
 * Error thrown when the adapter cannot be constructed against a module.
 * The host surfaces these as compile-style diagnostics on the eval that
 * attempted the instantiation.
 */
export class NodeDefAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NodeDefAdapterError";
  }
}

/** Version of the optional per-module-instance sample-rate capability. */
export const NODEDEF_SAMPLE_RATE_ABI_VERSION = 1;

// ---------------------------------------------------------------------------
// Fake module — for unit tests
// ---------------------------------------------------------------------------

/**
 * Build a fake {@link NodeDefModule} for unit tests.
 *
 * The fake records every call into `init` / `compute` so tests can assert
 * on the adapter's host-facing behaviour without spinning up a real Wasm
 * runtime. Production code never constructs a fake; it builds the real
 * module shape in the synthesis service.
 */
export interface FakeNodeDefModule extends NodeDefModule {
  /** Sample rates passed through the optional version-1 compute capability. */
  readonly computeSampleRateCalls: ReadonlyArray<number>;
  /** Recorded calls to `init`. */
  readonly initCalls: ReadonlyArray<readonly [statePtr: number, stateBytes: number]>;
  /** Recorded calls to `compute`. */
  readonly computeCalls: ReadonlyArray<readonly [
    statePtr: number,
    freqPtr: number,
    ampPtr: number,
    outputPtr: number,
    frameCount: number,
  ]>;
  /** Override the default validate_layout return value. */
  setValidateLayoutResult(value: boolean): void;
  /** Override the default init return value. */
  setInitResult(value: boolean): void;
  /** Override the default compute return value. */
  setComputeResult(value: boolean): void;
}

/**
 * Construct a fake NodeDef module that records calls for test assertions.
 *
 * Defaults:
 *   - validate_layout returns `true`;
 *   - init returns `true`;
 *   - compute returns `true` and writes nothing (the test inspects
 *     recorded calls rather than reading the output buffer).
 */
export function createFakeNodeDefModule(
  descriptor: NodeDefDescriptor,
): FakeNodeDefModule {
  const initCalls: Array<readonly [number, number]> = [];
  const computeCalls: Array<readonly [number, number, number, number, number]> = [];
  const computeSampleRateCalls: number[] = [];
  let validateLayoutResult = true;
  let initResult = true;
  let computeResult = true;

  const lookup: NodeDefSymbolLookup = (name) => {
    switch (name) {
      case "validate_layout":
      case "_validate_layout":
        return () => (validateLayoutResult ? 1 : 0);
      case "sample_rate":
      case "_sample_rate":
        return () => descriptor.sampleRate;
      case "sample_rate_abi_version":
      case "_sample_rate_abi_version":
        return () => NODEDEF_SAMPLE_RATE_ABI_VERSION;
      case "init":
      case "_init":
        return (statePtr: number, stateBytes: number) => {
          initCalls.push([statePtr, stateBytes] as const);
          return initResult ? 1 : 0;
        };
      case "compute":
      case "_compute":
        return (
          statePtr: number,
          freqPtr: number,
          ampPtr: number,
          outputPtr: number,
          frameCount: number,
        ) => {
          computeCalls.push(
            [statePtr, freqPtr, ampPtr, outputPtr, frameCount] as const,
          );
          return computeResult ? 1 : 0;
        };
      case "compute_at_sample_rate":
      case "_compute_at_sample_rate":
        return (
          statePtr: number,
          freqPtr: number,
          ampPtr: number,
          outputPtr: number,
          frameCount: number,
          sampleRate: number,
        ) => {
          computeCalls.push(
            [statePtr, freqPtr, ampPtr, outputPtr, frameCount] as const,
          );
          computeSampleRateCalls.push(sampleRate);
          return computeResult ? 1 : 0;
        };
      case "get_phase":
      case "_get_phase":
        return () => 0;
      case "get_smoothed_amp":
      case "_get_smoothed_amp":
        return () => descriptor.params.find((p) => p.name === "amp")?.default ?? 0.2;
      case "reset_phase":
      case "_reset_phase":
        return () => 0;
      default:
        return undefined;
    }
  };

  return {
    lookup,
    runtimeDescriptor: descriptor,
    get initCalls() {
      return initCalls;
    },
    get computeCalls() {
      return computeCalls;
    },
    get computeSampleRateCalls() {
      return computeSampleRateCalls;
    },
    setValidateLayoutResult(value: boolean) {
      validateLayoutResult = value;
    },
    setInitResult(value: boolean) {
      initResult = value;
    },
    setComputeResult(value: boolean) {
      computeResult = value;
    },
  };
}
