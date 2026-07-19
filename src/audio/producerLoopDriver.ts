/**
 * Cancellable, task-yielding producer loop driver.
 *
 * Fulfils (see mission feature `m1-fix-worker-producer-task-starvation` /
 * Ergo bug ca5e1cc3):
 *   VAL-ENGINE-006 — Producer does not starve message handling.
 *
 * Background
 * ----------
 * The original Worker producer pump was a recursively self-replenishing
 * `queueMicrotask` chain:
 *
 *     function scheduleProducerLoop() {
 *       if (producerLoopScheduled) return;
 *       producerLoopScheduled = true;
 *       queueMicrotask(() => {
 *         producerLoopScheduled = false;
 *         producer.iterate();
 *         scheduleProducerLoop();   // <-- unconditional recursive re-arm
 *       });
 *     }
 *
 * Microtasks always run before the next macrotask. Worker messages
 * (`postMessage` events on `self`) are delivered as macrotasks. A
 * self-replenishing microtask pump therefore never yields to the Worker
 * inbox: in steady state the producer keeps queueing iterations, and
 * every queued eval / transport / lifecycle request waits
 * indefinitely behind the microtask queue.
 *
 * The fix is this module: a cancellable loop driver that yields to the
 * host task queue between iterations via a host-supplied
 * {@link ProducerLoopHost.yieldToQueue} hook. In the Worker wiring the
 * hook uses `setTimeout(runNext, 0)` — a macrotask that interleaves
 * fairly with `postMessage` dispatch. Tests inject a fake hook so the
 * anti-starvation property can be asserted deterministically.
 *
 * Design contract
 * ---------------
 *   - The driver is **testable outside the Worker**: it consumes only
 *     two host hooks (`iterate` and `yieldToQueue`). The Worker wiring
 *     passes real `producer.iterate()` + `setTimeout(0)`; tests pass
 *     fakes.
 *
 *   - The driver is **single-threaded with respect to its own state**:
 *     cancellation flips a boolean; the deferred `runNext` callback
 *     checks it before iterating again. Cancellation is observable on
 *     the next turn even if a callback was already queued.
 *
 *   - The driver **cannot self-replenish via microtask**: every
 *     iteration is followed by `yieldToQueue(runNext)` before another
 *     iteration can run. This is the explicit anti-starvation property.
 *
 *   - The driver **never blocks**: it does not call `Atomics.wait` and
 *     does not sleep. Bounded waiting inside the producer scheduler is
 *     the scheduler's own concern (PRODUCER_POLL_INTERVAL_MS).
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Host hooks the driver consumes. The Worker wiring passes real hooks;
 * tests pass fakes that record yields for deterministic inspection.
 */
export interface ProducerLoopHost {
  /**
   * Run one bounded producer iteration. Must return promptly; the
   * producer scheduler already bounds each call by
   * {@link "../producerScheduler"}`.PRODUCER_POLL_INTERVAL_MS`.
   */
  iterate(): void;

  /**
   * Schedule `runNext` to fire on a later turn of the host task queue
   * (macrotask). The Worker wiring uses `setTimeout(runNext, 0)`;
   * tests defer into a queue the test flushes explicitly.
   *
   * This hook is the SOLE scheduling primitive the driver uses. The
   * driver never calls `queueMicrotask` directly.
   *
   * @param runNext The next-iteration callback. The host MUST invoke
   *   it exactly once on a later task turn, or never (after
   *   cancellation the callback becomes a no-op regardless).
   */
  yieldToQueue(runNext: () => void): void;
}

/**
 * Cancellable, task-yielding producer loop driver.
 *
 * Construct via {@link createProducerLoopDriver}.
 */
export interface ProducerLoopDriver {
  /** Whether the driver currently has a live loop scheduled. */
  isRunning(): boolean;

  /**
   * Begin driving the producer loop. Idempotent: calling `start()`
   * while the loop is already running is a no-op. Schedules exactly
   * one yield-to-queue turn; subsequent iterations are scheduled by
   * the loop itself, one per yield.
   */
  start(): void;

  /**
   * Cancel every future producer callback. Safe to call multiple
   * times. Any callback that was already queued via `yieldToQueue`
   * becomes a no-op on its next invocation.
   */
  stop(): void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a cancellable, task-yielding producer loop driver.
 *
 * @param host Host hooks (iterate + yieldToQueue).
 */
export function createProducerLoopDriver(host: ProducerLoopHost): ProducerLoopDriver {
  let running = false;
  // Generation counter: every stop() bumps it so any previously
  // scheduled runNext callback can detect that it is stale and bail
  // out without iterating. This is the explicit cancellation
  // contract: even if a macrotask is already in the host's task
  // queue, it will see a generation mismatch and become a no-op.
  let generation = 0;

  const runNext = (): void => {
    if (!running) return;
    host.iterate();
    // After the bounded iteration, schedule the next turn via a real
    // yield. If stop() was called during iterate(), running is now
    // false and the scheduled callback will no-op when it fires.
    if (!running) return;
    const myGeneration = generation;
    host.yieldToQueue(() => {
      if (!running || generation !== myGeneration) return;
      runNext();
    });
  };

  return {
    isRunning: () => running,

    start() {
      if (running) return;
      running = true;
      generation += 1;
      const myGeneration = generation;
      host.yieldToQueue(() => {
        if (!running || generation !== myGeneration) return;
        runNext();
      });
    },

    stop() {
      if (!running) return;
      running = false;
      // Bump the generation so any already-scheduled runNext callbacks
      // detect they are stale and become no-ops.
      generation += 1;
    },
  };
}
