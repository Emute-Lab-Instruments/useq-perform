import { describe, it, expect } from "vitest";
import {
  advanceQueue,
  completeActive,
  BURST_THRESHOLD,
  type QueueState,
} from "./typewriterQueue";

const msgs = (...ids: number[]) => ids.map((id) => ({ id }));
const idle: QueueState = { activeId: null, flushedUpToId: 0 };

describe("typewriterQueue.advanceQueue", () => {
  it("arms the first message when idle", () => {
    expect(advanceQueue(msgs(1, 2, 3), idle)).toEqual({
      activeId: 1,
      flushedUpToId: 0,
    });
  });

  it("leaves state unchanged when busy and below threshold", () => {
    const state: QueueState = { activeId: 1, flushedUpToId: 0 };
    // 3 pending behind active (ids 2,3,4) == threshold, not over it.
    expect(advanceQueue(msgs(1, 2, 3, 4), state)).toEqual(state);
  });

  it("fires the burst valve when pending exceeds the threshold", () => {
    const state: QueueState = { activeId: 1, flushedUpToId: 0 };
    // 4 pending behind active (ids 2,3,4,5) > BURST_THRESHOLD(3).
    const next = advanceQueue(msgs(1, 2, 3, 4, 5), state);
    expect(next.activeId).toBeNull();
    expect(next.flushedUpToId).toBe(5);
    expect(BURST_THRESHOLD).toBe(3);
  });

  it("only arms entries newer than the flush watermark after a burst", () => {
    // Everything up to id 5 was flushed; a new id 6 arrives.
    const state: QueueState = { activeId: null, flushedUpToId: 5 };
    expect(advanceQueue(msgs(1, 2, 3, 4, 5, 6), state)).toEqual({
      activeId: 6,
      flushedUpToId: 5,
    });
  });

  it("stays idle when all messages are already flushed", () => {
    const state: QueueState = { activeId: null, flushedUpToId: 5 };
    expect(advanceQueue(msgs(1, 2, 3, 4, 5), state)).toEqual(state);
  });
});

describe("typewriterQueue.completeActive", () => {
  it("advances to the next message", () => {
    const state: QueueState = { activeId: 1, flushedUpToId: 0 };
    expect(completeActive(msgs(1, 2, 3), 1, state).activeId).toBe(2);
  });

  it("goes idle after the last message", () => {
    const state: QueueState = { activeId: 3, flushedUpToId: 0 };
    expect(completeActive(msgs(1, 2, 3), 3, state).activeId).toBeNull();
  });

  it("skips entries flushed by the burst valve", () => {
    // active id 1 finishes but ids 2..5 were flushed; only id 6 should animate.
    const state: QueueState = { activeId: 1, flushedUpToId: 5 };
    expect(completeActive(msgs(1, 2, 3, 4, 5, 6), 1, state).activeId).toBe(6);
  });
});
