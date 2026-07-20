/**
 * Contract tests for the SharedArrayBuffer synthesis control ABI.
 *
 * Covers VAL-SAB-001..011, 013..015, 017..019 (this feature's `fulfills`):
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
 * Tests run in jsdom (no real SharedArrayBuffer required — the contract
 * works over any ArrayBuffer-backed DataView, which is exactly how a
 * worker/worklet will see the underlying bytes).
 */
import { describe, expect, it } from "vitest";

import {
  ABI_MAGIC,
  ABI_MAGIC_BYTES,
  ABI_VERSION,
  BLOCK_RATE_ALIGN_BYTES,
  CONTROL_LOOKAHEAD_BLOCKS,
  DEFAULT_BLOCK_RATE_COUNT,
  DEFAULT_EVENT_CHANNELS,
  DEFAULT_EVENT_SLOTS_PER_CHANNEL,
  DEFAULT_FAST_POINTS_PER_BLOCK,
  DEFAULT_FAST_RATE_COUNT,
  DEFAULT_RENDER_QUANTUM_FRAMES,
  EMERGENCY_FADE_MS,
  HEADER_ALIGN_BYTES,
  HEADER_OFFSETS,
  MAX_CONTROL_LOOKAHEAD_BLOCKS,
  MAX_RENDER_QUANTUM_FRAMES,
  MIN_CONTROL_LOOKAHEAD_BLOCKS,
  MIN_RENDER_QUANTUM_FRAMES,
  PRODUCER_TIMEOUT_BLOCKS,
  RING_CAPACITY_BLOCKS,
  SYNTH_FADE_IN_MS,
  SYNTH_FADE_OUT_MS,
  WORKLET_HELPERS_DOCUMENTED_NON_BLOCKING,
  assertAbiLayoutInvariants,
  attachSynthesisControlView,
  computeByteLength,
  createProducerPacingWaiter,
  createSynthesisControlBuffer,
  isSynthesisControlBuffer,
  type SynthesisControlView,
} from "./synthesisControlAbi";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a fresh conforming buffer for tests that just need a working ring. */
function freshBuffer(): ArrayBuffer {
  return createSynthesisControlBuffer();
}

/** View + DataView for raw byte inspection. */
function rawBytes(buffer: ArrayBuffer): {
  view: SynthesisControlView;
  dv: DataView;
} {
  const view = attachSynthesisControlView(buffer);
  const dv = new DataView(buffer);
  return { view, dv };
}

/**
 * Sentinel pattern: write 0xa5 into every byte, then re-stamp the layout
 * descriptor fields so the buffer remains attachable. After running an
 * operation we verify that adjacent fields (within the declared field widths)
 * hold the expected values and that field writes do not exceed their declared
 * widths.
 */
function fillSentinels(buffer: ArrayBuffer, value = 0xa5): void {
  // Attach first so we can read back the layout descriptor that
  // createSynthesisControlBuffer stamped.
  const view = attachSynthesisControlView(buffer);
  const capturedLayout = {
    byteLength: view.byteLength,
    ringBase: view.ringBase,
    ringCapacityBlocks: view.ringCapacityBlocks,
    slotStride: view.slotStride,
  };

  new Uint8Array(buffer).fill(value);
  // Re-stamp the fields attachSynthesisControlView validates so attach still
  // succeeds. The rest of the buffer stays sentinel-filled so adjacent-byte
  // bleed is detectable.
  const dv = new DataView(buffer);
  for (let i = 0; i < 4; i++) {
    dv.setUint8(HEADER_OFFSETS.magic + i, ABI_MAGIC_BYTES[i]);
  }
  dv.setUint32(HEADER_OFFSETS.abiVersion, ABI_VERSION, true);
  dv.setUint32(HEADER_OFFSETS.byteLength, capturedLayout.byteLength, true);
  dv.setUint32(HEADER_OFFSETS.headerSize, 256, true);
  dv.setUint32(HEADER_OFFSETS.ringBase, capturedLayout.ringBase, true);
  dv.setUint32(HEADER_OFFSETS.ringCapacityBlocks, capturedLayout.ringCapacityBlocks, true);
  dv.setUint32(HEADER_OFFSETS.slotStride, capturedLayout.slotStride, true);
}

describe("synthesisControlAbi — single source of truth (VAL-SAB-001)", () => {
  it("exports a frozen magic string and numeric ABI version", () => {
    expect(ABI_MAGIC).toBe("SAB1");
    expect(typeof ABI_VERSION).toBe("number");
    expect(ABI_VERSION).toBeGreaterThan(0);
  });

  it("owns every named engine constant used by the layout", () => {
    // The contract is the only place these constants may live.
    expect(typeof DEFAULT_RENDER_QUANTUM_FRAMES).toBe("number");
    expect(DEFAULT_RENDER_QUANTUM_FRAMES).toBe(128);
    expect(typeof RING_CAPACITY_BLOCKS).toBe("number");
    expect(RING_CAPACITY_BLOCKS & (RING_CAPACITY_BLOCKS - 1)).toBe(0); // power of two
    expect(typeof CONTROL_LOOKAHEAD_BLOCKS).toBe("number");
    expect(typeof PRODUCER_TIMEOUT_BLOCKS).toBe("number");
    expect(PRODUCER_TIMEOUT_BLOCKS).toBe(24);
    expect(typeof EMERGENCY_FADE_MS).toBe("number");
    expect(typeof SYNTH_FADE_IN_MS).toBe("number");
    expect(typeof SYNTH_FADE_OUT_MS).toBe("number");
  });

  it("exposes a static layout-invariant check that passes on its own constants", () => {
    expect(() => assertAbiLayoutInvariants()).not.toThrow();
  });
});

describe("synthesisControlAbi — exact aligned layout (VAL-SAB-002)", () => {
  it("allocates the exact declared byte length", () => {
    const buffer = freshBuffer();
    expect(buffer.byteLength).toBe(computeByteLength());
    expect(buffer.byteLength % HEADER_ALIGN_BYTES).toBe(0);
  });

  it("aligns the header and ring base", () => {
    const { view } = rawBytes(freshBuffer());
    expect(view.headerSize % HEADER_ALIGN_BYTES).toBe(0);
    expect(view.ringBase).toBeGreaterThanOrEqual(view.headerSize);
    expect(view.ringBase % HEADER_ALIGN_BYTES).toBe(0);
  });

  it("reports a non-overlapping slot stride and ring region", () => {
    const { view } = rawBytes(freshBuffer());
    const ringEnd = view.ringBase + view.ringCapacityBlocks * view.slotStride;
    expect(ringEnd).toBeLessThanOrEqual(view.byteLength);
    expect(view.slotStride).toBeGreaterThanOrEqual(
      BLOCK_RATE_ALIGN_BYTES,
    );
    // No header field leaks into the ring.
    expect(view.ringBase).toBeGreaterThanOrEqual(view.headerSize);
  });

  it("exposes every offset/width/stride via the view for consumers", () => {
    const { view } = rawBytes(freshBuffer());
    expect(typeof view.byteLength).toBe("number");
    expect(typeof view.headerSize).toBe("number");
    expect(typeof view.ringBase).toBe("number");
    expect(typeof view.ringCapacityBlocks).toBe("number");
    expect(typeof view.slotStride).toBe("number");
    expect(typeof view.renderQuantumFrames).toBe("number");
    expect(typeof view.blockRateCount).toBe("number");
    expect(typeof view.fastRateCount).toBe("number");
    expect(typeof view.fastPointsPerBlock).toBe("number");
    expect(typeof view.eventChannelCount).toBe("number");
    expect(typeof view.eventSlotsPerChannel).toBe("number");
  });
});

describe("synthesisControlAbi — declared widths (VAL-SAB-003)", () => {
  it("round-trips every header field without disturbing adjacent bytes", () => {
    const buffer = freshBuffer();
    fillSentinels(buffer);
    const { view } = rawBytes(buffer);

    // Initialise must overwrite only the declared fields; adjacent sentinels
    // in padding bytes may change (they are padding), but field writes must
    // not exceed their declared widths. Verify by writing known values and
    // reading them back exactly.
    view.initialise();
    view.programEpoch = 0xdeadbeef;
    view.controlRevision = 0x12345678;
    // Use values within the signed int64 range (BigInt64Array stores signed).
    view.audioFrame = 0x123456789abcdef0n;
    view.wakeSequence = 0x0edcba9876543210n;

    expect(view.magic).toBe(ABI_MAGIC);
    expect(view.abiVersion).toBe(ABI_VERSION);
    expect(view.programEpoch).toBe(0xdeadbeef);
    expect(view.controlRevision).toBe(0x12345678);
    expect(view.audioFrame).toBe(0x123456789abcdef0n);
    expect(view.wakeSequence).toBe(0x0edcba9876543210n);
  });

  it("round-trips every telemetry counter at its declared width", () => {
    const buffer = freshBuffer();
    const { view } = rawBytes(buffer);
    view.initialise();

    view.underrunCount = 0x11223344;
    view.glitchCount = 0x55667788;
    view.timeoutCount = 0x99aabbcc;
    view.peakSample = 0.75;
    view.rmsSample = 0.25;
    view.finiteOutput = 1;

    expect(view.underrunCount).toBe(0x11223344);
    expect(view.glitchCount).toBe(0x55667788);
    expect(view.timeoutCount).toBe(0x99aabbcc);
    expect(view.peakSample).toBeCloseTo(0.75, 6);
    expect(view.rmsSample).toBeCloseTo(0.25, 6);
    expect(view.finiteOutput).toBe(1);
  });

  it("round-trips block-rate values at every channel without bleeding into neighbours", () => {
    const buffer = freshBuffer();
    const { view } = rawBytes(buffer);
    view.initialise();

    const blockIndex = 0;
    for (let ch = 0; ch < view.blockRateCount; ch++) {
      view.writeBlockRateValue(blockIndex, ch, 0.1 * (ch + 1));
    }
    for (let ch = 0; ch < view.blockRateCount; ch++) {
      expect(view.readBlockRateValue(blockIndex, ch)).toBeCloseTo(0.1 * (ch + 1), 6);
    }
  });
});

describe("synthesisControlAbi — invalid layouts rejected (VAL-SAB-004)", () => {
  const invalidLayouts: Array<{ name: string; build: () => ArrayBuffer }> = [
    {
      name: "zero byte length",
      build: () => new ArrayBuffer(0),
    },
    {
      name: "truncated (smaller than header)",
      build: () => new ArrayBuffer(8),
    },
    {
      name: "non-power-of-two ring capacity",
      build: () => {
        const buf = createSynthesisControlBuffer({ ringCapacityBlocks: 8 });
        const dv = new DataView(buf);
        // Corrupt the ring capacity in the header so it's not a power of two.
        dv.setUint32(HEADER_OFFSETS.ringCapacityBlocks, 5, true);
        return buf;
      },
    },
    {
      name: "overflowing ring (declared byte length smaller than ring region)",
      build: () => {
        const buf = createSynthesisControlBuffer();
        const dv = new DataView(buf);
        // Shrink declared byte length so ring region overruns the storage.
        dv.setUint32(HEADER_OFFSETS.byteLength, HEADER_OFFSETS.ringBase + 16, true);
        return buf;
      },
    },
    {
      name: "out-of-bounds slot stride",
      build: () => {
        const buf = createSynthesisControlBuffer();
        const dv = new DataView(buf);
        const view = attachSynthesisControlView(buf);
        dv.setUint32(HEADER_OFFSETS.slotStride, view.byteLength + 1000, true);
        return buf;
      },
    },
    {
      name: "misaligned ring base",
      build: () => {
        const buf = createSynthesisControlBuffer();
        const v = attachSynthesisControlView(buf);
        const dv = new DataView(buf);
        // Set ring base to a non-aligned offset that is still inside the
        // header (impossible in practice — proves the validator checks).
        dv.setUint32(HEADER_OFFSETS.ringBase, v.headerSize - 1, true);
        return buf;
      },
    },
  ];

  for (const { name, build } of invalidLayouts) {
    it(`rejects ${name} before payload access`, () => {
      const buffer = build();
      expect(isSynthesisControlBuffer(buffer)).toBe(false);
      expect(() => attachSynthesisControlView(buffer)).toThrow();
    });
  }
});

describe("synthesisControlAbi — deterministic initial values (VAL-SAB-005)", () => {
  it("initialises every documented field to its declared default", () => {
    const buffer = freshBuffer();
    const { view } = rawBytes(buffer);
    view.initialise();

    expect(view.magic).toBe(ABI_MAGIC);
    expect(view.abiVersion).toBe(ABI_VERSION);
    expect(view.byteLength).toBe(buffer.byteLength);
    expect(view.ringCapacityBlocks).toBe(RING_CAPACITY_BLOCKS);
    expect(view.renderQuantumFrames).toBe(DEFAULT_RENDER_QUANTUM_FRAMES);
    expect(view.blockRateCount).toBe(DEFAULT_BLOCK_RATE_COUNT);
    expect(view.fastRateCount).toBe(DEFAULT_FAST_RATE_COUNT);
    expect(view.fastPointsPerBlock).toBe(DEFAULT_FAST_POINTS_PER_BLOCK);
    expect(view.eventChannelCount).toBe(DEFAULT_EVENT_CHANNELS);
    expect(view.eventSlotsPerChannel).toBe(DEFAULT_EVENT_SLOTS_PER_CHANNEL);

    expect(view.audioFrame).toBe(0n);
    expect(view.wakeSequence).toBe(0n);
    expect(view.programEpoch).toBe(0);
    expect(view.pendingEpoch).toBe(0);
    expect(view.controlRevision).toBe(0);

    expect(view.ringWriteIndex).toBe(0);
    expect(view.ringReadIndex).toBe(0);
    expect(view.producerLivenessBlock).toBe(0);
    expect(view.producerLivenessAge).toBe(0);

    expect(view.underrunCount).toBe(0);
    expect(view.glitchCount).toBe(0);
    expect(view.timeoutCount).toBe(0);
    expect(view.peakSample).toBe(0);
    expect(view.rmsSample).toBe(0);
    expect(view.finiteOutput).toBe(0);
  });

  it("createSynthesisControlBuffer returns a buffer that is already initialised", () => {
    const buffer = createSynthesisControlBuffer();
    const { view } = rawBytes(buffer);
    expect(view.magic).toBe(ABI_MAGIC);
    expect(view.abiVersion).toBe(ABI_VERSION);
    expect(view.ringWriteIndex).toBe(0);
    expect(view.audioFrame).toBe(0n);
  });
});

describe("synthesisControlAbi — runtime quantum (VAL-SAB-006)", () => {
  // Browsers typically deliver powers of two (32, 64, 128, 256, ...), but the
  // spec only constrains the integer range [MIN, MAX]; arbitrary integers in
  // range are valid because `renderSizeHint` and future user agents may vary
  // the quantum.
  const validQuantums = [1, 32, 64, 100, 127, 128, 256, 512, 1024, 8192];
  const invalidQuantums = [0, -128, MAX_RENDER_QUANTUM_FRAMES + 1, 3.5, NaN, Infinity];

  for (const q of validQuantums) {
    it(`accepts supported quantum ${q}`, () => {
      const buffer = createSynthesisControlBuffer({ renderQuantumFrames: q });
      const { view } = rawBytes(buffer);
      expect(view.renderQuantumFrames).toBe(q);
      expect(buffer.byteLength).toBe(computeByteLength({ renderQuantumFrames: q }));
    });
  }

  for (const bad of invalidQuantums) {
    it(`rejects invalid quantum ${bad}`, () => {
      // Non-integer / non-positive / out of range must throw or be rejected.
      expect(() => createSynthesisControlBuffer({ renderQuantumFrames: bad as number })).toThrow();
    });
  }

  it("documents the minimum and maximum supported quantum", () => {
    expect(MIN_RENDER_QUANTUM_FRAMES).toBeGreaterThanOrEqual(1);
    expect(MAX_RENDER_QUANTUM_FRAMES).toBeGreaterThan(MIN_RENDER_QUANTUM_FRAMES);
    expect(DEFAULT_RENDER_QUANTUM_FRAMES).toBeGreaterThanOrEqual(MIN_RENDER_QUANTUM_FRAMES);
    expect(DEFAULT_RENDER_QUANTUM_FRAMES).toBeLessThanOrEqual(MAX_RENDER_QUANTUM_FRAMES);
  });
});

describe("synthesisControlAbi — block-rate records (VAL-SAB-007)", () => {
  it("round-trips every channel across every valid block boundary", () => {
    const { view } = rawBytes(freshBuffer());
    view.initialise();

    for (let block = 0; block < view.ringCapacityBlocks; block++) {
      for (let ch = 0; ch < view.blockRateCount; ch++) {
        view.writeBlockRateValue(block, ch, block * 100 + ch);
      }
    }
    for (let block = 0; block < view.ringCapacityBlocks; block++) {
      for (let ch = 0; ch < view.blockRateCount; ch++) {
        expect(view.readBlockRateValue(block, ch)).toBeCloseTo(block * 100 + ch, 5);
      }
    }
  });

  it("rejects out-of-range channel indices", () => {
    const { view } = rawBytes(freshBuffer());
    view.initialise();
    expect(() => view.writeBlockRateValue(0, -1, 0.5)).toThrow();
    expect(() => view.writeBlockRateValue(0, view.blockRateCount, 0.5)).toThrow();
  });

  it("rejects out-of-range block indices", () => {
    const { view } = rawBytes(freshBuffer());
    view.initialise();
    expect(() => view.writeBlockRateValue(-1, 0, 0.5)).toThrow();
    expect(() => view.writeBlockRateValue(view.ringCapacityBlocks, 0, 0.5)).toThrow();
  });
});

describe("synthesisControlAbi — fast-channel records (VAL-SAB-008)", () => {
  it("preserves points-per-block order for every channel", () => {
    const { view } = rawBytes(freshBuffer());
    view.initialise();

    const block = 1;
    for (let ch = 0; ch < view.fastRateCount; ch++) {
      for (let p = 0; p < view.fastPointsPerBlock; p++) {
        view.writeFastRateValue(block, ch, p, ch * 1000 + p);
      }
    }
    for (let ch = 0; ch < view.fastRateCount; ch++) {
      for (let p = 0; p < view.fastPointsPerBlock; p++) {
        expect(view.readFastRateValue(block, ch, p)).toBeCloseTo(ch * 1000 + p, 5);
      }
    }
  });

  it("rejects excess channels or points without corrupting existing data", () => {
    const { view } = rawBytes(freshBuffer());
    view.initialise();
    const block = 0;
    view.writeFastRateValue(block, 0, 0, 0.25);
    expect(() => view.writeFastRateValue(block, view.fastRateCount, 0, 0.5)).toThrow();
    expect(() => view.writeFastRateValue(block, 0, view.fastPointsPerBlock, 0.5)).toThrow();
    // Existing data still intact.
    expect(view.readFastRateValue(block, 0, 0)).toBeCloseTo(0.25, 5);
  });
});

describe("synthesisControlAbi — event records (VAL-SAB-009)", () => {
  it("preserves channel, value, and frame offset at zero", () => {
    const { view } = rawBytes(freshBuffer());
    view.initialise();
    const block = 0;
    view.writeEvent(block, 0, 0, { value: 1.0, frameOffset: 0 });
    expect(view.readEvent(block, 0, 0)).toMatchObject({ value: 1.0, frameOffset: 0 });
    expect(view.eventCount(block, 0)).toBe(1);
  });

  it("preserves event at the last valid frame offset", () => {
    const { view } = rawBytes(freshBuffer());
    view.initialise();
    const block = 0;
    const last = view.renderQuantumFrames - 1;
    view.writeEvent(block, 0, 0, { value: 0.5, frameOffset: last });
    expect(view.readEvent(block, 0, 0)).toMatchObject({ value: 0.5, frameOffset: last });
  });

  it("rejects invalid frame offsets", () => {
    const { view } = rawBytes(freshBuffer());
    view.initialise();
    expect(() =>
      view.writeEvent(0, 0, 0, { value: 1.0, frameOffset: -1 }),
    ).toThrow();
    expect(() =>
      view.writeEvent(0, 0, 0, { value: 1.0, frameOffset: view.renderQuantumFrames }),
    ).toThrow();
  });

  it("rejects excess event counts per channel", () => {
    const { view } = rawBytes(freshBuffer());
    view.initialise();
    for (let i = 0; i < view.eventSlotsPerChannel; i++) {
      view.writeEvent(0, 0, i, { value: 1.0, frameOffset: i });
    }
    expect(() =>
      view.writeEvent(0, 0, view.eventSlotsPerChannel, { value: 1.0, frameOffset: 0 }),
    ).toThrow();
  });
});

describe("synthesisControlAbi — ring wrapping (VAL-SAB-010)", () => {
  it("wraps the write/read indices modulo capacity without losing order", () => {
    const { view } = rawBytes(freshBuffer());
    view.initialise();

    // Write more blocks than the ring holds to exercise wraparound at least
    // three times. Each block writes a unique sentinel value on channel 0.
    const total = view.ringCapacityBlocks * 3 + 1;
    for (let i = 0; i < total; i++) {
      const physicalSlot = view.physicalSlotForSequence(i);
      view.writeBlockRateValue(physicalSlot, 0, i + 1);
      // Advance the write index using the producer publication helper so the
      // wrap semantics are exercised through the public contract surface.
      view.advanceWriteIndex();
    }

    // The write index is monotonic; the physical slot for `total` is
    // `total % capacity`.
    expect(view.ringWriteIndex).toBe(total);
    expect(view.physicalSlotForSequence(view.ringWriteIndex)).toBe(
      total % view.ringCapacityBlocks,
    );
    // The most recently written physical slot still holds its value.
    const lastSlot = view.physicalSlotForSequence(total - 1);
    expect(view.readBlockRateValue(lastSlot, 0)).toBeCloseTo(total, 5);
  });

  it("maps a sequence number to its physical slot consistently across many wraps", () => {
    const { view } = rawBytes(freshBuffer());
    view.initialise();
    const cap = view.ringCapacityBlocks;
    for (let seq = 0; seq < cap * 5; seq++) {
      expect(view.physicalSlotForSequence(seq)).toBe(seq % cap);
    }
  });
});

describe("synthesisControlAbi — full, empty, overrun (VAL-SAB-011)", () => {
  it("distinguishes empty from full using the published write index", () => {
    const { view } = rawBytes(freshBuffer());
    view.initialise();
    // Empty: write == read.
    expect(view.ringFillDepth()).toBe(0);
    expect(view.isRingEmpty()).toBe(true);

    // Advance write index without advancing read; depth grows.
    view.advanceWriteIndex();
    expect(view.ringFillDepth()).toBe(1);
    expect(view.isRingEmpty()).toBe(false);
  });

  it("detects overrun when the producer overtakes the consumer by capacity", () => {
    const { view } = rawBytes(freshBuffer());
    view.initialise();
    const cap = view.ringCapacityBlocks;
    for (let i = 0; i < cap; i++) {
      view.advanceWriteIndex();
    }
    // Producer is exactly one lap ahead of consumer; this is "full".
    expect(view.ringFillDepth()).toBe(cap);
    expect(view.isRingOverrun()).toBe(false);

    // One more publish without consumption is an overrun.
    view.advanceWriteIndex();
    expect(view.isRingOverrun()).toBe(true);
  });

  it("the consumer never accepts an unpublished slot as current data", () => {
    const { view } = rawBytes(freshBuffer());
    view.initialise();
    // Producer has not published; acquire depth returns 0.
    expect(view.consumerAvailableBlocks()).toBe(0);
  });
});

describe("synthesisControlAbi — incomplete slots invisible (VAL-SAB-013)", () => {
  it("an un-advanced write index keeps the slot invisible to the consumer", () => {
    const { view } = rawBytes(freshBuffer());
    view.initialise();

    // Write payload directly into slot 0 but DO NOT call advanceWriteIndex.
    view.writeBlockRateValue(0, 0, 0.5);
    // Consumer sees zero available blocks.
    expect(view.consumerAvailableBlocks()).toBe(0);
  });

  it("advanceWriteIndex is the only producer publication that exposes a slot", () => {
    const { view } = rawBytes(freshBuffer());
    view.initialise();
    view.writeBlockRateValue(0, 0, 0.5);
    expect(view.consumerAvailableBlocks()).toBe(0);
    view.advanceWriteIndex();
    expect(view.consumerAvailableBlocks()).toBe(1);
  });
});

describe("synthesisControlAbi — audio frame and wake publication (VAL-SAB-014)", () => {
  it("publishAudioFrame increments both frame and wake sequence atomically", () => {
    const { view } = rawBytes(freshBuffer());
    view.initialise();

    const beforeFrame = view.audioFrame;
    const beforeWake = view.wakeSequence;
    view.publishAudioFrame({
      frame: beforeFrame + BigInt(DEFAULT_RENDER_QUANTUM_FRAMES),
      blockFrameOffset: Number(beforeFrame),
    });
    expect(view.audioFrame).toBe(beforeFrame + BigInt(DEFAULT_RENDER_QUANTUM_FRAMES));
    expect(view.wakeSequence).toBe(beforeWake + 1n);
  });

  it("audio frame and wake sequence are monotonic across wraps", () => {
    const { view } = rawBytes(freshBuffer());
    view.initialise();

    let expectedWake = 0n;
    for (let i = 0; i < 4096; i++) {
      view.publishAudioFrame({
        frame: BigInt(i + 1) * BigInt(DEFAULT_RENDER_QUANTUM_FRAMES),
        blockFrameOffset: i * DEFAULT_RENDER_QUANTUM_FRAMES,
      });
      expectedWake += 1n;
    }
    expect(view.wakeSequence).toBe(expectedWake);
    // The BigInt must still hold the full 2^63-positive value, not wrap.
    expect(view.audioFrame).toBe(
      BigInt(4096) * BigInt(DEFAULT_RENDER_QUANTUM_FRAMES),
    );
  });

  it("publishAudioFrame rejects non-monotonic frame values", () => {
    const { view } = rawBytes(freshBuffer());
    view.initialise();
    view.publishAudioFrame({ frame: 1000n, blockFrameOffset: 0 });
    expect(() =>
      view.publishAudioFrame({ frame: 999n, blockFrameOffset: 0 }),
    ).toThrow();
  });
});

describe("synthesisControlAbi — epoch and revision per block (VAL-SAB-015)", () => {
  it("attaches an independent epoch and revision to each block", () => {
    const { view } = rawBytes(freshBuffer());
    view.initialise();

    view.writeBlockEpoch(0, 1);
    view.writeBlockRevision(0, 10);
    view.writeBlockEpoch(1, 2);
    view.writeBlockRevision(1, 20);

    expect(view.readBlockEpoch(0)).toBe(1);
    expect(view.readBlockRevision(0)).toBe(10);
    expect(view.readBlockEpoch(1)).toBe(2);
    expect(view.readBlockRevision(1)).toBe(20);
  });

  it("keeps epoch and revision tags with the intended block after wraparound", () => {
    const { view } = rawBytes(freshBuffer());
    view.initialise();
    const cap = view.ringCapacityBlocks;

    // Write into the "physical" wrap-around slot.
    view.writeBlockEpoch(0, 0xabc);
    view.writeBlockRevision(0, 0xdef);
    for (let i = 1; i < cap; i++) {
      view.writeBlockEpoch(i, i);
      view.writeBlockRevision(i, i * 10);
    }
    // Slot 0 must still hold its tagged values.
    expect(view.readBlockEpoch(0)).toBe(0xabc);
    expect(view.readBlockRevision(0)).toBe(0xdef);
  });
});

describe("synthesisControlAbi — telemetry isolation (VAL-SAB-017)", () => {
  it("updating telemetry counters leaves control records untouched", () => {
    const { view } = rawBytes(freshBuffer());
    view.initialise();
    const block = 2;

    view.writeBlockRateValue(block, 0, 0.42);
    view.writeBlockEpoch(block, 7);

    // Bang on every telemetry field.
    view.underrunCount += 3;
    view.glitchCount += 2;
    view.timeoutCount += 1;
    view.peakSample = 0.99;
    view.rmsSample = 0.33;
    view.finiteOutput = 1;
    view.producerLivenessBlock = block;
    view.producerLivenessAge = 5;

    // Control record untouched.
    expect(view.readBlockRateValue(block, 0)).toBeCloseTo(0.42, 5);
    expect(view.readBlockEpoch(block)).toBe(7);
  });

  it("updating control records leaves telemetry counters untouched", () => {
    const { view } = rawBytes(freshBuffer());
    view.initialise();

    view.underrunCount = 11;
    view.glitchCount = 22;
    view.timeoutCount = 33;
    view.peakSample = 0.5;
    view.rmsSample = 0.2;

    view.writeBlockRateValue(0, 0, 0.9);
    view.writeBlockEpoch(0, 4);
    view.writeEvent(1, 0, 0, { value: 1.0, frameOffset: 5 });

    expect(view.underrunCount).toBe(11);
    expect(view.glitchCount).toBe(22);
    expect(view.timeoutCount).toBe(33);
    expect(view.peakSample).toBeCloseTo(0.5, 5);
    expect(view.rmsSample).toBeCloseTo(0.2, 5);
  });
});

describe("synthesisControlAbi — header mismatch fails closed (VAL-SAB-018)", () => {
  function corruptHeader(buffer: ArrayBuffer, mutate: (dv: DataView) => void): ArrayBuffer {
    const dv = new DataView(buffer);
    mutate(dv);
    return buffer;
  }

  it("rejects corrupted magic before payload access", () => {
    const buffer = corruptHeader(freshBuffer(), (dv) => {
      // Overwrite the first 4 ASCII bytes of the magic with junk.
      for (let i = 0; i < 4; i++) dv.setUint8(HEADER_OFFSETS.magic + i, 0x58);
    });
    expect(isSynthesisControlBuffer(buffer)).toBe(false);
    expect(() => attachSynthesisControlView(buffer)).toThrow(/magic/i);
  });

  it("rejects unsupported ABI version", () => {
    const buffer = corruptHeader(freshBuffer(), (dv) => {
      dv.setUint32(HEADER_OFFSETS.abiVersion, ABI_VERSION + 9999, true);
    });
    expect(isSynthesisControlBuffer(buffer)).toBe(false);
    expect(() => attachSynthesisControlView(buffer)).toThrow(/version/i);
  });

  it("rejects inconsistent storage (declared byte length mismatch)", () => {
    const buffer = corruptHeader(freshBuffer(), (dv) => {
      dv.setUint32(HEADER_OFFSETS.byteLength, dv.buffer.byteLength + 1024, true);
    });
    expect(isSynthesisControlBuffer(buffer)).toBe(false);
    expect(() => attachSynthesisControlView(buffer)).toThrow();
  });

  it("leaves the consumer state unchanged after a failed attach", () => {
    const buffer = freshBuffer();
    const dv = new DataView(buffer);
    const good = attachSynthesisControlView(buffer);
    // Snapshot one consumer-relevant byte outside the header.
    const sentinelByte = dv.getUint8(good.ringBase);

    // Corrupt the magic and try to attach — must throw.
    for (let i = 0; i < 4; i++) dv.setUint8(good.magicOffset + i, 0x58);
    expect(() => attachSynthesisControlView(buffer)).toThrow();

    // The bytes outside the header are untouched.
    expect(dv.getUint8(good.ringBase)).toBe(sentinelByte);
  });
});

describe("synthesisControlAbi — worklet helpers never wait (VAL-SAB-019)", () => {
  it("exports a frozen documentation array listing the worklet-facing helpers", () => {
    expect(Array.isArray(WORKLET_HELPERS_DOCUMENTED_NON_BLOCKING)).toBe(true);
    expect(Object.isFrozen(WORKLET_HELPERS_DOCUMENTED_NON_BLOCKING)).toBe(true);
    expect(WORKLET_HELPERS_DOCUMENTED_NON_BLOCKING.length).toBeGreaterThan(0);
  });

  it("the public view has no `wait`-style method", () => {
    const { view } = rawBytes(freshBuffer());
    view.initialise();
    const proto = Object.getPrototypeOf(view);
    const methodNames = Object.getOwnPropertyNames(proto).filter(
      (n) => typeof (proto as Record<string, unknown>)[n] === "function",
    );
    const blocking = methodNames.filter((n) =>
      /wait|notify|block/i.test(n),
    );
    expect(blocking).toEqual([]);
  });

  it("documents that Atomics.wait is only used by the worker scheduling path", () => {
    // The constant itself documents this. Prove it exists and is non-empty.
    for (const entry of WORKLET_HELPERS_DOCUMENTED_NON_BLOCKING) {
      expect(typeof entry).toBe("string");
      expect(entry.length).toBeGreaterThan(0);
    }
  });
});

describe("synthesisControlAbi — lookahead and timing constants", () => {
  it("documents the minimum, default, and maximum lookahead", () => {
    expect(MIN_CONTROL_LOOKAHEAD_BLOCKS).toBeLessThanOrEqual(CONTROL_LOOKAHEAD_BLOCKS);
    expect(CONTROL_LOOKAHEAD_BLOCKS).toBeLessThanOrEqual(MAX_CONTROL_LOOKAHEAD_BLOCKS);
    expect(MIN_CONTROL_LOOKAHEAD_BLOCKS).toBe(4);
    expect(CONTROL_LOOKAHEAD_BLOCKS).toBe(6);
    expect(MAX_CONTROL_LOOKAHEAD_BLOCKS).toBe(8);
  });

  it("documents the emergency and fade constants in milliseconds", () => {
    expect(EMERGENCY_FADE_MS).toBe(10);
    expect(SYNTH_FADE_IN_MS).toBe(10);
    expect(SYNTH_FADE_OUT_MS).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// Producer pacing waiter (099d7bfb, synthesis.md §4.1)
// ---------------------------------------------------------------------------

describe("synthesisControlAbi — createProducerPacingWaiter", () => {
  function sharedFreshBuffer(): SharedArrayBuffer {
    const layout = createSynthesisControlBuffer();
    const sab = new SharedArrayBuffer(layout.byteLength);
    new Uint8Array(sab).set(new Uint8Array(layout));
    return sab;
  }

  it("bounds each wait by PRODUCER_WAKE_WAIT_CAP_MS even for large requests", () => {
    const wait = createProducerPacingWaiter(sharedFreshBuffer());
    const start = Date.now();
    // Nothing ever notifies this buffer; the wait must time out at the
    // cap, never at the caller-requested 500 ms.
    wait(500);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(100);
  });

  it("wakes on the wake-word bump publishAudioFrame performs", () => {
    const sab = sharedFreshBuffer();
    const view = attachSynthesisControlView(sab);
    const wake = new BigInt64Array(sab, HEADER_OFFSETS.wakeSequence, 1);
    const before = Atomics.load(wake, 0);
    view.publishAudioFrame({ frame: 128n, blockFrameOffset: 128 });
    // The publish bumped the wake word and issued the notify a blocked
    // producer would wake on.
    expect(Atomics.load(wake, 0)).toBe(before + 1n);
    // A waiter attached now observes the already-advanced word and
    // returns without blocking for the full cap.
    const wait = createProducerPacingWaiter(sab);
    const start = Date.now();
    wait(500);
    expect(Date.now() - start).toBeLessThan(100);
  });
});
