import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getRuntimeSessionState,
  resetRuntimeSessionState,
  subscribeRuntimeSessionState,
  teardownRuntimeSessionState,
  updateRuntimeSessionState,
} from "./runtimeSessionStore";

afterEach(() => {
  teardownRuntimeSessionState();
});

describe("runtimeSessionStore", () => {
  // ── basic contract ───────────────────────────────────────────────

  it("returns default state before any updates", () => {
    const state = getRuntimeSessionState();
    expect(state.connected).toBe(false);
    expect(state.protocolMode).toBe("legacy");
    expect(state.session.transportMode).toBe("wasm");
  });

  it("returns a cloned snapshot (mutations do not leak)", () => {
    const a = getRuntimeSessionState();
    const b = getRuntimeSessionState();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(a.session).not.toBe(b.session);
  });

  it("updates state and returns a snapshot", () => {
    const result = updateRuntimeSessionState({ connected: true });
    expect(result.connected).toBe(true);
    expect(getRuntimeSessionState().connected).toBe(true);
  });

  it("merges partial updates without clobbering other fields", () => {
    updateRuntimeSessionState({ connected: true, protocolMode: "json" });
    updateRuntimeSessionState({ connected: false });
    const state = getRuntimeSessionState();
    expect(state.connected).toBe(false);
    expect(state.protocolMode).toBe("json");
  });

  it("resetRuntimeSessionState restores defaults and notifies", () => {
    const listener = vi.fn();
    updateRuntimeSessionState({ connected: true, protocolMode: "json" });
    subscribeRuntimeSessionState(listener);
    resetRuntimeSessionState();
    const state = getRuntimeSessionState();
    expect(state.connected).toBe(false);
    expect(state.protocolMode).toBe("legacy");
    expect(listener).toHaveBeenCalledOnce();
  });

  // ── subscribe / unsubscribe ──────────────────────────────────────

  it("notifies listeners on update", () => {
    const listener = vi.fn();
    subscribeRuntimeSessionState(listener);
    updateRuntimeSessionState({ connected: true });
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].connected).toBe(true);
  });

  it("notifies listeners on reset", () => {
    const listener = vi.fn();
    updateRuntimeSessionState({ connected: true });
    subscribeRuntimeSessionState(listener);
    resetRuntimeSessionState();
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].connected).toBe(false);
  });

  it("unsubscribe stops further notifications", () => {
    const listener = vi.fn();
    const unsub = subscribeRuntimeSessionState(listener);
    unsub();
    updateRuntimeSessionState({ connected: true });
    expect(listener).not.toHaveBeenCalled();
  });

  it("each listener receives its own snapshot object", () => {
    const snapshots: unknown[] = [];
    subscribeRuntimeSessionState((s) => snapshots.push(s));
    subscribeRuntimeSessionState((s) => snapshots.push(s));
    updateRuntimeSessionState({ connected: true });
    expect(snapshots).toHaveLength(2);
    // same values, but same snapshot reference (frozen before iteration)
    expect(snapshots[0]).toEqual(snapshots[1]);
  });

  // ── unsubscribe during iteration ─────────────────────────────────

  it("unsubscribing inside a listener does not affect other listeners in the same notification", () => {
    const order: string[] = [];
    let unsubB: () => void;

    subscribeRuntimeSessionState(() => {
      order.push("A");
      // A unsubscribes B during the same notification round
      unsubB();
    });

    unsubB = subscribeRuntimeSessionState(() => {
      order.push("B");
    });

    subscribeRuntimeSessionState(() => {
      order.push("C");
    });

    updateRuntimeSessionState({ connected: true });

    // B was unsubscribed by A, so B should NOT fire (guard checks listeners.has)
    expect(order).toEqual(["A", "C"]);

    // B stays unsubscribed on subsequent updates
    order.length = 0;
    updateRuntimeSessionState({ connected: false });
    expect(order).toEqual(["A", "C"]);
  });

  it("a listener can safely unsubscribe itself during notification", () => {
    const order: string[] = [];
    let unsubSelf: () => void;

    unsubSelf = subscribeRuntimeSessionState(() => {
      order.push("self");
      unsubSelf();
    });

    subscribeRuntimeSessionState(() => order.push("other"));

    updateRuntimeSessionState({ connected: true });
    expect(order).toEqual(["self", "other"]);

    // self-unsubscribed, only "other" fires next time
    order.length = 0;
    updateRuntimeSessionState({ connected: false });
    expect(order).toEqual(["other"]);
  });

  // ── re-entrant updates ──────────────────────────────────────────

  it("re-entrant updateRuntimeSessionState inside a listener does not cause infinite loops", () => {
    let calls = 0;

    subscribeRuntimeSessionState((state) => {
      calls++;
      // Only re-enter once to avoid infinite loop
      if (state.connected && !state.session.hasHardwareConnection) {
        updateRuntimeSessionState({ hasHardwareConnection: true });
      }
    });

    updateRuntimeSessionState({ connected: true });

    // First call triggers the listener, which re-enters with hasHardwareConnection.
    // The re-entrant call triggers a second notification round.
    expect(calls).toBe(2);

    // Final state reflects both updates
    const state = getRuntimeSessionState();
    expect(state.connected).toBe(true);
    expect(state.session.hasHardwareConnection).toBe(true);
  });

  it("re-entrant updates are visible to subsequent listeners in the outer round", () => {
    const observedHardware: boolean[] = [];

    // First listener re-enters
    subscribeRuntimeSessionState((state) => {
      if (state.connected && !state.session.hasHardwareConnection) {
        updateRuntimeSessionState({ hasHardwareConnection: true });
      }
    });

    // Second listener observes the snapshot that was frozen before iteration
    subscribeRuntimeSessionState((state) => {
      observedHardware.push(state.session.hasHardwareConnection);
    });

    updateRuntimeSessionState({ connected: true });

    // The outer round's snapshot was frozen before re-entrant update,
    // so the second listener sees the original (false).
    // The re-entrant update fires a new round where it sees true.
    expect(observedHardware).toContain(false);
    expect(observedHardware).toContain(true);
  });

  // ── multiple subscribers ─────────────────────────────────────────

  it("supports multiple independent subscriptions", () => {
    const a = vi.fn();
    const b = vi.fn();
    const unsubA = subscribeRuntimeSessionState(a);
    subscribeRuntimeSessionState(b);

    updateRuntimeSessionState({ connected: true });
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();

    unsubA();
    updateRuntimeSessionState({ connected: false });
    expect(a).toHaveBeenCalledOnce(); // no second call
    expect(b).toHaveBeenCalledTimes(2);
  });

  it("double-unsubscribe is a no-op", () => {
    const listener = vi.fn();
    const unsub = subscribeRuntimeSessionState(listener);
    unsub();
    unsub(); // should not throw
    updateRuntimeSessionState({ connected: true });
    expect(listener).not.toHaveBeenCalled();
  });
});
