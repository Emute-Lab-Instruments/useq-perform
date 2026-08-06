import {
  ABI_MAGIC,
  ABI_MAGIC_BYTES,
  BLOCK_RATE_ALIGN_BYTES,
  CONTROL_LOOKAHEAD_BLOCKS,
  DEFAULT_BLOCK_RATE_COUNT,
  DEFAULT_EVENT_CHANNELS,
  DEFAULT_EVENT_SLOTS_PER_CHANNEL,
  DEFAULT_FAST_POINTS_PER_BLOCK,
  DEFAULT_FAST_RATE_COUNT,
  HEADER_ALIGN_BYTES,
  HEADER_OFFSETS,
  HEADER_SIZE_BYTES,
  MAX_CONTROL_LOOKAHEAD_BLOCKS,
  MIN_CONTROL_LOOKAHEAD_BLOCKS,
  PRODUCER_WAKE_WAIT_CAP_MS,
  RING_CAPACITY_BLOCKS,
  WORKLET_HELPERS_DOCUMENTED_NON_BLOCKING,
  computeByteLength,
  computeSlotStride,
} from "./layout.ts";

/**
 * Build the Worker-only bounded waiter over the header wake word. The
 * AudioWorklet's non-blocking `publishAudioFrame` call notifies this waiter.
 */
export function createProducerPacingWaiter(
  buffer: SharedArrayBuffer,
): (maxWaitMs: number) => void {
  const wake = new BigInt64Array(buffer, HEADER_OFFSETS.wakeSequence, 1);
  return (maxWaitMs: number): void => {
    const expected = Atomics.load(wake, 0);
    Atomics.wait(wake, 0, expected, Math.min(maxWaitMs, PRODUCER_WAKE_WAIT_CAP_MS));
  };
}

// ---------------------------------------------------------------------------
// Static layout-invariant assertions
// ---------------------------------------------------------------------------

/**
 * Verify internal consistency of the ABI constants. Throws if the contract is
 * internally inconsistent. Called once at module load.
 */
export function assertAbiLayoutInvariants(): void {
  // Magic bytes match the magic string.
  if (ABI_MAGIC_BYTES.length !== 4) {
    throw new Error("ABI_MAGIC_BYTES must be exactly 4 bytes");
  }
  if (ABI_MAGIC.length !== 4) {
    throw new Error("ABI_MAGIC must be exactly 4 characters");
  }

  // Header offsets are 4-byte aligned for Uint32 fields and 8-byte aligned
  // for the BigInt64 fields.
  if (HEADER_OFFSETS.audioFrame % 8 !== 0) {
    throw new Error("audioFrame offset must be 8-byte aligned");
  }
  if (HEADER_OFFSETS.wakeSequence % 8 !== 0) {
    throw new Error("wakeSequence offset must be 8-byte aligned");
  }
  if (HEADER_OFFSETS.audioFrame + 8 > HEADER_OFFSETS.wakeSequence) {
    throw new Error("audioFrame field overlaps wakeSequence field");
  }
  if (HEADER_OFFSETS.wakeSequence + 8 > HEADER_SIZE_BYTES) {
    throw new Error("wakeSequence field overruns the declared header size");
  }

  // Power-of-two ring capacity. Cast to `number` so the bitwise check does
  // not narrow against the literal type at compile time.
  const cap: number = RING_CAPACITY_BLOCKS;
  if ((cap & (cap - 1)) !== 0) {
    throw new Error("RING_CAPACITY_BLOCKS must be a power of two");
  }

  // Lookahead range.
  if (
    MIN_CONTROL_LOOKAHEAD_BLOCKS > CONTROL_LOOKAHEAD_BLOCKS ||
    CONTROL_LOOKAHEAD_BLOCKS > MAX_CONTROL_LOOKAHEAD_BLOCKS
  ) {
    throw new Error("CONTROL_LOOKAHEAD_BLOCKS must be inside its declared range");
  }

  // Default layout produces a self-consistent buffer.
  const probe = computeByteLength();
  if (probe % HEADER_ALIGN_BYTES !== 0) {
    throw new Error("Default byte length must be 8-byte aligned");
  }

  // Slot stride is consistent with the default record counts.
  const defaultStride = computeSlotStride({
    blockRateCount: DEFAULT_BLOCK_RATE_COUNT,
    fastRateCount: DEFAULT_FAST_RATE_COUNT,
    fastPointsPerBlock: DEFAULT_FAST_POINTS_PER_BLOCK,
    eventChannelCount: DEFAULT_EVENT_CHANNELS,
    eventSlotsPerChannel: DEFAULT_EVENT_SLOTS_PER_CHANNEL,
  });
  if (defaultStride % BLOCK_RATE_ALIGN_BYTES !== 0) {
    throw new Error("Default slot stride must be 4-byte aligned");
  }

  // WORKLET_HELPERS_DOCUMENTED_NON_BLOCKING must be frozen and non-empty.
  // Cast through `unknown` so TypeScript does not narrow the literal-typed
  // length to its compile-time value of 19.
  const workletHelpers: readonly unknown[] =
    WORKLET_HELPERS_DOCUMENTED_NON_BLOCKING;
  if (!Object.isFrozen(WORKLET_HELPERS_DOCUMENTED_NON_BLOCKING)) {
    throw new Error("WORKLET_HELPERS_DOCUMENTED_NON_BLOCKING must be frozen");
  }
  if (workletHelpers.length === 0) {
    throw new Error("WORKLET_HELPERS_DOCUMENTED_NON_BLOCKING must be non-empty");
  }

  // Type sanity: u32 array element size is 4; the typed-array indices used
  // above divide evenly by 4. Cast to number so the literal-typed offsets do
  // not narrow the comparison at compile time.
  const writeIdxOff: number = HEADER_OFFSETS.ringWriteIndex;
  const readIdxOff: number = HEADER_OFFSETS.ringReadIndex;
  if (writeIdxOff % 4 !== 0) {
    throw new Error("ringWriteIndex offset must be 4-byte aligned for Int32Array");
  }
  if (readIdxOff % 4 !== 0) {
    throw new Error("ringReadIndex offset must be 4-byte aligned for Int32Array");
  }
}

// Fail fast if a future edit breaks the layout.
assertAbiLayoutInvariants();
