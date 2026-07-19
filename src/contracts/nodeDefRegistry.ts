/**
 * Source-agnostic NodeDef registry contract.
 *
 * Fulfils (partial — see mission feature
 * `m1-synthesis-service-and-devmode-contract`):
 *   VAL-DSP-006 — the normalized host adapter can instantiate and render
 *                 the NodeDef using registry metadata alone, without
 *                 hand-written C++ implementation knowledge.
 *
 * This module owns the **metadata** half of the source-agnostic contract:
 * every NodeDef the host can instantiate is described by a
 * {@link NodeDefDescriptor} that the adapter reads before touching the
 * underlying DSP module. The adapter itself (which calls `init`/`compute`
 * on the WASM module) lives in `src/audio/nodeDefAdapter.ts`; it consumes
 * these descriptors without linking to any def-specific source.
 *
 * The descriptor shape mirrors the C++ `osc_sine_registry_json` payload
 * (see `src-useq/nodedef/osc_sine.h`):
 *
 *   {
 *     "name":"osc/sine","version":1,
 *     "audio_inputs":0,"audio_outputs":1,"voice_fanout":false,
 *     "params":[
 *       {"name":"freq","default":440.0,"rate":"block","smoothing":"step"},
 *       {"name":"amp", "default":0.2,  "rate":"block","smoothing":"linear"}
 *     ],
 *     "fade_in_ms":10,"fade_out_ms":30,
 *     "state_bytes":<N>,"state_align":<A>,
 *     "control_stride":8,"output_stride":8,
 *     "min_quantum":1,"max_quantum":8192,
 *     "sample_rate":48000
 *   }
 *
 * The host never reads the C++ source; it reads the registry JSON the
 * module emits via its `*_registry_json` export and validates it against
 * the descriptor schema in this file.
 *
 * Import-boundary note: this module is dependency-light (no DOM, no
 * runtime singletons) so it stays importable from `src/contracts/` and
 * from the worklet bundle without violating ESLint layering.
 */

// ---------------------------------------------------------------------------
// Param rate / smoothing classes (mirror synth-nodes.md §2.3–2.5)
// ---------------------------------------------------------------------------

/**
 * Rate class declares how densely the host samples the controlling signal
 * (synth-nodes.md §2.3):
 *   - `block` — once per audio block;
 *   - `fast`  — a declared higher control rate (`pointsPerBlock` samples
 *               per block, stored on the descriptor).
 */
export type NodeDefParamRate = "block" | "fast";

/**
 * Smoothing class declares how sampled values behave between control
 * points (synth-nodes.md §2.4):
 *   - `step`  — apply at the control point, hold until the next;
 *   - `linear`— ramp to the next value;
 *   - `slew`  — exponential approach with a declared time constant;
 *   - `latch` — stepped AND event-like (gates/triggers), transported as
 *               timestamped edges applied sample-accurately inside the
 *               block.
 */
export type NodeDefParamSmoothing =
  | "step"
  | "linear"
  | "slew"
  | "latch";

// ---------------------------------------------------------------------------
// Descriptor
// ---------------------------------------------------------------------------

/**
 * One declared NodeDef parameter.
 */
export interface NodeDefParamDescriptor {
  /** Parameter name (matches the synth-form keyword without `:`). */
  readonly name: string;
  /** Static default value applied at node instantiation. */
  readonly default: number;
  /** Rate at which the host samples the controlling signal. */
  readonly rate: NodeDefParamRate;
  /** Smoothing behaviour between control points. */
  readonly smoothing: NodeDefParamSmoothing;
  /**
   * When `rate === "fast"`, the declared points per block. Undefined for
   * `block`-rate params.
   */
  readonly pointsPerBlock?: number;
  /** Nominal minimum, when the def declares one. */
  readonly min?: number;
  /** Nominal maximum, when the def declares one. */
  readonly max?: number;
}

/**
 * Normalized, source-agnostic NodeDef descriptor.
 *
 * The host consumes this metadata to size per-instance zones, patch
 * control channels, and route audio. It contains zero knowledge of how
 * the def is implemented (Faust, hand-written C++, etc.).
 */
export interface NodeDefDescriptor {
  /** Namespaced identifier (e.g. `"osc/sine"`). */
  readonly name: string;
  /** Registry version. Incompatible versions fail the eval transactionally. */
  readonly version: number;
  /** Audio input channel count. */
  readonly audioInputs: number;
  /** Audio output channel count. */
  readonly audioOutputs: number;
  /** True when the def supports vector fan-out (synth-nodes.md §5.6). */
  readonly voiceFanout: boolean;
  /** Declared parameters. */
  readonly params: readonly NodeDefParamDescriptor[];
  /** Fade-in millis compatible with the central `SYNTH_FADE_IN_MS`. */
  readonly fadeInMs: number;
  /** Fade-out millis compatible with the central `SYNTH_FADE_OUT_MS`. */
  readonly fadeOutMs: number;
  /** Per-instance state size in bytes (the host allocates a zone of at least this size). */
  readonly stateBytes: number;
  /** Per-instance state alignment in bytes. */
  readonly stateAlign: number;
  /** Stride in bytes for block-rate control samples (`double` per channel). */
  readonly controlStrideBytes: number;
  /** Stride in bytes for one output channel sample (`double` per frame). */
  readonly outputStrideBytes: number;
  /** Minimum supported render quantum (frames per block). */
  readonly minQuantum: number;
  /** Maximum supported render quantum (frames per block). */
  readonly maxQuantum: number;
  /** Sample rate the DSP was compiled against. */
  readonly sampleRate: number;
}

/**
 * Addressable lookup of params by name (constructed lazily by the host).
 */
export type NodeDefParamTable = ReadonlyMap<string, NodeDefParamDescriptor>;

// ---------------------------------------------------------------------------
// Canonical registry — v1 minimal proof set (synth-nodes.md §2.4)
// ---------------------------------------------------------------------------

/**
 * The descriptor for the canonical `osc/sine` v1 NodeDef.
 *
 * Mirrors `osc_sine_registry_json()` in `src-useq/nodedef/osc_sine.h`:
 * zero audio inputs, one mono audio output, `freq`/`amp` block-rate
 * controls, FTZ, 10 ms / 30 ms fade defaults. Kept inline as the
 * `src/contracts` source of truth so the host adapter, the eval-to-engine
 * commit, and the worklet host all share one descriptor for the M1
 * proof-of-sound vertical slice.
 *
 * The osc/sine WASM module emits the same JSON at runtime; the adapter
 * asserts equality before instantiation so a stale bundle cannot slip
 * past the contract.
 */
export const OSC_SINE_NODEDEF_DESCRIPTOR: NodeDefDescriptor = Object.freeze({
  name: "osc/sine",
  version: 1,
  audioInputs: 0,
  audioOutputs: 1,
  voiceFanout: false,
  params: Object.freeze([
    Object.freeze({
      name: "freq",
      default: 440,
      rate: "block",
      smoothing: "step",
    }),
    Object.freeze({
      name: "amp",
      default: 0.2,
      rate: "block",
      smoothing: "linear",
    }),
  ]),
  fadeInMs: 10,
  fadeOutMs: 30,
  stateBytes: 24,
  stateAlign: 8,
  controlStrideBytes: 8,
  outputStrideBytes: 8,
  minQuantum: 1,
  maxQuantum: 8192,
  sampleRate: 48000,
});

/**
 * The static M1 registry: the complete set of descriptors the host can
 * instantiate. Adding a def here is the editor-side half of registering a
 * new NodeDef; the other half is loading its WASM module through the
 * asset pipeline.
 *
 * Future defs (`osc/saw`, `filt/svf`, `amp/vca`, `noise/white`,
 * `fx/delay`, `voice/fm`, `out/stereo`) are listed in
 * `src-useq/docs/specs/synth-nodes.md` §2.4 as the v1 minimal proof set.
 * They will land in their own features; the registry contract here is
 * ready to receive them without an API change.
 */
export const NODEDEF_REGISTRY: readonly NodeDefDescriptor[] = Object.freeze([
  OSC_SINE_NODEDEF_DESCRIPTOR,
]);

/**
 * Look up a descriptor by `(name, version)`. Returns `null` when the def
 * is not registered. Callers (the eval-to-engine commit, the worklet
 * host) use this to validate synth declarations before touching the DSP
 * module.
 */
export function findNodeDefDescriptor(
  name: string,
  version: number,
): NodeDefDescriptor | null {
  for (const desc of NODEDEF_REGISTRY) {
    if (desc.name === name && desc.version === version) {
      return desc;
    }
  }
  return null;
}

/**
 * Build a name → param lookup table for fast channel routing. The host
 * builds one of these per active descriptor.
 */
export function buildNodeDefParamTable(
  desc: NodeDefDescriptor,
): NodeDefParamTable {
  const table = new Map<string, NodeDefParamDescriptor>();
  for (const param of desc.params) {
    table.set(param.name, param);
  }
  return table;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate that a runtime-registry JSON payload conforms to the
 * {@link NodeDefDescriptor} schema.
 *
 * The host calls this immediately after parsing the module's
 * `*_registry_json` export. A descriptor that fails validation fails
 * closed: the host refuses to instantiate the def and surfaces a
 * compile-style diagnostic.
 */
export function isNodeDefDescriptor(value: unknown): value is NodeDefDescriptor {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.name === "string" && v.name.length > 0 &&
    typeof v.version === "number" && Number.isInteger(v.version) && v.version > 0 &&
    typeof v.audioInputs === "number" && Number.isInteger(v.audioInputs) && v.audioInputs >= 0 &&
    typeof v.audioOutputs === "number" && Number.isInteger(v.audioOutputs) && v.audioOutputs >= 0 &&
    typeof v.voiceFanout === "boolean" &&
    Array.isArray(v.params) && v.params.every(isNodeDefParamDescriptor) &&
    typeof v.fadeInMs === "number" && v.fadeInMs >= 0 &&
    typeof v.fadeOutMs === "number" && v.fadeOutMs >= 0 &&
    typeof v.stateBytes === "number" && Number.isInteger(v.stateBytes) && v.stateBytes >= 0 &&
    typeof v.stateAlign === "number" && Number.isInteger(v.stateAlign) && v.stateAlign >= 0 &&
    typeof v.controlStrideBytes === "number" && Number.isInteger(v.controlStrideBytes) && v.controlStrideBytes >= 0 &&
    typeof v.outputStrideBytes === "number" && Number.isInteger(v.outputStrideBytes) && v.outputStrideBytes >= 0 &&
    typeof v.minQuantum === "number" && Number.isInteger(v.minQuantum) && v.minQuantum >= 1 &&
    typeof v.maxQuantum === "number" && Number.isInteger(v.maxQuantum) && v.maxQuantum >= v.minQuantum &&
    typeof v.sampleRate === "number" && v.sampleRate > 0
  );
}

/**
 * Validate a single param descriptor. Internal helper for
 * {@link isNodeDefDescriptor}.
 */
function isNodeDefParamDescriptor(value: unknown): value is NodeDefParamDescriptor {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.name === "string" && v.name.length > 0 &&
    typeof v.default === "number" && Number.isFinite(v.default) &&
    (v.rate === "block" || v.rate === "fast") &&
    (v.smoothing === "step" || v.smoothing === "linear" ||
      v.smoothing === "slew" || v.smoothing === "latch") &&
    (v.pointsPerBlock === undefined ||
      (typeof v.pointsPerBlock === "number" && Number.isInteger(v.pointsPerBlock) && v.pointsPerBlock > 0)) &&
    (v.min === undefined || typeof v.min === "number") &&
    (v.max === undefined || typeof v.max === "number")
  );
}

/**
 * Compare two descriptors for equality. The host uses this to assert that
 * a loaded WASM module's registry JSON matches the editor-side descriptor
 * exactly before instantiating the def.
 */
export function nodeDefDescriptorsEqual(
  a: NodeDefDescriptor,
  b: NodeDefDescriptor,
): boolean {
  if (a.name !== b.name) return false;
  if (a.version !== b.version) return false;
  if (a.audioInputs !== b.audioInputs) return false;
  if (a.audioOutputs !== b.audioOutputs) return false;
  if (a.voiceFanout !== b.voiceFanout) return false;
  if (a.fadeInMs !== b.fadeInMs) return false;
  if (a.fadeOutMs !== b.fadeOutMs) return false;
  if (a.stateBytes !== b.stateBytes) return false;
  if (a.stateAlign !== b.stateAlign) return false;
  if (a.controlStrideBytes !== b.controlStrideBytes) return false;
  if (a.outputStrideBytes !== b.outputStrideBytes) return false;
  if (a.minQuantum !== b.minQuantum) return false;
  if (a.maxQuantum !== b.maxQuantum) return false;
  if (a.sampleRate !== b.sampleRate) return false;
  if (a.params.length !== b.params.length) return false;
  for (let i = 0; i < a.params.length; i++) {
    const pa = a.params[i];
    const pb = b.params[i];
    if (pa.name !== pb.name) return false;
    if (pa.default !== pb.default) return false;
    if (pa.rate !== pb.rate) return false;
    if (pa.smoothing !== pb.smoothing) return false;
    if ((pa.pointsPerBlock ?? null) !== (pb.pointsPerBlock ?? null)) return false;
  }
  return true;
}
