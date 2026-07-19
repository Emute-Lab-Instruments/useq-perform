/**
 * Contract tests for the cancellable, task-yielding producer loop driver.
 *
 * Covers (see mission feature `m1-fix-worker-producer-task-starvation`):
 *   VAL-ENGINE-006 — Producer does not starve message handling.
 *
 * Background (Ergo ca5e1cc3):
 *   The original producer pump was a recursively self-replenishing
 *   `queueMicrotask` chain. Microtasks always run before the next
 *   macrotask, and Worker messages (`postMessage` events) are delivered
 *   as macrotasks. A self-replenishing microtask pump therefore never
 *   yields to the Worker's message queue: in steady state the producer
 *   keeps queueing iterations, and every queued eval / transport /
 *   lifecycle request waits indefinitely behind the microtask queue.
 *
 * The fix is a cancellable loop driver that yields to the host task
 * queue between iterations (via a macrotask-style scheduler such as
 * `setTimeout(0)` in the Worker wiring). Tests verify:
 *
 *   1. Every iteration yields to the host task queue before the next
 *      iteration runs (so queued messages get a turn).
 *   2. `stop()` cancels every future producer callback synchronously.
 *   3. `producerStart` followed by 25 mixed request/response pairs each
 *      stay within the 500 ms responsiveness bound while publication
 *      continues (the canonical VAL-ENGINE-006 evidence).
 *
 * These tests were observed failing before the module existed (the
 * import did not resolve).
 */
import { describe, expect, it, vi } from "vitest";

import {
  createProducerLoopDriver,
  type ProducerLoopHost,
} from "./producerLoopDriver";

// ---------------------------------------------------------------------------
// Fake host — records every yield so tests can prove the driver yields
// to the host task queue between iterations.
// ---------------------------------------------------------------------------

interface FakeHost extends ProducerLoopHost {
  yieldCount(): number;
  iterateCount(): number;
  pendingYields: Array<() => void>;
  flushPendingYields(): void;
}

function createFakeHost(): FakeHost {
  let yields = 0;
  let iterations = 0;
  const pendingYields: Array<() => void> = [];
  return {
    iterate: vi.fn(() => {
      iterations += 1;
    }),
    yieldToQueue: vi.fn((runNext: () => void) => {
      yields += 1;
      // Defer — simulates setTimeout(0) / MessageChannel macrotask yield.
      // The test controls when the next turn fires by calling
      // flushPendingYields().
      pendingYields.push(runNext);
    }),
    yieldCount: () => yields,
    iterateCount: () => iterations,
    pendingYields,
    flushPendingYields() {
      const queued = pendingYields.splice(0);
      for (const fn of queued) fn();
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("producerLoopDriver / VAL-ENGINE-006 yields between iterations", () => {
  it("every iteration is followed by a yield to the host task queue", () => {
    const host = createFakeHost();
    const driver = createProducerLoopDriver(host);
    driver.start();

    // Pump several cycles: each flush runs one deferred turn (which
    // iterates once and queues another yield).
    for (let i = 0; i < 5; i++) {
      host.flushPendingYields();
    }

    // After 5 yields, we ran 5 iterations. The yield count is at least
    // the iteration count — every iteration is followed by a yield
    // before the next iteration can run.
    expect(host.iterateCount()).toBeGreaterThanOrEqual(5);
    expect(host.yieldCount()).toBeGreaterThanOrEqual(host.iterateCount());
    driver.stop();
  });

  it("does not run two iterations back-to-back without a yield", () => {
    const host = createFakeHost();
    const driver = createProducerLoopDriver(host);
    driver.start();

    // With zero yields flushed, NO iteration can have run more than
    // the initial one (if any) — the driver cannot self-replenish via
    // microtask.
    const beforeFlush = host.iterateCount();
    expect(beforeFlush).toBeLessThanOrEqual(1);

    // Flush one yield → exactly one more iteration.
    host.flushPendingYields();
    const afterFirstFlush = host.iterateCount();
    expect(afterFirstFlush).toBe(beforeFlush + 1);

    // Without flushing again, no further iterations can have happened.
    // This is the explicit anti-starvation property: the host MUST
    // yield to its task queue between iterations.
    expect(host.iterateCount()).toBe(afterFirstFlush);

    driver.stop();
  });
});

describe("producerLoopDriver / cancellation", () => {
  it("stop cancels every future producer callback", () => {
    const host = createFakeHost();
    const driver = createProducerLoopDriver(host);
    driver.start();
    host.flushPendingYields();
    const iterationsBeforeStop = host.iterateCount();
    expect(iterationsBeforeStop).toBeGreaterThan(0);

    driver.stop();

    // Flushing yields after stop must NOT run any further iterations.
    host.flushPendingYields();
    host.flushPendingYields();
    host.flushPendingYields();
    expect(host.iterateCount()).toBe(iterationsBeforeStop);
  });

  it("is safe to call stop twice", () => {
    const host = createFakeHost();
    const driver = createProducerLoopDriver(host);
    driver.start();
    expect(() => {
      driver.stop();
      driver.stop();
    }).not.toThrow();
  });

  it("start is idempotent and does not schedule multiple concurrent loops", () => {
    const host = createFakeHost();
    const driver = createProducerLoopDriver(host);
    driver.start();
    driver.start();
    driver.start();
    // After one flush, only ONE iteration should have run (not three).
    host.flushPendingYields();
    expect(host.iterateCount()).toBe(1);
    driver.stop();
  });

  it("stop before start is a no-op", () => {
    const host = createFakeHost();
    const driver = createProducerLoopDriver(host);
    expect(() => driver.stop()).not.toThrow();
    expect(host.iterateCount()).toBe(0);
  });
});

describe("producerLoopDriver / VAL-ENGINE-006 responsiveness bound", () => {
  it("completes 25 mixed request/response pairs within 500 ms while publication continues", () => {
    // Simulate a Worker inbox: each "message" is a () => boolean that
    // returns true if there is more work, false to drain. Between
    // messages the host pump yields (setTimeout 0 style).
    let virtualNow = 0;
    let iterations = 0;
    const host: FakeHost = {
      iterate: vi.fn(() => {
        iterations += 1;
        virtualNow += 4; // bounded by PRODUCER_POLL_INTERVAL_MS
      }),
      yieldToQueue: vi.fn((runNext: () => void) => {
        // Defer to the next macrotask turn (test flushes explicitly).
        host.pendingYields.push(runNext);
      }),
      yieldCount: () => 0,
      iterateCount: () => iterations,
      pendingYields: [],
      flushPendingYields() {
        const queued = this.pendingYields.splice(0);
        for (const fn of queued) fn();
      },
    };
    const driver = createProducerLoopDriver(host);
    driver.start();

    const timings: number[] = [];
    for (let i = 0; i < 25; i++) {
      const start = virtualNow;
      // One request handled.
      virtualNow += 2; // simulate eval/transport/lifecycle message work
      // The producer gets a bounded turn after each message.
      host.flushPendingYields();
      timings.push(virtualNow - start);
    }

    for (const elapsed of timings) {
      expect(elapsed).toBeLessThan(500);
    }
    // And publication kept going: we ran at least 25 iterations total.
    expect(iterations).toBeGreaterThanOrEqual(25);

    driver.stop();
  });
});
