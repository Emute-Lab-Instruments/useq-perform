/**
 * Synthesis SharedArrayBuffer control ABI — single source of truth.
 *
 * This module is the **only** place where the binary layout of the synthesis
 * control ring may be defined. Producers, consumers, the AudioWorklet host,
 * and the WASM runtime Worker all consume these constants and helpers; no
 * second binary layout may exist.
 *
 * Fulfils (see `docs/specs/synthesis.md` §4.8 and the mission validation
 * contract):
 *   VAL-SAB-001 — one dependency-free source of truth
 *   VAL-SAB-002 — layout is exact and aligned
 *   VAL-SAB-003 — fields respect declared widths
 *   VAL-SAB-004 — invalid layouts are rejected
 *   VAL-SAB-005 — initial values are deterministic
 *   VAL-SAB-006 — runtime quantum is represented safely
 *   VAL-SAB-007 — block-rate records round-trip
 *   VAL-SAB-008 — fast-channel records round-trip
 *   VAL-SAB-009 — event records preserve frame offsets
 *   VAL-SAB-010 — ring wrapping preserves order
 *   VAL-SAB-011 — full, empty, and overrun are distinct
 *   VAL-SAB-013 — incomplete slots remain invisible
 *   VAL-SAB-014 — audio frame publication wakes the producer
 *   VAL-SAB-015 — epoch and revision remain attached to blocks
 *   VAL-SAB-017 — liveness and telemetry are isolated
 *   VAL-SAB-018 — header mismatch fails closed
 *   VAL-SAB-019 — worklet-facing ABI never waits
 *
 * Memory model (normative target, see `synthesis.md` §4.8):
 *   - Ring publication uses atomic indices. Audio-frame publication stores
 *     the frame and wake sequence atomically, then issues a non-blocking
 *     `Atomics.notify` to the producer.
 *   - Worklet-facing helpers expose no `Atomics.wait` or other blocking
 *     primitive. Only the Worker pacing helper waits, with a bounded cap.
 *   - Payload values do not require atomic floating-point writes: a torn
 *     Float32 word is impossible to observe because the consumer never reads
 *     payload outside the published window.
 *
 * This module deliberately has no DOM, browser-global, or higher-layer
 * imports so it stays importable from `src/contracts/` without violating the
 * dependency-light import boundary (see `eslint.config.js`).
 */

// ---------------------------------------------------------------------------
// Magic, version, alignment
// ---------------------------------------------------------------------------

/**
 * Magic ASCII bytes stored at offset 0. Used to detect an unrelated or
 * corrupted buffer before any payload access.
 *
 * The string form is the canonical four-character identifier; tests and
 * diagnostics compare against this constant.
 */
export const ABI_MAGIC = "SAB1" as const;

/** UTF-8 byte encoding of {@link ABI_MAGIC} for direct comparison. */
export const ABI_MAGIC_BYTES = Object.freeze([
  0x53, 0x41, 0x42, 0x31, // "SAB1"
] as const);

/**
 * Numeric ABI version. Bumped only when the byte layout changes in a way that
 * would break older consumers. Mismatched versions fail closed (VAL-SAB-018).
 */
export const ABI_VERSION = 1 as const;

/** Alignment boundary (bytes) for the header and ring base. */
export const HEADER_ALIGN_BYTES = 8 as const;

/** Alignment boundary (bytes) for record fields inside a slot. */
export const BLOCK_RATE_ALIGN_BYTES = 4 as const;

// ---------------------------------------------------------------------------
// Named engine constants — derived from the accepted synthesis specification
// ---------------------------------------------------------------------------

/**
 * Default render quantum in frames per block. Browsers typically use 128.
 * The runtime may observe a different value (see `renderSizeHint`); the ABI
 * stores the active quantum in the header so producer and consumer agree.
 */
export const DEFAULT_RENDER_QUANTUM_FRAMES = 128 as const;

/** Minimum supported render quantum. Smaller values are rejected. */
export const MIN_RENDER_QUANTUM_FRAMES = 1 as const;

/** Maximum supported render quantum. Larger values are rejected. */
export const MAX_RENDER_QUANTUM_FRAMES = 8192 as const;

/** Reserved activation-epoch sentinel: no program/candidate is active. */
export const NO_ACTIVATION_EPOCH = 0 as const;

/** First issuable activation epoch. */
export const MIN_ACTIVATION_EPOCH = 1 as const;

/**
 * Last issuable activation epoch. Epochs cross the Worker/worklet boundary in
 * uint32 SAB fields, so the allocator must exhaust here before reuse/wrap.
 */
export const MAX_ACTIVATION_EPOCH = 0xffff_ffff as const;

/**
 * Ring capacity in blocks. Must be a power of two so the slot index wraps
 * with a bitmask instead of a modulo that could overflow. The producer and
 * consumer never publish/consume past this many outstanding blocks.
 */
export const RING_CAPACITY_BLOCKS = 64 as const;

/**
 * Number of block-rate control channels. Block-rate channels are sampled
 * once per render quantum and assigned per-(node, param) by the
 * engine-commit coordinator from the compiler's control channel table
 * (`synth-nodes.md` §7.2). Sized for realistic multi-node programs
 * (64 nodes × ~2 bound params); a commit whose channel table exceeds the
 * pool is rejected at eval commit with a compile-style diagnostic
 * (mirroring the `MAX_SYNTH_NODES` check) rather than silently truncated.
 */
export const DEFAULT_BLOCK_RATE_COUNT = 128 as const;

/**
 * Number of fast-rate control channels. Fast-rate channels deliver a
 * declared higher control rate as `FAST_POINTS_PER_BLOCK` samples per block.
 */
export const DEFAULT_FAST_RATE_COUNT = 4 as const;

/** Declared control points per block for fast-rate channels. */
export const DEFAULT_FAST_POINTS_PER_BLOCK = 8 as const;

/**
 * Number of event (latch) channels. Event channels carry timestamped edges
 * inside the block (see `synthesis.md` §4.6).
 */
export const DEFAULT_EVENT_CHANNELS = 8 as const;

/**
 * Maximum event records per channel per block. Excess events are rejected
 * before publication so the slot stride stays bounded.
 */
export const DEFAULT_EVENT_SLOTS_PER_CHANNEL = 8 as const;

/**
 * Control lookahead in blocks (see `synthesis.md` §4.5). Producer publishes
 * future-block controls into the ring up to this depth.
 */
export const CONTROL_LOOKAHEAD_BLOCKS = 6 as const;
export const MIN_CONTROL_LOOKAHEAD_BLOCKS = 4 as const;
export const MAX_CONTROL_LOOKAHEAD_BLOCKS = 8 as const;

/**
 * Producer timeout in blocks (see `synthesis.md` §4.7). If no ring writes
 * arrive for this many blocks, the worklet declares producer loss and fades
 * to silence.
 */
export const PRODUCER_TIMEOUT_BLOCKS = 24 as const;

/**
 * Service-side deadline for the producer's FIRST ring publication after
 * `producerStart` resolves (`synthesis.md` §4.7). The worklet-side
 * liveness timeout only ages once the producer has published at least
 * one block, so a producer that dies before its first publish would
 * otherwise leave the engine reporting `running` over eternal silence.
 */
export const PRODUCER_FIRST_PUBLISH_DEADLINE_MS = 250 as const;

/**
 * Service-side deadline for the worklet's `attach-control-buffer-ack`
 * (`synthesis.md` §4.8). A missing or negative ack means the worklet
 * rejected the SAB (typically an ABI mismatch from a stale cached
 * worklet bundle) and must surface as a fatal startup error rather
 * than indefinite silence.
 */
export const ATTACH_CONTROL_BUFFER_ACK_TIMEOUT_MS = 500 as const;

/**
 * Upper bound for a single producer pacing wait (`synthesis.md` §4.1).
 * The producer blocks on the wake word for at most this long per
 * iteration so the Worker inbox (eval requests, stop messages) is
 * serviced promptly even if the worklet stops publishing.
 */
export const PRODUCER_WAKE_WAIT_CAP_MS = 4 as const;

/** Emergency fade length in milliseconds after producer-loss detection. */
export const EMERGENCY_FADE_MS = 10 as const;

/** Default fade-in duration in milliseconds on node instantiation. */
export const SYNTH_FADE_IN_MS = 10 as const;

/** Default release fade duration in milliseconds on node free. */
export const SYNTH_FADE_OUT_MS = 30 as const;

/**
 * Consecutive missed render deadlines before the engine enters overload
 * protection. The overload-fade behavior itself lands in M2
 * (`synthesis.md` §3.6); this constant is defined here per the epic's
 * one-contract-module rule.
 */
export const OVERLOAD_BLOCKS = 8 as const;

/**
 * Resource limits (from `synthesis.md` §3.5). Declared in the contract so
 * consumers and producers share one source of truth, even though M1 only
 * hosts a single osc/sine instance.
 */
export const MAX_SYNTH_NODES = 64 as const;
export const MAX_SYNTH_VOICES = 128 as const;
export const MAX_VOICE_WIDTH = 16 as const;
export const SYNTH_MEMORY_MAX_BYTES = 64 * 1024 * 1024;

/**
 * Bytes reserved at the bottom of the host-owned shared-memory arena so
 * the zone allocator never hands out pointer 0. Graph-delta messages use
 * `statePointer === 0` as the "worklet allocates on my behalf" sentinel
 * (see `WorkletInstantiateMessage`), so a real zone at offset 0 would be
 * indistinguishable from "not allocated". `synthesis.md` §2.3.
 */
export const SYNTH_ARENA_NULL_GUARD_BYTES = 64 as const;

/**
 * Default number of audio output ports a node exposes when the delta
 * message does not carry an explicit `audioOutputs` count (mono, matching
 * the M1 osc/sine shape).
 */
export const DEFAULT_AUDIO_OUTPUT_PORTS = 1 as const;

/**
 * Composite producer-channel key for a per-(node, param) control channel.
 * The Worker producer's compiler-index mapping is keyed by this string; the
 * NUL separator cannot occur inside an identity (the compiler's artefact
 * serialiser strips control characters) so the key is collision-free. The
 * service arms keys in compiler-table order after filtering non-block rows,
 * making the mapping's array index equal the SAB channel index.
 */
export function controlChannelKey(identity: string, param: string): string {
  return `${identity}\u0000${param}`;
}

/**
 * Worklet-facing helpers documented as non-blocking. Every name listed here
 * is part of the public `SynthesisControlView` API and is guaranteed not to
 * call `Atomics.wait` or any other blocking operation. `publishAudioFrame`
 * may call the non-blocking `Atomics.notify`; only the Worker pacing path
 * waits, and only with a bounded timeout.
 *
 * VAL-SAB-019: this list is the contract surface for that invariant.
 */
export const WORKLET_HELPERS_DOCUMENTED_NON_BLOCKING = Object.freeze([
  "readBlockRateValue",
  "writeBlockRateValue",
  "readFastRateValue",
  "writeFastRateValue",
  "readEvent",
  "writeEvent",
  "eventCount",
  "readBlockEpoch",
  "writeBlockEpoch",
  "readBlockRevision",
  "writeBlockRevision",
  "advanceWriteIndex",
  "consumerAvailableBlocks",
  "ringFillDepth",
  "isRingEmpty",
  "isRingOverrun",
  "physicalSlotForSequence",
  "publishAudioFrame",
  "initialise",
] as const);

// ---------------------------------------------------------------------------
// Header offsets (single source of truth — byte positions inside the header)
// ---------------------------------------------------------------------------

/** Total bytes reserved for the header (8-byte aligned). */
export const HEADER_SIZE_BYTES = 256 as const;

/** Fixed byte offsets for every header field. */
export const HEADER_OFFSETS = Object.freeze({
  magic: 0,
  abiVersion: 4,
  byteLength: 8,
  headerSize: 12,
  ringBase: 16,
  ringCapacityBlocks: 20,
  slotStride: 24,
  renderQuantumFrames: 28,
  blockRateCount: 32,
  fastRateCount: 36,
  fastPointsPerBlock: 40,
  eventChannelCount: 44,
  eventSlotsPerChannel: 48,
  controlLookaheadBlocks: 52,
  producerTimeoutBlocks: 56,
  synthFadeInMs: 60,
  synthFadeOutMs: 64,
  emergencyFadeMs: 68,
  pendingEpoch: 72,
  programEpoch: 76,
  controlRevision: 80,
  ringWriteIndex: 84,
  ringReadIndex: 88,
  producerLivenessBlock: 92,
  producerLivenessAge: 96,
  underrunCount: 100,
  glitchCount: 104,
  timeoutCount: 108,
  finiteOutput: 112,
  peakSample: 116,
  rmsSample: 120,
  audioFrame: 128,
  wakeSequence: 136,
} as const);

// ---------------------------------------------------------------------------
// Slot layout helper
// ---------------------------------------------------------------------------

/**
 * Compute the slot stride (bytes per ring block) for the given record counts.
 *
 * Layout inside a slot (all little-endian, 4-byte aligned):
 *   - blockEpoch         (uint32)
 *   - blockRevision      (uint32)
 *   - blockFrameOffset   (uint32)
 *   - eventCounts        (uint32 × eventChannelCount)
 *   - blockRateValues    (float32 × blockRateCount)
 *   - fastRateValues     (float32 × fastRateCount × fastPointsPerBlock)
 *   - eventRecords       (8 bytes × eventChannelCount × eventSlotsPerChannel)
 *
 * The event record layout is `{ value: float32, frameOffset: uint32 }`.
 */
export function computeSlotStride(options: {
  blockRateCount: number;
  fastRateCount: number;
  fastPointsPerBlock: number;
  eventChannelCount: number;
  eventSlotsPerChannel: number;
}): number {
  const eventCountsBytes = 4 * options.eventChannelCount;
  const blockRateBytes = 4 * options.blockRateCount;
  const fastRateBytes =
    4 * options.fastRateCount * options.fastPointsPerBlock;
  const eventRecordsBytes =
    8 * options.eventChannelCount * options.eventSlotsPerChannel;

  const prefix = 12; // epoch + revision + frameOffset
  const total =
    prefix + eventCountsBytes + blockRateBytes + fastRateBytes + eventRecordsBytes;
  // Round up to 8-byte alignment to keep the next slot header aligned.
  return Math.ceil(total / 8) * 8;
}

/**
 * Return the byte offsets of every record region inside a slot. The returned
 * offsets are relative to the start of the slot.
 */
export function slotFieldOffsets(options: {
  blockRateCount: number;
  fastRateCount: number;
  fastPointsPerBlock: number;
  eventChannelCount: number;
  eventSlotsPerChannel: number;
}): {
  blockEpoch: number;
  blockRevision: number;
  blockFrameOffset: number;
  eventCounts: number;
  blockRateValues: number;
  fastRateValues: number;
  eventRecords: number;
} {
  const eventCountsBytes = 4 * options.eventChannelCount;
  const blockRateBytes = 4 * options.blockRateCount;
  const fastRateBytes =
    4 * options.fastRateCount * options.fastPointsPerBlock;

  const blockEpoch = 0;
  const blockRevision = 4;
  const blockFrameOffset = 8;
  const eventCounts = 12;
  const blockRateValues = eventCounts + eventCountsBytes;
  const fastRateValues = blockRateValues + blockRateBytes;
  const eventRecords = fastRateValues + fastRateBytes;

  return {
    blockEpoch,
    blockRevision,
    blockFrameOffset,
    eventCounts,
    blockRateValues,
    fastRateValues,
    eventRecords,
  };
}

// ---------------------------------------------------------------------------
// Buffer sizing
// ---------------------------------------------------------------------------

/**
 * Options for {@link computeByteLength} and {@link createSynthesisControlBuffer}.
 * Every field has a sensible default drawn from the named engine constants.
 */
export interface SynthesisControlLayoutOptions {
  /** Render quantum in frames. Must be in `[MIN_RENDER_QUANTUM_FRAMES, MAX_RENDER_QUANTUM_FRAMES]`. */
  renderQuantumFrames?: number;
  /** Ring capacity in blocks. Must be a positive power of two. */
  ringCapacityBlocks?: number;
  /** Number of block-rate channels. */
  blockRateCount?: number;
  /** Number of fast-rate channels. */
  fastRateCount?: number;
  /** Declared control points per block for fast-rate channels. */
  fastPointsPerBlock?: number;
  /** Number of event (latch) channels. */
  eventChannelCount?: number;
  /** Maximum event records per channel per block. */
  eventSlotsPerChannel?: number;
}

function normaliseLayoutOptions(
  options: SynthesisControlLayoutOptions | undefined,
): Required<SynthesisControlLayoutOptions> {
  const o: Required<SynthesisControlLayoutOptions> = {
    renderQuantumFrames:
      options?.renderQuantumFrames ?? DEFAULT_RENDER_QUANTUM_FRAMES,
    ringCapacityBlocks:
      options?.ringCapacityBlocks ?? RING_CAPACITY_BLOCKS,
    blockRateCount: options?.blockRateCount ?? DEFAULT_BLOCK_RATE_COUNT,
    fastRateCount: options?.fastRateCount ?? DEFAULT_FAST_RATE_COUNT,
    fastPointsPerBlock:
      options?.fastPointsPerBlock ?? DEFAULT_FAST_POINTS_PER_BLOCK,
    eventChannelCount:
      options?.eventChannelCount ?? DEFAULT_EVENT_CHANNELS,
    eventSlotsPerChannel:
      options?.eventSlotsPerChannel ?? DEFAULT_EVENT_SLOTS_PER_CHANNEL,
  };
  validateLayoutOptions(o);
  return o;
}

/**
 * Validate layout options. Throws on any unsupported configuration so the
 * producer and consumer can never start from an inconsistent buffer.
 */
export function validateLayoutOptions(
  options: Required<SynthesisControlLayoutOptions>,
): void {
  const q = options.renderQuantumFrames;
  if (
    !Number.isInteger(q) ||
    q < MIN_RENDER_QUANTUM_FRAMES ||
    q > MAX_RENDER_QUANTUM_FRAMES
  ) {
    throw new RangeError(
      `renderQuantumFrames must be an integer in [${MIN_RENDER_QUANTUM_FRAMES}, ${MAX_RENDER_QUANTUM_FRAMES}], got ${q}`,
    );
  }

  const cap = options.ringCapacityBlocks;
  if (!Number.isInteger(cap) || cap < 1 || (cap & (cap - 1)) !== 0) {
    throw new RangeError(
      `ringCapacityBlocks must be a positive power of two, got ${cap}`,
    );
  }

  if (!Number.isInteger(options.blockRateCount) || options.blockRateCount < 0) {
    throw new RangeError(
      `blockRateCount must be a non-negative integer, got ${options.blockRateCount}`,
    );
  }
  if (!Number.isInteger(options.fastRateCount) || options.fastRateCount < 0) {
    throw new RangeError(
      `fastRateCount must be a non-negative integer, got ${options.fastRateCount}`,
    );
  }
  if (
    !Number.isInteger(options.fastPointsPerBlock) ||
    options.fastPointsPerBlock < 0
  ) {
    throw new RangeError(
      `fastPointsPerBlock must be a non-negative integer, got ${options.fastPointsPerBlock}`,
    );
  }
  if (
    !Number.isInteger(options.eventChannelCount) ||
    options.eventChannelCount < 0
  ) {
    throw new RangeError(
      `eventChannelCount must be a non-negative integer, got ${options.eventChannelCount}`,
    );
  }
  if (
    !Number.isInteger(options.eventSlotsPerChannel) ||
    options.eventSlotsPerChannel < 0
  ) {
    throw new RangeError(
      `eventSlotsPerChannel must be a non-negative integer, got ${options.eventSlotsPerChannel}`,
    );
  }
}

/**
 * Compute the exact byte length required for a buffer with the given layout.
 */
export function computeByteLength(
  options: SynthesisControlLayoutOptions = {},
): number {
  const o = normaliseLayoutOptions(options);
  const stride = computeSlotStride({
    blockRateCount: o.blockRateCount,
    fastRateCount: o.fastRateCount,
    fastPointsPerBlock: o.fastPointsPerBlock,
    eventChannelCount: o.eventChannelCount,
    eventSlotsPerChannel: o.eventSlotsPerChannel,
  });
  const ringBytes = o.ringCapacityBlocks * stride;
  const total = HEADER_SIZE_BYTES + ringBytes;
  // Align the total length up so the whole buffer is 8-byte aligned.
  return Math.ceil(total / HEADER_ALIGN_BYTES) * HEADER_ALIGN_BYTES;
}

// ---------------------------------------------------------------------------
// Attachment / validation
// ---------------------------------------------------------------------------

/** Error thrown when a buffer fails ABI validation. */
export class SynthesisAbiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SynthesisAbiError";
  }
}

/**
 * Validate a buffer's header and declared layout without throwing.
 *
 * Returns `true` only when:
 *   - the byte length is at least the minimum header size and is 8-byte aligned;
 *   - the magic bytes match {@link ABI_MAGIC_BYTES};
 *   - the stored ABI version equals {@link ABI_VERSION};
 *   - the declared byte length equals the buffer's actual byte length;
 *   - the declared ring capacity is a positive power of two;
 *   - the declared ring base and slot stride fit inside the buffer;
 *   - the declared ring region fits inside the declared byte length.
 */
export function isSynthesisControlBuffer(buffer: ArrayBufferLike): boolean {
  try {
    validateBufferHeader(buffer);
    return true;
  } catch {
    return false;
  }
}

/**
 * Throw if `buffer` does not satisfy the ABI invariants. Used by
 * {@link attachSynthesisControlView} before exposing the payload helpers.
 */
export function validateBufferHeader(buffer: ArrayBufferLike): void {
  if (!(buffer instanceof ArrayBuffer) && !(buffer instanceof SharedArrayBuffer)) {
    throw new SynthesisAbiError(
      "Expected an ArrayBuffer or SharedArrayBuffer backing store",
    );
  }
  if (buffer.byteLength < HEADER_SIZE_BYTES) {
    throw new SynthesisAbiError(
      `Buffer is truncated: ${buffer.byteLength} bytes, header requires ${HEADER_SIZE_BYTES}`,
    );
  }
  if (buffer.byteLength % HEADER_ALIGN_BYTES !== 0) {
    throw new SynthesisAbiError(
      `Buffer byte length must be ${HEADER_ALIGN_BYTES}-byte aligned, got ${buffer.byteLength}`,
    );
  }

  const dv = new DataView(buffer);

  // Magic bytes (no allocation — direct byte compare).
  for (let i = 0; i < ABI_MAGIC_BYTES.length; i++) {
    if (dv.getUint8(HEADER_OFFSETS.magic + i) !== ABI_MAGIC_BYTES[i]) {
      throw new SynthesisAbiError(
        `ABI magic mismatch at offset ${HEADER_OFFSETS.magic}: expected "${ABI_MAGIC}"`,
      );
    }
  }

  const version = dv.getUint32(HEADER_OFFSETS.abiVersion, true);
  if (version !== ABI_VERSION) {
    throw new SynthesisAbiError(
      `ABI version mismatch: buffer reports ${version}, contract requires ${ABI_VERSION}`,
    );
  }

  const declaredByteLength = dv.getUint32(HEADER_OFFSETS.byteLength, true);
  if (declaredByteLength !== buffer.byteLength) {
    throw new SynthesisAbiError(
      `Declared byte length ${declaredByteLength} does not match storage ${buffer.byteLength}`,
    );
  }

  const headerSize = dv.getUint32(HEADER_OFFSETS.headerSize, true);
  if (headerSize !== HEADER_SIZE_BYTES) {
    throw new SynthesisAbiError(
      `Declared header size ${headerSize} does not match contract ${HEADER_SIZE_BYTES}`,
    );
  }

  const ringBase = dv.getUint32(HEADER_OFFSETS.ringBase, true);
  if (ringBase < headerSize || ringBase % HEADER_ALIGN_BYTES !== 0) {
    throw new SynthesisAbiError(
      `Declared ring base ${ringBase} is misaligned or overlaps the header`,
    );
  }

  const ringCapacity = dv.getUint32(HEADER_OFFSETS.ringCapacityBlocks, true);
  if (!Number.isInteger(ringCapacity) || ringCapacity < 1 || (ringCapacity & (ringCapacity - 1)) !== 0) {
    throw new SynthesisAbiError(
      `Declared ring capacity ${ringCapacity} is not a positive power of two`,
    );
  }

  const slotStride = dv.getUint32(HEADER_OFFSETS.slotStride, true);
  if (slotStride < BLOCK_RATE_ALIGN_BYTES) {
    throw new SynthesisAbiError(
      `Declared slot stride ${slotStride} is smaller than the minimum alignment`,
    );
  }

  const ringEnd = ringBase + ringCapacity * slotStride;
  if (ringEnd > declaredByteLength) {
    throw new SynthesisAbiError(
      `Declared ring region [${ringBase}, ${ringEnd}) overruns storage byte length ${declaredByteLength}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Buffer creation
// ---------------------------------------------------------------------------

/**
 * Allocate and initialise a new ArrayBuffer that satisfies the synthesis
 * control ABI. Suitable for testing and for main-thread allocation that will
 * be wrapped in a SharedArrayBuffer for production use.
 *
 * The buffer is initialised with the magic, version, declared layout fields,
 * and zeroed runtime state (frame/wake/epoch/revision/ring indices/telemetry).
 */
export function createSynthesisControlBuffer(
  options: SynthesisControlLayoutOptions = {},
): ArrayBuffer {
  const o = normaliseLayoutOptions(options);
  const stride = computeSlotStride({
    blockRateCount: o.blockRateCount,
    fastRateCount: o.fastRateCount,
    fastPointsPerBlock: o.fastPointsPerBlock,
    eventChannelCount: o.eventChannelCount,
    eventSlotsPerChannel: o.eventSlotsPerChannel,
  });
  const totalLength = computeByteLength(o);

  const buffer = new ArrayBuffer(totalLength);
  const view = new DataView(buffer);

  // Magic.
  for (let i = 0; i < ABI_MAGIC_BYTES.length; i++) {
    view.setUint8(HEADER_OFFSETS.magic + i, ABI_MAGIC_BYTES[i]);
  }
  // Layout descriptor.
  view.setUint32(HEADER_OFFSETS.abiVersion, ABI_VERSION, true);
  view.setUint32(HEADER_OFFSETS.byteLength, totalLength, true);
  view.setUint32(HEADER_OFFSETS.headerSize, HEADER_SIZE_BYTES, true);
  view.setUint32(HEADER_OFFSETS.ringBase, HEADER_SIZE_BYTES, true);
  view.setUint32(HEADER_OFFSETS.ringCapacityBlocks, o.ringCapacityBlocks, true);
  view.setUint32(HEADER_OFFSETS.slotStride, stride, true);
  view.setUint32(HEADER_OFFSETS.renderQuantumFrames, o.renderQuantumFrames, true);
  view.setUint32(HEADER_OFFSETS.blockRateCount, o.blockRateCount, true);
  view.setUint32(HEADER_OFFSETS.fastRateCount, o.fastRateCount, true);
  view.setUint32(HEADER_OFFSETS.fastPointsPerBlock, o.fastPointsPerBlock, true);
  view.setUint32(HEADER_OFFSETS.eventChannelCount, o.eventChannelCount, true);
  view.setUint32(HEADER_OFFSETS.eventSlotsPerChannel, o.eventSlotsPerChannel, true);
  view.setUint32(HEADER_OFFSETS.controlLookaheadBlocks, CONTROL_LOOKAHEAD_BLOCKS, true);
  view.setUint32(HEADER_OFFSETS.producerTimeoutBlocks, PRODUCER_TIMEOUT_BLOCKS, true);
  view.setUint32(HEADER_OFFSETS.synthFadeInMs, SYNTH_FADE_IN_MS, true);
  view.setUint32(HEADER_OFFSETS.synthFadeOutMs, SYNTH_FADE_OUT_MS, true);
  view.setUint32(HEADER_OFFSETS.emergencyFadeMs, EMERGENCY_FADE_MS, true);

  // Runtime state is zero-initialised by ArrayBuffer allocation. Nothing
  // else to do — see SynthesisControlView.initialise for explicit zeroing.
  return buffer;
}
