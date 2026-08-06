import {
  ABI_MAGIC,
  ABI_VERSION,
  HEADER_OFFSETS,
  MAX_ACTIVATION_EPOCH,
  NO_ACTIVATION_EPOCH,
  slotFieldOffsets,
  validateBufferHeader,
} from "./layout.ts";

export interface SynthesisControlEvent {
  /** Edge value (typically 0/1 for a gate). */
  value: number;
  /** Frame offset within the block, in `[0, renderQuantumFrames)`. */
  frameOffset: number;
}

/** Argument for {@link SynthesisControlView.publishAudioFrame}. */
export interface PublishAudioFrameOptions {
  /** New monotonic audio frame counter. */
  frame: bigint;
  /** Absolute frame at the start of the block being processed. */
  blockFrameOffset: number;
}

/**
 * Typed view over a synthesis control buffer. Exposes every payload helper
 * the producer, consumer, worklet, and worker scheduling path need.
 *
 * Invariants enforced by this interface:
 *   - No method on this object calls `Atomics.wait` or otherwise blocks.
 *   - `publishAudioFrame` may issue the non-blocking `Atomics.notify` wake.
 *   - No method blocks.
 *   - All methods validate their arguments and throw on out-of-bounds access.
 */
export interface SynthesisControlView {
  // --- Layout descriptor (read-only after creation) ---
  readonly magic: string;
  readonly abiVersion: number;
  readonly byteLength: number;
  readonly headerSize: number;
  readonly ringBase: number;
  readonly ringCapacityBlocks: number;
  readonly slotStride: number;
  readonly renderQuantumFrames: number;
  readonly blockRateCount: number;
  readonly fastRateCount: number;
  readonly fastPointsPerBlock: number;
  readonly eventChannelCount: number;
  readonly eventSlotsPerChannel: number;

  // --- Header byte offsets exposed for tests / static inspection ---
  readonly magicOffset: number;
  readonly abiVersionOffset: number;
  readonly byteLengthOffset: number;
  readonly ringBaseOffset: number;
  readonly ringCapacityOffset: number;
  readonly slotStrideOffset: number;

  // --- Runtime state ---
  audioFrame: bigint;
  wakeSequence: bigint;
  programEpoch: number;
  pendingEpoch: number;
  controlRevision: number;
  ringWriteIndex: number;
  ringReadIndex: number;
  producerLivenessBlock: number;
  producerLivenessAge: number;

  // --- Telemetry ---
  underrunCount: number;
  glitchCount: number;
  timeoutCount: number;
  peakSample: number;
  rmsSample: number;
  finiteOutput: number;

  // --- Lifecycle ---
  /** Zero every runtime state field (called from `createSynthesisControlBuffer`). */
  initialise(): void;

  // --- Per-block record helpers ---
  writeBlockRateValue(block: number, channel: number, value: number): void;
  readBlockRateValue(block: number, channel: number): number;
  writeFastRateValue(block: number, channel: number, point: number, value: number): void;
  readFastRateValue(block: number, channel: number, point: number): number;

  writeEvent(block: number, channel: number, slot: number, event: SynthesisControlEvent): void;
  readEvent(block: number, channel: number, slot: number): SynthesisControlEvent;
  eventCount(block: number, channel: number): number;
  setEventCount(block: number, channel: number, count: number): void;

  readBlockEpoch(block: number): number;
  writeBlockEpoch(block: number, epoch: number): void;
  readBlockRevision(block: number): number;
  writeBlockRevision(block: number, revision: number): void;
  readBlockFrameOffset(block: number): number;
  writeBlockFrameOffset(block: number, offset: number): void;

  // --- Ring publication ---
  /**
   * Atomically release-publish the next write index. The slot written
   * immediately before this call becomes visible to the consumer only after
   * this method returns.
   *
   * This is the ONLY producer publication step that exposes a slot. A
   * consumer that has not seen the new write index will not observe any
   * payload mutation inside the new slot (VAL-SAB-013).
   */
  advanceWriteIndex(): void;

  /** Acquire-load the write index. Used by the consumer before reading. */
  acquireWriteIndex(): number;

  /** Advance the consumer's read index after consuming a block. */
  advanceReadIndex(): void;

  /** Number of blocks the consumer may read (acquired). */
  consumerAvailableBlocks(): number;

  /** Current fill depth (write - read, modulo ring semantics). */
  ringFillDepth(): number;

  /** True when the ring holds zero published blocks. */
  isRingEmpty(): boolean;

  /** True when the producer has lapped the consumer beyond capacity. */
  isRingOverrun(): boolean;

  /** Map a logical sequence number to a physical slot index. */
  physicalSlotForSequence(sequence: number): number;

  /**
   * Publish a new audio frame and increment the wake sequence. The producer
   * observes the wake sequence via `Atomics.wait` (Worker path only).
   *
   * Throws on non-monotonic frame values.
   */
  publishAudioFrame(options: PublishAudioFrameOptions): void;
}

/**
 * Attach a typed view to a buffer. Validates the header first; throws on
 * mismatched magic, version, or inconsistent storage.
 *
 * The view retains a reference to the underlying buffer. The caller is
 * responsible for not detaching the buffer (or transferring a
 * SharedArrayBuffer-backed view across Worker boundaries).
 */
export function attachSynthesisControlView(
  buffer: ArrayBufferLike,
): SynthesisControlView {
  validateBufferHeader(buffer);

  const dv = new DataView(buffer);
  const i32 = new Int32Array(buffer);
  const bi64 = new BigInt64Array(buffer, HEADER_OFFSETS.audioFrame, 1);
  const bi64Wake = new BigInt64Array(buffer, HEADER_OFFSETS.wakeSequence, 1);

  const byteLength = dv.getUint32(HEADER_OFFSETS.byteLength, true);
  const headerSize = dv.getUint32(HEADER_OFFSETS.headerSize, true);
  const ringBase = dv.getUint32(HEADER_OFFSETS.ringBase, true);
  const ringCapacityBlocks = dv.getUint32(HEADER_OFFSETS.ringCapacityBlocks, true);
  const slotStride = dv.getUint32(HEADER_OFFSETS.slotStride, true);
  const renderQuantumFrames = dv.getUint32(HEADER_OFFSETS.renderQuantumFrames, true);
  const blockRateCount = dv.getUint32(HEADER_OFFSETS.blockRateCount, true);
  const fastRateCount = dv.getUint32(HEADER_OFFSETS.fastRateCount, true);
  const fastPointsPerBlock = dv.getUint32(HEADER_OFFSETS.fastPointsPerBlock, true);
  const eventChannelCount = dv.getUint32(HEADER_OFFSETS.eventChannelCount, true);
  const eventSlotsPerChannel = dv.getUint32(HEADER_OFFSETS.eventSlotsPerChannel, true);

  const fieldOffsets = slotFieldOffsets({
    blockRateCount,
    fastRateCount,
    fastPointsPerBlock,
    eventChannelCount,
    eventSlotsPerChannel,
  });

  // ----- Bounds-check helpers -----
  function requireBlockIndex(block: number): void {
    if (!Number.isInteger(block) || block < 0 || block >= ringCapacityBlocks) {
      throw new RangeError(
        `Block index ${block} is out of range [0, ${ringCapacityBlocks})`,
      );
    }
  }

  function requireActivationEpoch(epoch: number): void {
    if (!Number.isSafeInteger(epoch) ||
        epoch < NO_ACTIVATION_EPOCH || epoch > MAX_ACTIVATION_EPOCH) {
      throw new RangeError(
        `Activation epoch ${String(epoch)} is out of uint32 range ` +
          `[${NO_ACTIVATION_EPOCH}, ${MAX_ACTIVATION_EPOCH}]`,
      );
    }
  }

  function requireChannelIndex(channel: number, count: number, label: string): void {
    if (!Number.isInteger(channel) || channel < 0 || channel >= count) {
      throw new RangeError(
        `${label} channel ${channel} is out of range [0, ${count})`,
      );
    }
  }

  function slotByteOffset(block: number): number {
    return ringBase + block * slotStride;
  }

  // ----- View object -----
  const view: SynthesisControlView = {
    // Layout descriptor
    get magic(): string {
      return ABI_MAGIC;
    },
    get abiVersion(): number {
      return ABI_VERSION;
    },
    get byteLength(): number {
      return byteLength;
    },
    get headerSize(): number {
      return headerSize;
    },
    get ringBase(): number {
      return ringBase;
    },
    get ringCapacityBlocks(): number {
      return ringCapacityBlocks;
    },
    get slotStride(): number {
      return slotStride;
    },
    get renderQuantumFrames(): number {
      return renderQuantumFrames;
    },
    get blockRateCount(): number {
      return blockRateCount;
    },
    get fastRateCount(): number {
      return fastRateCount;
    },
    get fastPointsPerBlock(): number {
      return fastPointsPerBlock;
    },
    get eventChannelCount(): number {
      return eventChannelCount;
    },
    get eventSlotsPerChannel(): number {
      return eventSlotsPerChannel;
    },

    // Header byte offsets (exposed for tests / corruption fixtures)
    magicOffset: HEADER_OFFSETS.magic,
    abiVersionOffset: HEADER_OFFSETS.abiVersion,
    byteLengthOffset: HEADER_OFFSETS.byteLength,
    ringBaseOffset: HEADER_OFFSETS.ringBase,
    ringCapacityOffset: HEADER_OFFSETS.ringCapacityBlocks,
    slotStrideOffset: HEADER_OFFSETS.slotStride,

    // Runtime state — typed-array accessors ensure declared widths.
    get audioFrame(): bigint {
      return bi64[0];
    },
    set audioFrame(value: bigint) {
      bi64[0] = value;
    },
    get wakeSequence(): bigint {
      return bi64Wake[0];
    },
    set wakeSequence(value: bigint) {
      bi64Wake[0] = value;
    },
    get programEpoch(): number {
      return dv.getUint32(HEADER_OFFSETS.programEpoch, true);
    },
    set programEpoch(value: number) {
      requireActivationEpoch(value);
      dv.setUint32(HEADER_OFFSETS.programEpoch, value, true);
    },
    get pendingEpoch(): number {
      return dv.getUint32(HEADER_OFFSETS.pendingEpoch, true);
    },
    set pendingEpoch(value: number) {
      requireActivationEpoch(value);
      dv.setUint32(HEADER_OFFSETS.pendingEpoch, value, true);
    },
    get controlRevision(): number {
      return dv.getUint32(HEADER_OFFSETS.controlRevision, true);
    },
    set controlRevision(value: number) {
      dv.setUint32(HEADER_OFFSETS.controlRevision, value, true);
    },

    // Ring indices — Atomics-aware so the publication helpers carry the
    // release/acquire fences even in single-threaded tests.
    get ringWriteIndex(): number {
      return Atomics.load(i32, HEADER_OFFSETS.ringWriteIndex / 4);
    },
    set ringWriteIndex(value: number) {
      Atomics.store(i32, HEADER_OFFSETS.ringWriteIndex / 4, value);
    },
    get ringReadIndex(): number {
      return Atomics.load(i32, HEADER_OFFSETS.ringReadIndex / 4);
    },
    set ringReadIndex(value: number) {
      Atomics.store(i32, HEADER_OFFSETS.ringReadIndex / 4, value);
    },

    get producerLivenessBlock(): number {
      return dv.getUint32(HEADER_OFFSETS.producerLivenessBlock, true);
    },
    set producerLivenessBlock(value: number) {
      dv.setUint32(HEADER_OFFSETS.producerLivenessBlock, value, true);
    },
    get producerLivenessAge(): number {
      return dv.getUint32(HEADER_OFFSETS.producerLivenessAge, true);
    },
    set producerLivenessAge(value: number) {
      dv.setUint32(HEADER_OFFSETS.producerLivenessAge, value, true);
    },

    // Telemetry
    get underrunCount(): number {
      return dv.getUint32(HEADER_OFFSETS.underrunCount, true);
    },
    set underrunCount(value: number) {
      dv.setUint32(HEADER_OFFSETS.underrunCount, value, true);
    },
    get glitchCount(): number {
      return dv.getUint32(HEADER_OFFSETS.glitchCount, true);
    },
    set glitchCount(value: number) {
      dv.setUint32(HEADER_OFFSETS.glitchCount, value, true);
    },
    get timeoutCount(): number {
      return dv.getUint32(HEADER_OFFSETS.timeoutCount, true);
    },
    set timeoutCount(value: number) {
      dv.setUint32(HEADER_OFFSETS.timeoutCount, value, true);
    },
    get peakSample(): number {
      return dv.getFloat32(HEADER_OFFSETS.peakSample, true);
    },
    set peakSample(value: number) {
      dv.setFloat32(HEADER_OFFSETS.peakSample, value, true);
    },
    get rmsSample(): number {
      return dv.getFloat32(HEADER_OFFSETS.rmsSample, true);
    },
    set rmsSample(value: number) {
      dv.setFloat32(HEADER_OFFSETS.rmsSample, value, true);
    },
    get finiteOutput(): number {
      return dv.getUint32(HEADER_OFFSETS.finiteOutput, true);
    },
    set finiteOutput(value: number) {
      dv.setUint32(HEADER_OFFSETS.finiteOutput, value, true);
    },

    initialise(): void {
      // Zero every runtime state byte. The header layout descriptor is
      // preserved (magic, version, declared layout). This is idempotent.
      for (let i = HEADER_OFFSETS.pendingEpoch; i < byteLength; i += 4) {
        if (i + 4 <= byteLength) {
          dv.setUint32(i, 0, true);
        }
      }
      // Re-stamp the audio frame / wake sequence (BigInt64 zero).
      bi64[0] = 0n;
      bi64Wake[0] = 0n;
    },

    // --- Per-block helpers ---
    writeBlockRateValue(block, channel, value): void {
      requireBlockIndex(block);
      requireChannelIndex(channel, blockRateCount, "block-rate");
      const byteOff =
        slotByteOffset(block) + fieldOffsets.blockRateValues + channel * 4;
      dv.setFloat32(byteOff, value, true);
    },
    readBlockRateValue(block, channel): number {
      requireBlockIndex(block);
      requireChannelIndex(channel, blockRateCount, "block-rate");
      const byteOff =
        slotByteOffset(block) + fieldOffsets.blockRateValues + channel * 4;
      return dv.getFloat32(byteOff, true);
    },

    writeFastRateValue(block, channel, point, value): void {
      requireBlockIndex(block);
      requireChannelIndex(channel, fastRateCount, "fast-rate");
      if (!Number.isInteger(point) || point < 0 || point >= fastPointsPerBlock) {
        throw new RangeError(
          `fast-rate point ${point} is out of range [0, ${fastPointsPerBlock})`,
        );
      }
      const byteOff =
        slotByteOffset(block) +
        fieldOffsets.fastRateValues +
        (channel * fastPointsPerBlock + point) * 4;
      dv.setFloat32(byteOff, value, true);
    },
    readFastRateValue(block, channel, point): number {
      requireBlockIndex(block);
      requireChannelIndex(channel, fastRateCount, "fast-rate");
      if (!Number.isInteger(point) || point < 0 || point >= fastPointsPerBlock) {
        throw new RangeError(
          `fast-rate point ${point} is out of range [0, ${fastPointsPerBlock})`,
        );
      }
      const byteOff =
        slotByteOffset(block) +
        fieldOffsets.fastRateValues +
        (channel * fastPointsPerBlock + point) * 4;
      return dv.getFloat32(byteOff, true);
    },

    writeEvent(block, channel, slot, event): void {
      requireBlockIndex(block);
      requireChannelIndex(channel, eventChannelCount, "event");
      if (!Number.isInteger(slot) || slot < 0 || slot >= eventSlotsPerChannel) {
        throw new RangeError(
          `event slot ${slot} is out of range [0, ${eventSlotsPerChannel})`,
        );
      }
      if (
        !Number.isInteger(event.frameOffset) ||
        event.frameOffset < 0 ||
        event.frameOffset >= renderQuantumFrames
      ) {
        throw new RangeError(
          `event frameOffset ${event.frameOffset} is out of range [0, ${renderQuantumFrames})`,
        );
      }
      const recordOff =
        slotByteOffset(block) +
        fieldOffsets.eventRecords +
        (channel * eventSlotsPerChannel + slot) * 8;
      dv.setFloat32(recordOff, event.value, true);
      dv.setUint32(recordOff + 4, event.frameOffset, true);
      // Auto-bump the count if writing past the previous count.
      const countOff =
        slotByteOffset(block) + fieldOffsets.eventCounts + channel * 4;
      const current = dv.getUint32(countOff, true);
      if (slot >= current) {
        dv.setUint32(countOff, slot + 1, true);
      }
    },
    readEvent(block, channel, slot): SynthesisControlEvent {
      requireBlockIndex(block);
      requireChannelIndex(channel, eventChannelCount, "event");
      if (!Number.isInteger(slot) || slot < 0 || slot >= eventSlotsPerChannel) {
        throw new RangeError(
          `event slot ${slot} is out of range [0, ${eventSlotsPerChannel})`,
        );
      }
      const recordOff =
        slotByteOffset(block) +
        fieldOffsets.eventRecords +
        (channel * eventSlotsPerChannel + slot) * 8;
      return {
        value: dv.getFloat32(recordOff, true),
        frameOffset: dv.getUint32(recordOff + 4, true),
      };
    },
    eventCount(block, channel): number {
      requireBlockIndex(block);
      requireChannelIndex(channel, eventChannelCount, "event");
      const countOff =
        slotByteOffset(block) + fieldOffsets.eventCounts + channel * 4;
      return dv.getUint32(countOff, true);
    },
    setEventCount(block, channel, count): void {
      requireBlockIndex(block);
      requireChannelIndex(channel, eventChannelCount, "event");
      if (!Number.isInteger(count) || count < 0 || count > eventSlotsPerChannel) {
        throw new RangeError(
          `event count ${count} is out of range [0, ${eventSlotsPerChannel}]`,
        );
      }
      const countOff =
        slotByteOffset(block) + fieldOffsets.eventCounts + channel * 4;
      dv.setUint32(countOff, count, true);
    },

    readBlockEpoch(block): number {
      requireBlockIndex(block);
      return dv.getUint32(slotByteOffset(block) + fieldOffsets.blockEpoch, true);
    },
    writeBlockEpoch(block, epoch): void {
      requireBlockIndex(block);
      requireActivationEpoch(epoch);
      dv.setUint32(slotByteOffset(block) + fieldOffsets.blockEpoch, epoch, true);
    },
    readBlockRevision(block): number {
      requireBlockIndex(block);
      return dv.getUint32(slotByteOffset(block) + fieldOffsets.blockRevision, true);
    },
    writeBlockRevision(block, revision): void {
      requireBlockIndex(block);
      dv.setUint32(slotByteOffset(block) + fieldOffsets.blockRevision, revision, true);
    },
    readBlockFrameOffset(block): number {
      requireBlockIndex(block);
      return dv.getUint32(slotByteOffset(block) + fieldOffsets.blockFrameOffset, true);
    },
    writeBlockFrameOffset(block, offset): void {
      requireBlockIndex(block);
      dv.setUint32(slotByteOffset(block) + fieldOffsets.blockFrameOffset, offset, true);
    },

    // --- Ring publication helpers ---
    //
    // The write and read indices are stored as **monotonic raw counters**
    // that never wrap. The physical slot index is the counter modulo
    // `ringCapacityBlocks` (see {@link physicalSlotForSequence}). This keeps
    // the fill depth meaningful even when the producer laps the consumer
    // exactly `ringCapacityBlocks` times — wrap-around indices would
    // misread that as "empty" and accept overwritten payload.
    //
    // VAL-SAB-011: the consumer distinguishes empty, full, and overrun
    // using these raw counters.
    advanceWriteIndex(): void {
      // Release-store: payload writes are visible before the index advances.
      // Atomics.store on an Int32 provides the release fence; the consumer
      // acquire-loads via {@link acquireWriteIndex} and observes the payload.
      const next =
        (Atomics.load(i32, HEADER_OFFSETS.ringWriteIndex / 4) + 1) >>> 0;
      Atomics.store(i32, HEADER_OFFSETS.ringWriteIndex / 4, next);
      // Bump the producer liveness age. The consumer resets it via
      // {@link advanceReadIndex}. When this exceeds `ringCapacityBlocks` the
      // ring is overrunning (the producer has lapped the consumer).
      const age = dv.getUint32(HEADER_OFFSETS.producerLivenessAge, true) + 1;
      dv.setUint32(HEADER_OFFSETS.producerLivenessAge, age, true);
    },
    acquireWriteIndex(): number {
      return Atomics.load(i32, HEADER_OFFSETS.ringWriteIndex / 4);
    },
    advanceReadIndex(): void {
      const next =
        (Atomics.load(i32, HEADER_OFFSETS.ringReadIndex / 4) + 1) >>> 0;
      Atomics.store(i32, HEADER_OFFSETS.ringReadIndex / 4, next);
      // The consumer has drained one slot; reset the overrun age.
      dv.setUint32(HEADER_OFFSETS.producerLivenessAge, 0, true);
    },
    consumerAvailableBlocks(): number {
      const write = Atomics.load(i32, HEADER_OFFSETS.ringWriteIndex / 4);
      const read = Atomics.load(i32, HEADER_OFFSETS.ringReadIndex / 4);
      // Raw counters are monotonic, so the difference is the true fill depth,
      // capped at `ringCapacityBlocks` because the producer cannot publish
      // beyond the available physical slots without overrunning.
      const diff = write - read;
      return Math.min(diff, ringCapacityBlocks);
    },
    ringFillDepth(): number {
      return view.consumerAvailableBlocks();
    },
    isRingEmpty(): boolean {
      return view.ringFillDepth() === 0;
    },
    isRingOverrun(): boolean {
      // Overrun is declared when the producer has published more blocks than
      // the ring can hold without the consumer draining any.
      return view.producerLivenessAge > ringCapacityBlocks;
    },
    physicalSlotForSequence(sequence): number {
      if (!Number.isInteger(sequence) || sequence < 0) {
        throw new RangeError(
          `sequence ${sequence} must be a non-negative integer`,
        );
      }
      return sequence % ringCapacityBlocks;
    },

    publishAudioFrame(options): void {
      const current = bi64[0];
      if (options.frame <= current) {
        throw new RangeError(
          `audio frame ${options.frame} is not monotonic (current ${current})`,
        );
      }
      // Release-store / wake pairing per synthesis.md §4.8: the frame
      // index is Atomics-stored, then the wake word is bumped and
      // notified so a producer blocked in `createProducerPacingWaiter`
      // wakes for the next block window.
      dv.setUint32(HEADER_OFFSETS.producerLivenessBlock, options.blockFrameOffset, true);
      Atomics.store(bi64, 0, options.frame);
      Atomics.add(bi64Wake, 0, 1n);
      Atomics.notify(bi64Wake, 0);
    },
  };

  return view;
}
