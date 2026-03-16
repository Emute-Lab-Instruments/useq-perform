import { describe, it, expect, vi } from "vitest";
import { createChannel } from "./typedChannel";

describe("createChannel", () => {
  it("delivers published values to subscribers", () => {
    const ch = createChannel<{ x: number }>();
    const listener = vi.fn();

    ch.subscribe(listener);
    ch.publish({ x: 42 });

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith({ x: 42 });
  });

  it("supports multiple subscribers", () => {
    const ch = createChannel<string>();
    const a = vi.fn();
    const b = vi.fn();

    ch.subscribe(a);
    ch.subscribe(b);
    ch.publish("hello");

    expect(a).toHaveBeenCalledWith("hello");
    expect(b).toHaveBeenCalledWith("hello");
  });

  it("unsubscribe removes only that listener", () => {
    const ch = createChannel<number>();
    const kept = vi.fn();
    const removed = vi.fn();

    ch.subscribe(kept);
    const unsub = ch.subscribe(removed);

    unsub();
    ch.publish(1);

    expect(kept).toHaveBeenCalledOnce();
    expect(removed).not.toHaveBeenCalled();
  });

  it("does nothing when publishing with no subscribers", () => {
    const ch = createChannel<void>();
    // Should not throw
    ch.publish(undefined);
  });

  it("double unsubscribe is safe", () => {
    const ch = createChannel<number>();
    const unsub = ch.subscribe(() => {});
    unsub();
    unsub(); // should not throw
  });
});
