/**
 * Audio-clocked producer scheduler — drives the existing WASM Worker's
 * interpreter as the sole live control producer.
 *
 * Fulfils (see mission feature `m1-audio-clocked-worker-producer`):
 *   VAL-ENGINE-001 — Only the existing Worker advances live ModuLisp
 *                    execution. The scheduler never constructs a second
 *                    interpreter.
 *   VAL-ENGINE-004 — Producer maintains configured lookahead. Published
 *                    blocks cover CONTROL_LOOKAHEAD_BLOCKS into the
 *                    future without exceeding ring bounds.
 *   VAL-ENGINE-005 — External inputs affect the next produced block,
 *                    never an already-published block.
 *   VAL-ENGINE-006 — Producer does not starve message handling. Each
 *                    iteration is bounded; 25 sequential request/response
 *                    pairs each complete within 500 ms while publication
 *                    continues.
 *   VAL-ENGINE-032 — Transport transitions govern live production
 *                    (start, pause, resume, stop, re-anchor).
 *   VAL-SAB-012   — Declared publication helpers are used (no torn
 *                   records).
 *
 * Design contract (normative, synthesis.md §4.3–§4.9):
 *
 *   - The scheduler is **testable outside the Worker**: it accepts a
 *     {@link ProducerSchedulingClock} for the bounded wait and a
 *     {@link ProducerExecutor} for the live interpreter work. The
 *     Worker wiring injects real Atomics + interpreter; tests inject
 *     fakes. The producer is the same module in both paths.
 *
 *   - The scheduler is **single-threaded with respect to its own
 *     state**: the Worker inbox (regular `postMessage` requests like
 *     `evalCode`) is drained by the host between iterations via
 *     {@link ProducerScheduler.processInbox}. Each `iterate()` is
 *     bounded by {@link PRODUCER_POLL_INTERVAL_MS} so the inbox stays
 *     responsive (VAL-ENGINE-006).
 *
 *   - The scheduler never calls `Atomics.wait` directly; the
 *     {@link ProducerSchedulingClock.sleep} hook is the only place
 *     where a bounded wait may occur. The hook is no-op by default
 *     in tests and may sleep up to {@link PRODUCER_POLL_INTERVAL_MS}
 *     in the Worker wiring.
 *
 *   - External inputs are queued atomically via {@link applyInputs}
 *     and applied to the *next* produced block, never retroactively
 *     (VAL-ENGINE-005).
 *
 *   - The producer is the sole place that calls
 *     `view.advanceWriteIndex()`: payload writes complete first, then
 *     the index advances (VAL-SAB-012).
 */
import type { SynthesisControlView } from "../contracts/synthesisControlAbi";
import {
  CONTROL_LOOKAHEAD_BLOCKS,
  DEFAULT_RENDER_QUANTUM_FRAMES,
} from "../contracts/synthesisControlAbi";
import type { TransportFrameMap } from "./transportFrameMap";

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/**
 * Maximum wall-clock a single `iterate()` call may consume inside the
 * scheduler. The Worker wiring honours this by bounding its
 * {@link ProducerSchedulingClock.sleep} calls. Default 4 ms keeps the
 * Worker inbox responsive at roughly 250 Hz iteration cadence, well
 * above the 500 ms response bound required by VAL-ENGINE-006.
 */
export const PRODUCER_POLL_INTERVAL_MS = 4 as const;

/**
 * Response-time deadline enforced by tests and the Worker wiring.
 * VAL-ENGINE-006 requires 25 sequential request/response pairs each
 * complete within 500 ms while publication continues. This constant
 * is the contract surface; tests assert against it.
 */
export const PRODUCER_RESPONSE_DEADLINE_MS = 500 as const;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Clock the scheduler consumes for the bounded wait hook.
 *
 * The Worker wiring supplies a clock whose `sleep(ms)` performs a
 * bounded `Atomics.wait` on the SAB wake int32. Tests supply a fake
 * that simply advances a counter.
 */
export interface ProducerSchedulingClock {
  /** Monotonic wall-clock in milliseconds. */
  now(): number;
  /**
   * Sleep for at most `ms` milliseconds. The Worker wiring uses
   * `Atomics.wait`; tests use a counter.
   */
  sleep(ms: number): void;
}

/**
 * Executor the producer drives. The Worker wiring passes its existing
 * interpreter handle; tests pass a fake. This is the ONLY place the
 * scheduler touches the ModuLisp interpreter, preserving the
 * "one live executor" invariant (VAL-ENGINE-001).
 */
export interface ProducerExecutor {
  /**
   * Sample the live outputs at the given ModuLisp time, applying the
   * supplied external inputs. Returns the block-rate values the
   * producer will publish for the upcoming block.
   *
   * @param time ModuLisp time at the start of the block.
   * @param inputs External inputs to apply (already dequeued).
   * @returns Block-rate values keyed by channel name.
   */
  liveTick(
    time: number,
    inputs: Record<string, number>,
  ): Record<string, number>;
}

/**
 * Audit record per produced block. Tests consume this array (supplied
 * by the caller via {@link ProducerSchedulerOptions.audit}) to assert
 * that the producer applied the right time, inputs, and lookahead
 * depth.
 */
export interface ProducedBlockAudit {
  /** Sequential block index since the producer started. */
  readonly index: number;
  /** Audio frame at the start of the block. */
  readonly frame: bigint;
  /** ModuLisp time the block was sampled at. */
  readonly time: number;
  /** External inputs applied to this block. */
  readonly appliedInputs: Readonly<Record<string, number>>;
  /** Ring slot the block was published into. */
  readonly slot: number;
  /** Epoch tagged on the block. */
  readonly epoch: number;
  /** Revision tagged on the block. */
  readonly revision: number;
}

/**
 * Constructor options.
 */
export interface ProducerSchedulerOptions {
  /** Clock (Atomics.wait hook in production, counter in tests). */
  readonly clock: ProducerSchedulingClock;
  /** Existing interpreter handle (the scheduler never creates another). */
  readonly executor: ProducerExecutor;
  /** SAB view to publish into. */
  readonly view: SynthesisControlView;
  /** Transport frame→time map. */
  readonly map: TransportFrameMap;
  /** Block-rate channel names, in declared order. */
  readonly blockRateChannels: readonly string[];
  /** Lookahead in blocks (default {@link CONTROL_LOOKAHEAD_BLOCKS}). */
  readonly lookaheadBlocks?: number;
  /** Render quantum in frames per block (default 128). */
  readonly renderQuantumFrames?: number;
  /**
   * Optional audit sink. The scheduler pushes one {@link ProducedBlockAudit}
   * per published block; tests inspect the array directly.
   */
  readonly audit?: ProducedBlockAudit[];
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ProducerSchedulerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProducerSchedulerError";
  }
}

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

/**
 * Audio-clocked producer scheduler. Construct via
 * {@link createProducerScheduler}.
 */
export interface ProducerScheduler {
  /** Whether the producer is currently running. */
  isRunning(): boolean;

  /**
   * Begin producing. The producer does not start publishing until
   * `iterate()` observes a monotonic audio frame.
   */
  start(): void;

  /**
   * Stop producing. Safe to call multiple times. Future `iterate()`
   * calls are no-ops until `start()` is called again.
   */
  stop(): void;

  /**
   * Run one bounded iteration of the producer loop. The host calls
   * this between draining its Worker inbox. Each call publishes
   * enough blocks to refill the ring up to {@link lookaheadBlocks},
   * bounded by {@link PRODUCER_POLL_INTERVAL_MS}.
   *
   * The host is responsible for calling
   * {@link SynthesisControlView.publishAudioFrame} on the worklet's
   * behalf (or wiring the worklet to publish directly). The producer
   * observes the latest audio frame via `view.audioFrame`.
   */
  iterate(): void;

  /**
   * Apply external inputs to the NEXT produced block. Inputs are
   * queued atomically; the next call to `iterate()` applies them to
   * the block it produces and then clears the queue. Inputs never
   * retroactively modify an already-published block (VAL-ENGINE-005).
   */
  applyInputs(inputs: Record<string, number>): void;

  /**
   * Drain the Worker inbox between iterations. The host passes a
   * callback that processes one queued message (or returns immediately
   * if no message is queued). The scheduler bounds the total time
   * spent inside the callback so the producer keeps running.
   *
   * @param processOne Called repeatedly until it returns `false` or
   *                   the iteration budget is exhausted.
   */
  processInbox(processOne: () => boolean): void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a producer scheduler.
 *
 * The scheduler is browser-global-free. The Worker wiring constructs
 * it with real Atomics and the existing interpreter; tests construct
 * it with fakes.
 */
export function createProducerScheduler(
  options: ProducerSchedulerOptions,
): ProducerScheduler {
  const view = options.view;
  const map = options.map;
  const executor = options.executor;
  const clock = options.clock;
  const blockRateChannels = options.blockRateChannels;
  const lookaheadBlocks = options.lookaheadBlocks ?? CONTROL_LOOKAHEAD_BLOCKS;
  const renderQuantumFrames =
    options.renderQuantumFrames ?? DEFAULT_RENDER_QUANTUM_FRAMES;
  const audit = options.audit;

  let running = false;
  let blockIndex = 0;
  let lastProducedFrame = -1n;
  let pendingInputs: Record<string, number> = {};

  // Bounded per-iteration budget. The scheduler MUST leave the host
  // responsive inside PRODUCER_POLL_INTERVAL_MS.
  function withinBudget(startedAt: number): boolean {
    return clock.now() - startedAt < PRODUCER_POLL_INTERVAL_MS;
  }

  function produceOneBlock(
    frame: bigint,
    slot: number,
    epoch: number,
    revision: number,
  ): void {
    const time = map.sample(frame);
    const inputs = pendingInputs;
    pendingInputs = {};

    const outputs = executor.liveTick(time, inputs);
    // Write block-rate channels.
    for (let i = 0; i < blockRateChannels.length; i++) {
      const name = blockRateChannels[i];
      const value = outputs[name];
      if (typeof value === "number" && Number.isFinite(value)) {
        view.writeBlockRateValue(slot, i, value);
      } else {
        // Non-finite values are replaced with zero per synthesis.md §4.9.
        view.writeBlockRateValue(slot, i, 0);
      }
    }
    // Tag the block with the current epoch / revision.
    view.writeBlockEpoch(slot, epoch);
    view.writeBlockRevision(slot, revision);
    view.writeBlockFrameOffset(slot, Number(frame % BigInt(renderQuantumFrames)));

    if (audit) {
      audit.push({
        index: blockIndex,
        frame,
        time,
        appliedInputs: Object.freeze({ ...inputs }),
        slot,
        epoch,
        revision,
      });
    }
    blockIndex += 1;
    // Release-publish the slot (the ONLY producer publication step).
    view.advanceWriteIndex();
  }

  return {
    isRunning: () => running,

    start() {
      if (running) return;
      running = true;
      blockIndex = 0;
      lastProducedFrame = -1n;
      pendingInputs = {};
    },

    stop() {
      running = false;
    },

    applyInputs(inputs) {
      // Merge into the pending queue so the next block sees the union
      // of every input applied since the last production.
      pendingInputs = { ...pendingInputs, ...inputs };
    },

    processInbox(processOne) {
      const startedAt = clock.now();
      let keepGoing = true;
      while (keepGoing && withinBudget(startedAt)) {
        try {
          keepGoing = processOne();
        } catch {
          keepGoing = false;
        }
      }
    },

    iterate() {
      if (!running) return;
      const startedAt = clock.now();

      // Acquire the latest audio frame published by the worklet.
      const currentFrame = view.audioFrame;

      // Determine how many blocks we should publish to maintain the
      // configured lookahead. The producer's horizon is the audio
      // frame plus `lookaheadBlocks` render quanta; the producer should
      // have published up to that horizon already.
      const horizonFrame =
        currentFrame + BigInt(lookaheadBlocks * renderQuantumFrames);

      const epoch = view.pendingEpoch || view.programEpoch;
      const revision = map.revision();

      // Publish blocks forward from the last produced frame to the horizon.
      while (
        lastProducedFrame < horizonFrame - BigInt(renderQuantumFrames) &&
        withinBudget(startedAt)
      ) {
        const nextFrame =
          lastProducedFrame < 0n
            ? currentFrame
            : lastProducedFrame + BigInt(renderQuantumFrames);
        const slot = view.physicalSlotForSequence(view.ringWriteIndex);
        // Guard against overrun: if the ring is full, stop publishing.
        // The worklet will drain; the next iteration picks up.
        if (view.consumerAvailableBlocks() >= view.ringCapacityBlocks - 1) {
          break;
        }
        produceOneBlock(nextFrame, slot, epoch, revision);
        lastProducedFrame = nextFrame;
      }
    },
  };
}
