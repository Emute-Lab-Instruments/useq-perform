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
});
