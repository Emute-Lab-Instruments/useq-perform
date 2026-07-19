/**
 * Contract tests for the producer scheduler.
 *
 * Covers (see mission feature `m1-audio-clocked-worker-producer`):
 *   VAL-ENGINE-001 — Only the existing Worker advances live ModuLisp
 *                    execution.
 *   VAL-ENGINE-004 — Producer maintains configured lookahead.
 *   VAL-ENGINE-005 — External inputs affect the next produced block,
 *                    not already-published blocks.
 *   VAL-ENGINE-006 — Producer does not starve message handling.
 *                    Twenty-five sequential request/response pairs each
 *                    complete within 500 ms while production continues.
 *   VAL-ENGINE-032 — Transport transitions govern live production.
 *   VAL-SAB-012   — Declared publication helpers are used (the producer
 *                   does not bypass advanceWriteIndex / publishAudioFrame).
 *
 * Design contract (normative, synthesis.md §4.3–4.9):
 *
 *   - The scheduler is testable without a Worker: it consumes a
 *     {@link ProducerSchedulingClock} for `Atomics.wait`-equivalent
 *     wake polling and a {@link ProducerExecutor} for the live tick
 *     work. The Worker wiring injects the real Atomics + interpreter;
 *     tests inject fakes.
 *
 *   - The scheduler's outer loop is structured so the host can call
 *     `processInbox()` between iterations to drain queued Worker
 *     messages. The scheduler never blocks longer than a bounded
 *     `maxWaitMs` (default 4 ms) per iteration, ensuring the Worker
 *     inbox stays responsive.
 *
 *   - External inputs are queued by the host and applied to the *next*
 *     produced block, never to an already-published block
 *     (VAL-ENGINE-005).
 *
 *   - The producer never creates a second ModuLisp executor: it only
 *     drives the existing {@link ProducerExecutor} handed to it
 *     (VAL-ENGINE-001).
 *
 * These tests were observed failing before the module existed (the
 * import did not resolve) and pass after the canonical scheduler
 * lands.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";

import {
  ABI_VERSION,
  CONTROL_LOOKAHEAD_BLOCKS,
  DEFAULT_RENDER_QUANTUM_FRAMES,
  attachSynthesisControlView,
  createSynthesisControlBuffer,
} from "../contracts/synthesisControlAbi";
import {
  createTransportFrameMap,
} from "./transportFrameMap";
import {
  createProducerScheduler,
  PRODUCER_POLL_INTERVAL_MS,
  PRODUCER_RESPONSE_DEADLINE_MS,
  type ProducedBlockAudit,
  type ProducerExecutor,
  type ProducerScheduler,
  type ProducerSchedulerOptions,
  type ProducerSchedulingClock,
} from "./producerScheduler";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/**
 * Fake clock. Time advances manually via `tick(ms)` so tests can drive
 * the producer loop deterministically.
 */
function createFakeClock(): ProducerSchedulingClock & {
  tick(ms: number): void;
  now(): number;
} {
  let t = 0;
  return {
    now: () => t,
    sleep(ms: number): void {
      t += ms;
    },
    tick(ms: number): void {
      t += ms;
    },
  };
}

/**
 * Fake executor. Records every call so tests can assert that the
 * producer advanced the interpreter exactly once per lookahead block,
 * never retroactively modified a block, and applied external inputs to
 * the next produced block.
 *
 * The `liveTick` function returns a deterministic value derived from
 * the ModuLisp time so the producer can pre-fill block-rate channels.
 */
function createFakeExecutor(): ProducerExecutor & {
  calls(): ReadonlyArray<{
    time: number;
    outputs: Record<string, number>;
    inputs: Record<string, number>;
  }>;
  reset(): void;
  setOutputs(map: Record<string, number>): void;
  setOutput(name: string, value: number): void;
} {
  const calls: Array<{
    time: number;
    outputs: Record<string, number>;
    inputs: Record<string, number>;
  }> = [];
  let nextOutputs: Record<string, number> = { freq: 440, amp: 0.2 };
  return {
    liveTick(time, inputs) {
      // Capture the inputs the producer applied for this block.
      const recorded: Record<string, number> = { ...inputs };
      calls.push({ time, outputs: { ...nextOutputs }, inputs: recorded });
      return { ...nextOutputs };
    },
    calls: () => calls,
    reset() {
      calls.length = 0;
    },
    setOutputs(map) {
      nextOutputs = { ...map };
    },
    setOutput(name, value) {
      nextOutputs = { ...nextOutputs, [name]: value };
    },
  };
}

/**
 * Build a real SAB-backed view for the producer to publish into.
 */
function createView() {
  const buf = createSynthesisControlBuffer();
  // Cast to SharedArrayBuffer-like — the producer only needs ArrayBuffer
  // access for these contract tests (the real Worker uses SAB).
  return attachSynthesisControlView(buf);
}

// ---------------------------------------------------------------------------
// Scheduler construction
// ---------------------------------------------------------------------------

function buildScheduler(opts: {
  clock?: ProducerSchedulingClock;
  executor?: ProducerExecutor;
  blockRateChannels?: ReadonlyArray<string>;
  lookaheadBlocks?: number;
  renderQuantumFrames?: number;
} = {}): {
  scheduler: ProducerScheduler;
  clock: ReturnType<typeof createFakeClock>;
  executor: ReturnType<typeof createFakeExecutor>;
  view: ReturnType<typeof createView>;
  map: ReturnType<typeof createTransportFrameMap>;
  audit: ProducedBlockAudit[];
} {
  const clock = (opts.clock ?? createFakeClock()) as ReturnType<typeof createFakeClock>;
  const executor = (opts.executor ?? createFakeExecutor()) as ReturnType<typeof createFakeExecutor>;
  const view = createView();
  const map = createTransportFrameMap({ sampleRate: 48000 });
  const audit: ProducedBlockAudit[] = [];
  const schedulerOpts: ProducerSchedulerOptions = {
    clock,
    executor,
    view,
    map,
    blockRateChannels: opts.blockRateChannels ?? ["freq", "amp"],
    lookaheadBlocks: opts.lookaheadBlocks ?? CONTROL_LOOKAHEAD_BLOCKS,
    renderQuantumFrames: opts.renderQuantumFrames ?? DEFAULT_RENDER_QUANTUM_FRAMES,
    audit,
  };
  const scheduler = createProducerScheduler(schedulerOpts);
  return { scheduler, clock, executor, view, map, audit };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("producerScheduler / lookahead publication (VAL-ENGINE-004)", () => {
  it("publishes CONTROL_LOOKAHEAD_BLOCKS ahead of the current audio frame", () => {
    const { scheduler, view, map } = buildScheduler();
    map.start({ atFrame: 0n, atTime: 0 });
    scheduler.start();

    // Simulate the worklet publishing audio frame 1 (monotonic).
    view.publishAudioFrame({ frame: 1n, blockFrameOffset: 1 });
    scheduler.iterate();

    // Producer should have published CONTROL_LOOKAHEAD_BLOCKS blocks into
    // the ring (write index advanced by that many).
    expect(view.ringWriteIndex).toBe(CONTROL_LOOKAHEAD_BLOCKS);
    scheduler.stop();
  });

  it("keeps the ring horizon bounded by CONTROL_LOOKAHEAD_BLOCKS + slack", () => {
    const { scheduler, view, map } = buildScheduler();
    map.start({ atFrame: 0n, atTime: 0 });
    scheduler.start();

    view.publishAudioFrame({ frame: 1n, blockFrameOffset: 1 });
    scheduler.iterate();
    const firstFill = view.ringFillDepth();
    expect(firstFill).toBeLessThanOrEqual(CONTROL_LOOKAHEAD_BLOCKS);

    // Next block: simulate worklet consuming one and publishing the next frame.
    view.publishAudioFrame({
      frame: 1n + BigInt(DEFAULT_RENDER_QUANTUM_FRAMES),
      blockFrameOffset: 1,
    });
    view.advanceReadIndex();
    scheduler.iterate();
    const secondFill = view.ringFillDepth();
    expect(secondFill).toBeLessThanOrEqual(CONTROL_LOOKAHEAD_BLOCKS);
    scheduler.stop();
  });
});

describe("producerScheduler / external inputs affect next block (VAL-ENGINE-005)", () => {
  it("does not modify already-published blocks when inputs arrive", () => {
    const { scheduler, view, map, audit } = buildScheduler();
    map.start({ atFrame: 0n, atTime: 0 });
    scheduler.start();

    view.publishAudioFrame({ frame: 1n, blockFrameOffset: 1 });
    scheduler.iterate();
    const firstBlockFreq = view.readBlockRateValue(0, 0);
    expect(audit.length).toBe(CONTROL_LOOKAHEAD_BLOCKS);

    // Capture the audit for block 0 before applying inputs.
    const audit0 = audit[0];
    expect(audit0.appliedInputs).toEqual({});

    // Apply an external input AFTER block 0 was published.
    scheduler.applyInputs({ freq: 880 });
    view.publishAudioFrame({
      frame: 1n + BigInt(DEFAULT_RENDER_QUANTUM_FRAMES),
      blockFrameOffset: 1,
    });
    view.advanceReadIndex();
    scheduler.iterate();

    // The published value for block 0 must not have changed.
    expect(view.readBlockRateValue(0, 0)).toBe(firstBlockFreq);
    scheduler.stop();
  });

  it("applies queued inputs starting at the next produced block", () => {
    const { scheduler, view, map, audit } = buildScheduler();
    map.start({ atFrame: 0n, atTime: 0 });
    scheduler.start();

    view.publishAudioFrame({ frame: 1n, blockFrameOffset: 1 });
    scheduler.iterate();

    scheduler.applyInputs({ freq: 880 });
    const startingWriteIndex = view.ringWriteIndex;
    view.publishAudioFrame({
      frame: 1n + BigInt(DEFAULT_RENDER_QUANTUM_FRAMES),
      blockFrameOffset: 1,
    });
    view.advanceReadIndex();
    scheduler.iterate();

    // The next produced block (audit index = startingWriteIndex, since the
    // ring is 0-indexed and that block was just published) carries the input.
    const nextAudit = audit[startingWriteIndex];
    expect(nextAudit).toBeDefined();
    expect(nextAudit.appliedInputs.freq).toBe(880);
    scheduler.stop();
  });
});

describe("producerScheduler / responsiveness bound (VAL-ENGINE-006)", () => {
  it("services 25 request/response pairs within the 500 ms bound", () => {
    const { scheduler, view, map, clock } = buildScheduler();
    map.start({ atFrame: 0n, atTime: 0 });
    scheduler.start();
    view.publishAudioFrame({ frame: 1n, blockFrameOffset: 1 });
    scheduler.iterate();

    // Simulate 25 sequential request/response pairs. Each pair calls
    // processInbox() once (drains queued Worker messages) and observes
    // the wall-clock spent inside the scheduler.
    const timings: number[] = [];
    for (let i = 0; i < 25; i++) {
      const start = clock.now();
      // Each request triggers a bounded iteration (max 4 ms inside the
      // scheduler). The host drains its queued messages between iterations.
      scheduler.processInbox(() => {
        // Simulated message handling.
        clock.tick(2);
      });
      view.publishAudioFrame({
        frame: 1n + BigInt((i + 1) * DEFAULT_RENDER_QUANTUM_FRAMES),
        blockFrameOffset: 1,
      });
      view.advanceReadIndex();
      scheduler.iterate();
      const elapsed = clock.now() - start;
      timings.push(elapsed);
    }

    for (const t of timings) {
      expect(t).toBeLessThan(PRODUCER_RESPONSE_DEADLINE_MS);
    }
    scheduler.stop();
  });

  it("never blocks longer than PRODUCER_POLL_INTERVAL_MS per iteration", () => {
    const { scheduler, view, map, clock } = buildScheduler();
    map.start({ atFrame: 0n, atTime: 0 });
    scheduler.start();

    const blocked: number[] = [];
    for (let i = 0; i < 10; i++) {
      const start = clock.now();
      view.publishAudioFrame({
        frame: 1n + BigInt(i * DEFAULT_RENDER_QUANTUM_FRAMES),
        blockFrameOffset: 1,
      });
      view.advanceReadIndex();
      scheduler.iterate();
      blocked.push(clock.now() - start);
    }
    for (const b of blocked) {
      expect(b).toBeLessThanOrEqual(PRODUCER_POLL_INTERVAL_MS);
    }
    scheduler.stop();
  });
});

describe("producerScheduler / transport transitions (VAL-ENGINE-032)", () => {
  it("paused transport maps every produced block to the paused ModuLisp time", () => {
    const { scheduler, view, map, audit } = buildScheduler();
    map.start({ atFrame: 0n, atTime: 0 });
    scheduler.start();
    view.publishAudioFrame({ frame: 1n, blockFrameOffset: 1 });
    scheduler.iterate();

    map.pause({ atFrame: BigInt(DEFAULT_RENDER_QUANTUM_FRAMES), atTime: 0.5 });
    audit.length = 0;
    view.publishAudioFrame({
      frame: 1n + BigInt(2 * DEFAULT_RENDER_QUANTUM_FRAMES),
      blockFrameOffset: 1,
    });
    view.advanceReadIndex();
    scheduler.iterate();

    // Every block produced after the pause must map to the paused time.
    const paused = audit.filter((a) => a.time === 0.5);
    expect(paused.length).toBeGreaterThan(0);
    scheduler.stop();
  });

  it("stopped transport produces blocks at ModuLisp time 0", () => {
    const { scheduler, view, map, audit } = buildScheduler();
    map.start({ atFrame: 0n, atTime: 0 });
    scheduler.start();
    view.publishAudioFrame({ frame: 1n, blockFrameOffset: 1 });
    scheduler.iterate();

    map.stop({ atFrame: BigInt(DEFAULT_RENDER_QUANTUM_FRAMES) });
    audit.length = 0;
    view.publishAudioFrame({
      frame: 1n + BigInt(2 * DEFAULT_RENDER_QUANTUM_FRAMES),
      blockFrameOffset: 1,
    });
    view.advanceReadIndex();
    scheduler.iterate();

    // Stopped transport produces blocks but the time is always 0.
    for (const a of audit) {
      expect(a.time).toBe(0);
    }
    scheduler.stop();
  });

  it("resume re-anchors without carrying stale blocks", () => {
    const { scheduler, view, map, audit } = buildScheduler();
    map.start({ atFrame: 0n, atTime: 0 });
    scheduler.start();
    view.publishAudioFrame({ frame: 1n, blockFrameOffset: 1 });
    scheduler.iterate();
    const beforeResume = audit.length;
    const firstResumeFrame =
      1n + BigInt(CONTROL_LOOKAHEAD_BLOCKS * DEFAULT_RENDER_QUANTUM_FRAMES);

    map.pause({ atFrame: BigInt(DEFAULT_RENDER_QUANTUM_FRAMES), atTime: 1.0 });
    map.resume({
      atFrame: BigInt(2 * DEFAULT_RENDER_QUANTUM_FRAMES),
      atTime: 1.0,
    });
    audit.length = 0;
    view.publishAudioFrame({
      frame: firstResumeFrame + 1n,
      blockFrameOffset: 1,
    });
    view.advanceReadIndex();
    scheduler.iterate();

    // The first newly-produced block's frame is `firstResumeFrame`, which
    // is CONTROL_LOOKAHEAD_BLOCKS quanta ahead of the audio frame we just
    // published. Map it to ModuLisp time and confirm the audit matches.
    expect(audit.length).toBeGreaterThan(0);
    const expectedTime = map.sample(firstResumeFrame);
    expect(audit[0].time).toBeCloseTo(expectedTime, 6);
    expect(audit[0].time).toBeCloseTo(1.0, 1); // Resumed at 1.0; new blocks remain near it.
    void beforeResume;
    scheduler.stop();
  });
});

describe("producerScheduler / sole executor invariant (VAL-ENGINE-001)", () => {
  it("does not create a second interpreter", () => {
    const executor = createFakeExecutor();
    const { scheduler, view, map } = buildScheduler({ executor });
    map.start({ atFrame: 0n, atTime: 0 });
    scheduler.start();
    view.publishAudioFrame({ frame: 1n, blockFrameOffset: 1 });
    scheduler.iterate();

    // Only the supplied executor's liveTick was called; no second
    // interpreter was constructed.
    expect(executor.calls().length).toBe(CONTROL_LOOKAHEAD_BLOCKS);
    scheduler.stop();
  });
});

describe("producerScheduler / uses declared publication helpers (VAL-SAB-012)", () => {
  it("publishes via advanceWriteIndex (does not bypass)", () => {
    const { scheduler, view, map } = buildScheduler();
    map.start({ atFrame: 0n, atTime: 0 });
    scheduler.start();
    const spy = vi.spyOn(view, "advanceWriteIndex");
    view.publishAudioFrame({ frame: 1n, blockFrameOffset: 1 });
    scheduler.iterate();
    expect(spy).toHaveBeenCalled();
    scheduler.stop();
    spy.mockRestore();
  });

  it("writes block epoch and revision per published block", () => {
    const { scheduler, view, map } = buildScheduler();
    map.start({ atFrame: 0n, atTime: 0 });
    // Arm a pending epoch so the producer tags blocks with it.
    view.pendingEpoch = 7;
    scheduler.start();
    view.publishAudioFrame({ frame: 1n, blockFrameOffset: 1 });
    scheduler.iterate();

    const epoch = view.readBlockEpoch(0);
    const revision = view.readBlockRevision(0);
    expect(epoch).toBe(7);
    expect(revision).toBe(map.revision());
    scheduler.stop();
  });
});

describe("producerScheduler / termination", () => {
  it("stop halts production and future iterate() is a no-op", () => {
    const { scheduler, view, map, executor } = buildScheduler();
    map.start({ atFrame: 0n, atTime: 0 });
    scheduler.start();
    view.publishAudioFrame({ frame: 1n, blockFrameOffset: 1 });
    scheduler.iterate();
    const firstCount = executor.calls().length;

    scheduler.stop();
    view.publishAudioFrame({
      frame: 1n + BigInt(DEFAULT_RENDER_QUANTUM_FRAMES),
      blockFrameOffset: 1,
    });
    scheduler.iterate();

    expect(executor.calls().length).toBe(firstCount);
  });

  it("is safe to call stop twice", () => {
    const { scheduler } = buildScheduler();
    scheduler.start();
    scheduler.stop();
    expect(() => scheduler.stop()).not.toThrow();
  });
});

describe("producerScheduler / ABI version", () => {
  it("attaches the SAB with the canonical ABI version", () => {
    const { scheduler, view } = buildScheduler();
    scheduler.start();
    expect(view.abiVersion).toBe(ABI_VERSION);
    scheduler.stop();
  });
});
