import { describe, expect, it, vi } from "vitest";

import {
  ANIMATE_CONNECT_EVENT,
  assertRuntimeEventContract,
  BOOTSTRAP_FAILURE_EVENT,
  CODE_EVALUATED_EVENT,
  CONNECTION_CHANGED_EVENT,
  DEVICE_PLUGGED_IN_EVENT,
  JSON_META_EVENT,
  PROTOCOL_READY_EVENT,
  RUNTIME_DIAGNOSTICS_EVENT,
  RUNTIME_EVENT_NAMES,
  addRuntimeEventListener,
  dispatchRuntimeEvent,
} from "./runtimeEvents";

describe("runtimeEvents", () => {
  it("keeps runtime event names unique", () => {
    expect(new Set(RUNTIME_EVENT_NAMES).size).toBe(RUNTIME_EVENT_NAMES.length);
    expect(() => assertRuntimeEventContract()).not.toThrow();
  });

  it("dispatches typed runtime events with the expected detail", () => {
    const events: Array<{ type: string; detail: unknown }> = [];

    addRuntimeEventListener(CONNECTION_CHANGED_EVENT, (detail) => {
      events.push({ type: CONNECTION_CHANGED_EVENT, detail });
    });
    addRuntimeEventListener(PROTOCOL_READY_EVENT, (detail) => {
      events.push({ type: PROTOCOL_READY_EVENT, detail });
    });
    addRuntimeEventListener(JSON_META_EVENT, (detail) => {
      events.push({ type: JSON_META_EVENT, detail });
    });
    addRuntimeEventListener(RUNTIME_DIAGNOSTICS_EVENT, (detail) => {
      events.push({ type: RUNTIME_DIAGNOSTICS_EVENT, detail });
    });
    addRuntimeEventListener(BOOTSTRAP_FAILURE_EVENT, (detail) => {
      events.push({ type: BOOTSTRAP_FAILURE_EVENT, detail });
    });
    addRuntimeEventListener(CODE_EVALUATED_EVENT, (detail) => {
      events.push({ type: CODE_EVALUATED_EVENT, detail });
    });
    addRuntimeEventListener(ANIMATE_CONNECT_EVENT, (detail) => {
      events.push({ type: ANIMATE_CONNECT_EVENT, detail });
    });
    addRuntimeEventListener(DEVICE_PLUGGED_IN_EVENT, (detail) => {
      events.push({ type: DEVICE_PLUGGED_IN_EVENT, detail });
    });

    dispatchRuntimeEvent(CONNECTION_CHANGED_EVENT, {
      connected: true,
      protocolMode: "json",
      hasHardwareConnection: true,
      noModuleMode: false,
      wasmEnabled: true,
      connectionMode: "hardware",
      transportMode: "both",
    });
    dispatchRuntimeEvent(PROTOCOL_READY_EVENT, { protocolMode: "json" });
    dispatchRuntimeEvent(JSON_META_EVENT, {
      response: { meta: { transport: "playing" } },
    });
    dispatchRuntimeEvent(RUNTIME_DIAGNOSTICS_EVENT, {
      startupMode: "hardware",
      protocolMode: "json",
      settingsSources: ["defaults"],
      activeEnvironment: {
        areInBrowser: true,
        areInDesktopApp: false,
        isWebSerialAvailable: true,
        isInDevmode: false,
        urlParams: {},
      },
      runtimeSession: {
        hasHardwareConnection: true,
        noModuleMode: false,
        wasmEnabled: true,
        connectionMode: "hardware",
        transportMode: "both",
      },
      bootstrapFailures: [],
    });
    dispatchRuntimeEvent(BOOTSTRAP_FAILURE_EVENT, {
      scope: "serial",
      message: "timed out",
    });
    dispatchRuntimeEvent(CODE_EVALUATED_EVENT, { code: "(useq-play)" });
    dispatchRuntimeEvent(ANIMATE_CONNECT_EVENT, undefined);
    dispatchRuntimeEvent(DEVICE_PLUGGED_IN_EVENT, undefined);

    expect(events).toEqual([
      {
        type: CONNECTION_CHANGED_EVENT,
        detail: expect.objectContaining({ protocolMode: "json", connected: true }),
      },
      {
        type: PROTOCOL_READY_EVENT,
        detail: { protocolMode: "json" },
      },
      {
        type: JSON_META_EVENT,
        detail: { response: { meta: { transport: "playing" } } },
      },
      {
        type: RUNTIME_DIAGNOSTICS_EVENT,
        detail: expect.objectContaining({ startupMode: "hardware", protocolMode: "json" }),
      },
      {
        type: BOOTSTRAP_FAILURE_EVENT,
        detail: { scope: "serial", message: "timed out" },
      },
      {
        type: CODE_EVALUATED_EVENT,
        detail: { code: "(useq-play)" },
      },
      {
        type: ANIMATE_CONNECT_EVENT,
        detail: null,
      },
      {
        type: DEVICE_PLUGGED_IN_EVENT,
        detail: null,
      },
    ]);
  });

  it("returns a no-op listener remover when no target is available", () => {
    const remove = addRuntimeEventListener(
      CONNECTION_CHANGED_EVENT,
      vi.fn(),
      undefined
    );

    expect(remove).toBeTypeOf("function");
    expect(() => remove()).not.toThrow();
  });

  // -----------------------------------------------------------------------
  // Listener cleanup
  // -----------------------------------------------------------------------
  describe("listener cleanup", () => {
    it("unsubscribe stops further notifications", () => {
      const listener = vi.fn();
      const unsub = addRuntimeEventListener(CODE_EVALUATED_EVENT, listener);

      dispatchRuntimeEvent(CODE_EVALUATED_EVENT, { code: "(first)" });
      expect(listener).toHaveBeenCalledOnce();

      unsub();
      dispatchRuntimeEvent(CODE_EVALUATED_EVENT, { code: "(second)" });
      expect(listener).toHaveBeenCalledOnce(); // still 1 — no second call
    });

    it("double-unsubscribe is safe", () => {
      const listener = vi.fn();
      const unsub = addRuntimeEventListener(CODE_EVALUATED_EVENT, listener);
      unsub();
      expect(() => unsub()).not.toThrow();
    });

    it("unsubscribing one listener does not affect another on the same event", () => {
      const listenerA = vi.fn();
      const listenerB = vi.fn();
      const unsubA = addRuntimeEventListener(CODE_EVALUATED_EVENT, listenerA);
      addRuntimeEventListener(CODE_EVALUATED_EVENT, listenerB);

      unsubA();
      dispatchRuntimeEvent(CODE_EVALUATED_EVENT, { code: "(test)" });

      expect(listenerA).not.toHaveBeenCalled();
      expect(listenerB).toHaveBeenCalledOnce();
    });

    it("unsubscribing all listeners leaves dispatch functional (returns true)", () => {
      const listener = vi.fn();
      const unsub = addRuntimeEventListener(CODE_EVALUATED_EVENT, listener);
      unsub();

      // dispatchEvent returns true when no listener calls preventDefault
      const result = dispatchRuntimeEvent(CODE_EVALUATED_EVENT, { code: "(orphan)" });
      expect(result).toBe(true);
      expect(listener).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Dispatch without listeners
  // -----------------------------------------------------------------------
  describe("dispatch without listeners", () => {
    it("dispatching with no registered listeners does not throw", () => {
      expect(() =>
        dispatchRuntimeEvent(JSON_META_EVENT, { response: { meta: { x: 1 } } })
      ).not.toThrow();
    });

    it("dispatching with no registered listeners returns true", () => {
      const result = dispatchRuntimeEvent(ANIMATE_CONNECT_EVENT, undefined);
      expect(result).toBe(true);
    });

    it("dispatching with a target that lacks dispatchEvent returns false", () => {
      const result = dispatchRuntimeEvent(
        CODE_EVALUATED_EVENT,
        { code: "(nope)" },
        {} as any
      );
      expect(result).toBe(false);
    });

    it("dispatching with a custom target works", () => {
      const received: unknown[] = [];
      const fakeTarget = {
        dispatchEvent: vi.fn((event: Event) => {
          received.push((event as CustomEvent).detail);
          return true;
        }),
      };

      const result = dispatchRuntimeEvent(
        CODE_EVALUATED_EVENT,
        { code: "(custom)" },
        fakeTarget
      );

      expect(result).toBe(true);
      expect(fakeTarget.dispatchEvent).toHaveBeenCalledOnce();
      expect(received[0]).toEqual({ code: "(custom)" });
    });
  });

  // -----------------------------------------------------------------------
  // Multiple listeners
  // -----------------------------------------------------------------------
  describe("multiple listeners", () => {
    it("multiple listeners on the same event all receive the detail", () => {
      const calls: string[] = [];
      addRuntimeEventListener(CODE_EVALUATED_EVENT, (detail) => {
        calls.push(`A:${detail.code}`);
      });
      addRuntimeEventListener(CODE_EVALUATED_EVENT, (detail) => {
        calls.push(`B:${detail.code}`);
      });

      dispatchRuntimeEvent(CODE_EVALUATED_EVENT, { code: "(go)" });

      expect(calls).toEqual(["A:(go)", "B:(go)"]);
    });

    it("listeners on different events do not cross-fire", () => {
      const codeCalls = vi.fn();
      const metaCalls = vi.fn();

      addRuntimeEventListener(CODE_EVALUATED_EVENT, codeCalls);
      addRuntimeEventListener(JSON_META_EVENT, metaCalls);

      dispatchRuntimeEvent(CODE_EVALUATED_EVENT, { code: "(x)" });

      expect(codeCalls).toHaveBeenCalledOnce();
      expect(metaCalls).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Listener receives both detail and raw event
  // -----------------------------------------------------------------------
  describe("listener arguments", () => {
    it("listener receives detail as first arg and CustomEvent as second", () => {
      let receivedDetail: unknown = null;
      let receivedEvent: Event | null = null;

      addRuntimeEventListener(CODE_EVALUATED_EVENT, (detail, event) => {
        receivedDetail = detail;
        receivedEvent = event;
      });

      dispatchRuntimeEvent(CODE_EVALUATED_EVENT, { code: "(args)" });

      expect(receivedDetail).toEqual({ code: "(args)" });
      expect(receivedEvent).toBeInstanceOf(CustomEvent);
      expect((receivedEvent as CustomEvent).type).toBe(CODE_EVALUATED_EVENT);
    });
  });

  // -----------------------------------------------------------------------
  // addRuntimeEventListener with custom target
  // -----------------------------------------------------------------------
  describe("custom target for listeners", () => {
    it("listener attaches to and removes from a custom target", () => {
      const listeners = new Map<string, Set<Function>>();
      const fakeTarget = {
        addEventListener: vi.fn((name: string, fn: Function) => {
          if (!listeners.has(name)) listeners.set(name, new Set());
          listeners.get(name)!.add(fn);
        }),
        removeEventListener: vi.fn((name: string, fn: Function) => {
          listeners.get(name)?.delete(fn);
        }),
      };

      const handler = vi.fn();
      const unsub = addRuntimeEventListener(
        CODE_EVALUATED_EVENT,
        handler,
        fakeTarget
      );

      expect(fakeTarget.addEventListener).toHaveBeenCalledOnce();
      expect(fakeTarget.addEventListener.mock.calls[0][0]).toBe(CODE_EVALUATED_EVENT);

      unsub();
      expect(fakeTarget.removeEventListener).toHaveBeenCalledOnce();
      expect(fakeTarget.removeEventListener.mock.calls[0][0]).toBe(CODE_EVALUATED_EVENT);
      // The same wrapped function should be used for both add and remove
      expect(fakeTarget.addEventListener.mock.calls[0][1]).toBe(
        fakeTarget.removeEventListener.mock.calls[0][1]
      );
    });
  });
});
