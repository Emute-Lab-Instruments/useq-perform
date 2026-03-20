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
  connectionChanged,
  protocolReady,
  jsonMeta,
  runtimeDiagnostics,
  bootstrapFailure,
  codeEvaluated,
  animateConnect,
  devicePluggedIn,
} from "./runtimeChannels";

describe("runtimeEvents", () => {
  it("keeps runtime event names unique", () => {
    expect(new Set(RUNTIME_EVENT_NAMES).size).toBe(RUNTIME_EVENT_NAMES.length);
    expect(() => assertRuntimeEventContract()).not.toThrow();
  });
});

describe("runtimeChannels", () => {
  it("publishes typed runtime events with the expected detail", () => {
    const events: Array<{ type: string; detail: unknown }> = [];

    const unsubs = [
      connectionChanged.subscribe((detail) => {
        events.push({ type: CONNECTION_CHANGED_EVENT, detail });
      }),
      protocolReady.subscribe((detail) => {
        events.push({ type: PROTOCOL_READY_EVENT, detail });
      }),
      jsonMeta.subscribe((detail) => {
        events.push({ type: JSON_META_EVENT, detail });
      }),
      runtimeDiagnostics.subscribe((detail) => {
        events.push({ type: RUNTIME_DIAGNOSTICS_EVENT, detail });
      }),
      bootstrapFailure.subscribe((detail) => {
        events.push({ type: BOOTSTRAP_FAILURE_EVENT, detail });
      }),
      codeEvaluated.subscribe((detail) => {
        events.push({ type: CODE_EVALUATED_EVENT, detail });
      }),
      animateConnect.subscribe((detail) => {
        events.push({ type: ANIMATE_CONNECT_EVENT, detail });
      }),
      devicePluggedIn.subscribe((detail) => {
        events.push({ type: DEVICE_PLUGGED_IN_EVENT, detail });
      }),
    ];

    connectionChanged.publish({
      connected: true,
      protocolMode: "json",
      hasHardwareConnection: true,
      noModuleMode: false,
      wasmEnabled: true,
      connectionMode: "hardware",
      transportMode: "both",
    });
    protocolReady.publish({ protocolMode: "json" });
    jsonMeta.publish({
      response: { meta: { transport: "playing" } },
    });
    runtimeDiagnostics.publish({
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
    bootstrapFailure.publish({
      scope: "serial",
      message: "timed out",
    });
    codeEvaluated.publish({ code: "(useq-play)" });
    animateConnect.publish(undefined);
    devicePluggedIn.publish(undefined);

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
        detail: undefined,
      },
      {
        type: DEVICE_PLUGGED_IN_EVENT,
        detail: undefined,
      },
    ]);

    unsubs.forEach((unsub) => unsub());
  });

  // -----------------------------------------------------------------------
  // Listener cleanup
  // -----------------------------------------------------------------------
  describe("listener cleanup", () => {
    it("unsubscribe stops further notifications", () => {
      const listener = vi.fn();
      const unsub = codeEvaluated.subscribe(listener);

      codeEvaluated.publish({ code: "(first)" });
      expect(listener).toHaveBeenCalledOnce();

      unsub();
      codeEvaluated.publish({ code: "(second)" });
      expect(listener).toHaveBeenCalledOnce(); // still 1 — no second call
    });

    it("double-unsubscribe is safe", () => {
      const listener = vi.fn();
      const unsub = codeEvaluated.subscribe(listener);
      unsub();
      expect(() => unsub()).not.toThrow();
    });

    it("unsubscribing one listener does not affect another on the same event", () => {
      const listenerA = vi.fn();
      const listenerB = vi.fn();
      const unsubA = codeEvaluated.subscribe(listenerA);
      const _unsubB = codeEvaluated.subscribe(listenerB);

      unsubA();
      codeEvaluated.publish({ code: "(test)" });

      expect(listenerA).not.toHaveBeenCalled();
      expect(listenerB).toHaveBeenCalledOnce();

      _unsubB();
    });

    it("publishing with no subscribers does not throw", () => {
      const listener = vi.fn();
      const unsub = codeEvaluated.subscribe(listener);
      unsub();

      expect(() => codeEvaluated.publish({ code: "(orphan)" })).not.toThrow();
      expect(listener).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Publish without listeners
  // -----------------------------------------------------------------------
  describe("publish without listeners", () => {
    it("publishing with no registered listeners does not throw", () => {
      expect(() =>
        jsonMeta.publish({ response: { meta: { x: 1 } } })
      ).not.toThrow();
    });

    it("publishing undefined-detail channels does not throw", () => {
      expect(() => animateConnect.publish(undefined)).not.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // Multiple listeners
  // -----------------------------------------------------------------------
  describe("multiple listeners", () => {
    it("multiple listeners on the same channel all receive the detail", () => {
      const calls: string[] = [];
      const unsubA = codeEvaluated.subscribe((detail) => {
        calls.push(`A:${detail.code}`);
      });
      const unsubB = codeEvaluated.subscribe((detail) => {
        calls.push(`B:${detail.code}`);
      });

      codeEvaluated.publish({ code: "(go)" });

      expect(calls).toEqual(["A:(go)", "B:(go)"]);

      unsubA();
      unsubB();
    });

    it("listeners on different channels do not cross-fire", () => {
      const codeCalls = vi.fn();
      const metaCalls = vi.fn();

      const unsubCode = codeEvaluated.subscribe(codeCalls);
      const unsubMeta = jsonMeta.subscribe(metaCalls);

      codeEvaluated.publish({ code: "(x)" });

      expect(codeCalls).toHaveBeenCalledOnce();
      expect(metaCalls).not.toHaveBeenCalled();

      unsubCode();
      unsubMeta();
    });
  });

  // -----------------------------------------------------------------------
  // Listener receives detail directly
  // -----------------------------------------------------------------------
  describe("listener arguments", () => {
    it("listener receives detail as the only argument", () => {
      let receivedDetail: unknown = null;

      const unsub = codeEvaluated.subscribe((detail) => {
        receivedDetail = detail;
      });

      codeEvaluated.publish({ code: "(args)" });

      expect(receivedDetail).toEqual({ code: "(args)" });

      unsub();
    });
  });
});
