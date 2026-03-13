import { describe, it, expect, vi } from "vitest";
import { createRoot } from "solid-js";
import { Effect } from "effect";
import { useActorSignal } from "./useActorSignal";
import { effectResource } from "./effectResource";

// ---------------------------------------------------------------------------
// Helper: create a mock object that satisfies the AnyActorRef shape
// ---------------------------------------------------------------------------
function createMockActor(initialSnapshot: any) {
  let subscriber: ((snap: any) => void) | null = null;
  const unsubscribe = vi.fn();
  return {
    actor: {
      getSnapshot: vi.fn(() => initialSnapshot),
      subscribe: vi.fn((fn: any) => {
        subscriber = fn;
        return { unsubscribe };
      }),
      send: vi.fn(),
    },
    /** Simulate the actor emitting a new snapshot to its subscriber */
    emit(snap: any) {
      subscriber?.(snap);
    },
    unsubscribe,
  };
}

// ===========================================================================
// useActorSignal
// ===========================================================================
describe("useActorSignal", () => {
  it("returns the initial snapshot from the actor", () => {
    const { actor } = createMockActor({ count: 0 });

    createRoot((dispose) => {
      const { state } = useActorSignal(actor as any);
      expect(state()).toEqual({ count: 0 });
      dispose();
    });
  });

  it("updates the signal when the actor emits a new snapshot", () => {
    const mock = createMockActor({ value: "initial" });

    createRoot((dispose) => {
      const { state } = useActorSignal(mock.actor as any);
      expect(state()).toEqual({ value: "initial" });

      // Simulate actor state change
      mock.emit({ value: "updated" });
      expect(state()).toEqual({ value: "updated" });

      dispose();
    });
  });

  it("send delegates to the actor's send method", () => {
    const { actor } = createMockActor("idle");

    createRoot((dispose) => {
      const { send } = useActorSignal(actor as any);
      expect(send).toBe(actor.send);

      send({ type: "TOGGLE" });
      expect(actor.send).toHaveBeenCalledWith({ type: "TOGGLE" });

      dispose();
    });
  });

  it("calls unsubscribe on cleanup", () => {
    const mock = createMockActor("idle");

    createRoot((dispose) => {
      useActorSignal(mock.actor as any);
      expect(mock.unsubscribe).not.toHaveBeenCalled();

      dispose();
    });

    // After dispose, the onCleanup callback should have fired
    expect(mock.unsubscribe).toHaveBeenCalledOnce();
  });

  it("subscribes to the actor exactly once", () => {
    const { actor } = createMockActor(null);

    createRoot((dispose) => {
      useActorSignal(actor as any);
      expect(actor.subscribe).toHaveBeenCalledOnce();
      dispose();
    });
  });

  // -----------------------------------------------------------------------
  // Emit after dispose (cleanup timing)
  // -----------------------------------------------------------------------
  it("emit after dispose does not update the signal (subscription was cleaned up)", () => {
    // Use a mock that respects unsubscribe — stops forwarding after unsub
    let subscriber: ((snap: any) => void) | null = null;
    const unsubscribe = vi.fn(() => {
      subscriber = null;
    });
    const actor = {
      getSnapshot: vi.fn(() => "initial"),
      subscribe: vi.fn((fn: any) => {
        subscriber = fn;
        return { unsubscribe };
      }),
      send: vi.fn(),
    };

    let readState: (() => any) | null = null;

    createRoot((dispose) => {
      const { state } = useActorSignal(actor as any);
      readState = state;

      // Emit while alive — signal updates
      subscriber?.("alive");
      expect(state()).toBe("alive");

      dispose();
    });

    // After dispose, unsubscribe was called, subscriber is null
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(subscriber).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Multiple consumers sharing one actor
  // -----------------------------------------------------------------------
  it("multiple useActorSignal calls on the same actor get independent signals", () => {
    const mock = createMockActor({ count: 0 });
    // Override subscribe to support multiple subscribers
    const subscribers: Array<(snap: any) => void> = [];
    mock.actor.subscribe = vi.fn((fn: any) => {
      subscribers.push(fn);
      return {
        unsubscribe: vi.fn(() => {
          const idx = subscribers.indexOf(fn);
          if (idx >= 0) subscribers.splice(idx, 1);
        }),
      };
    }) as any;

    createRoot((dispose) => {
      const a = useActorSignal(mock.actor as any);
      const b = useActorSignal(mock.actor as any);

      expect(mock.actor.subscribe).toHaveBeenCalledTimes(2);

      // Both start with the same initial snapshot
      expect(a.state()).toEqual({ count: 0 });
      expect(b.state()).toEqual({ count: 0 });

      // Emit to all subscribers
      const newSnap = { count: 1 };
      for (const sub of subscribers) sub(newSnap);

      // Both see the update
      expect(a.state()).toEqual({ count: 1 });
      expect(b.state()).toEqual({ count: 1 });

      dispose();
    });

    // Both unsubscribed
    expect(subscribers).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Rapid emissions
  // -----------------------------------------------------------------------
  it("rapid emissions always settle on the latest snapshot", () => {
    const mock = createMockActor(0);

    createRoot((dispose) => {
      const { state } = useActorSignal(mock.actor as any);

      for (let i = 1; i <= 100; i++) {
        mock.emit(i);
      }

      expect(state()).toBe(100);
      dispose();
    });
  });

  // -----------------------------------------------------------------------
  // Subscription object without unsubscribe (optional chaining guard)
  // -----------------------------------------------------------------------
  it("handles subscription object where unsubscribe is undefined", () => {
    const actor = {
      getSnapshot: vi.fn(() => "ok"),
      subscribe: vi.fn(() => ({
        // unsubscribe intentionally missing
      })),
      send: vi.fn(),
    };

    createRoot((dispose) => {
      const { state } = useActorSignal(actor as any);
      expect(state()).toBe("ok");

      // dispose should not throw even though unsubscribe is undefined
      expect(() => dispose()).not.toThrow();
    });
  });
});

// ===========================================================================
// effectResource
// ===========================================================================
describe("effectResource", () => {
  it("resolves with the value when the Effect succeeds", async () => {
    const eff = Effect.succeed(42);

    let resource: any;
    createRoot((dispose) => {
      const [res] = effectResource(eff);
      resource = res;
      dispose();
    });

    // Effect.runPromise is async, so wait for microtasks to flush
    await vi.waitFor(() => {
      expect(resource()).toBe(42);
    });
  });

  it("resolves with complex values", async () => {
    const data = { items: [1, 2, 3], name: "test" };
    const eff = Effect.succeed(data);

    let resource: any;
    createRoot((dispose) => {
      const [res] = effectResource(eff);
      resource = res;
      dispose();
    });

    await vi.waitFor(() => {
      expect(resource()).toEqual(data);
    });
  });

  it("resource is initially undefined before resolving", () => {
    // Use a deferred effect that won't resolve immediately
    const eff = Effect.promise(
      () => new Promise<string>((resolve) => setTimeout(() => resolve("later"), 1000)),
    );

    createRoot((dispose) => {
      const [resource] = effectResource(eff);
      // Before async resolution, the resource value should be undefined
      expect(resource()).toBeUndefined();
      dispose();
    });
  });

  it("returns a refetch function in the tuple", () => {
    const eff = Effect.succeed("ok");

    createRoot((dispose) => {
      const result = effectResource(eff);
      const [, actions] = result;
      expect(actions).toBeDefined();
      expect(typeof actions.refetch).toBe("function");
      dispose();
    });
  });
});
