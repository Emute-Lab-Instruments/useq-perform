import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getDiagnosticsSnapshot,
  getRuntimeDiagnostics,
  publishRuntimeDiagnostics,
  reportBootstrapFailure,
  resetRuntimeDiagnostics,
  seedBootstrapDiagnostics,
  publishDiagnosticsSnapshot,
  type RuntimeDiagnosticsSnapshot,
  type RuntimeBootstrapFailure,
} from "./runtimeDiagnostics";

import {
  runtimeDiagnostics as runtimeDiagnosticsChannel,
  bootstrapFailure as bootstrapFailureChannel,
} from "../contracts/runtimeChannels";

import {
  resetStartupContextForTests,
  applyStartupContext,
} from "./startupContext";

import {
  updateRuntimeSessionState,
  teardownRuntimeSessionState,
} from "./runtimeSessionStore";

describe("runtimeDiagnostics (derived)", () => {
  beforeEach(() => {
    resetRuntimeDiagnostics();
    resetStartupContextForTests();
    teardownRuntimeSessionState();
  });

  afterEach(() => {
    resetRuntimeDiagnostics();
    resetStartupContextForTests();
    teardownRuntimeSessionState();
  });

  it("derives environment from startupContext", () => {
    applyStartupContext({
      startupFlags: {
        debug: false,
        devmode: true,
        disableWebSerial: false,
        noModuleMode: false,
        nosave: false,
        params: { foo: "bar" },
      },
      capabilities: {
        areInBrowser: true,
        areInDesktopApp: false,
        isWebSerialAvailable: true,
      },
    });

    const snapshot = getDiagnosticsSnapshot();
    expect(snapshot.activeEnvironment).toEqual({
      areInBrowser: true,
      areInDesktopApp: false,
      isWebSerialAvailable: true,
      isInDevmode: true,
      urlParams: { foo: "bar" },
    });
  });

  it("derives runtimeSession from runtimeSessionStore", () => {
    updateRuntimeSessionState({
      hasHardwareConnection: true,
      noModuleMode: false,
      wasmEnabled: true,
      connected: true,
      protocolMode: "json",
    });

    const snapshot = getDiagnosticsSnapshot();
    expect(snapshot.protocolMode).toBe("json");
    expect(snapshot.runtimeSession.hasHardwareConnection).toBe(true);
    expect(snapshot.runtimeSession.transportMode).toBe("both");
  });

  it("publishes runtime diagnostics snapshots via typed channel", () => {
    const events: RuntimeDiagnosticsSnapshot[] = [];
    const unsub = runtimeDiagnosticsChannel.subscribe((detail) =>
      events.push(detail),
    );

    // Seed startup context
    resetStartupContextForTests();
    applyStartupContext({
      startupFlags: {
        debug: false,
        devmode: false,
        disableWebSerial: false,
        noModuleMode: false,
        nosave: false,
        params: { devmode: "false" },
      },
      capabilities: {
        areInBrowser: true,
        areInDesktopApp: false,
        isWebSerialAvailable: true,
      },
    });

    // Seed session store
    updateRuntimeSessionState({
      hasHardwareConnection: true,
      noModuleMode: false,
      wasmEnabled: true,
      connected: true,
      protocolMode: "json",
    });

    // Use the compat shim (as bootstrap.ts does)
    const snapshot = publishRuntimeDiagnostics({
      startupMode: "hardware",
      settingsSources: ["defaults", "local-storage"],
    });

    expect(snapshot.protocolMode).toBe("json");
    expect(events).toHaveLength(1);
    expect(getDiagnosticsSnapshot().settingsSources).toEqual([
      "defaults",
      "local-storage",
    ]);

    unsub();
  });

  it("records bootstrap failures in the derived diagnostics snapshot", () => {
    const failures: RuntimeBootstrapFailure[] = [];
    const unsub = bootstrapFailureChannel.subscribe((detail) =>
      failures.push(detail),
    );

    const failure = reportBootstrapFailure(
      "ui-adapter-import",
      new Error("failed to mount adapter"),
    );

    expect(failure).toEqual({
      scope: "ui-adapter-import",
      message: "failed to mount adapter",
    });
    expect(failures).toHaveLength(1);
    expect(getDiagnosticsSnapshot().bootstrapFailures).toContainEqual(failure);

    unsub();
  });

  it("getRuntimeDiagnostics is an alias for getDiagnosticsSnapshot", () => {
    expect(getRuntimeDiagnostics).toBe(getDiagnosticsSnapshot);
  });

  it("seedBootstrapDiagnostics sets startup mode and settings sources", () => {
    seedBootstrapDiagnostics({
      startupMode: "hardware",
      settingsSources: ["defaults", "url-config"],
    });

    const snapshot = getDiagnosticsSnapshot();
    expect(snapshot.startupMode).toBe("hardware");
    expect(snapshot.settingsSources).toEqual(["defaults", "url-config"]);
  });

  it("publishDiagnosticsSnapshot derives and emits", () => {
    const events: RuntimeDiagnosticsSnapshot[] = [];
    const unsub = runtimeDiagnosticsChannel.subscribe((detail) =>
      events.push(detail),
    );

    seedBootstrapDiagnostics({
      startupMode: "no-module",
      settingsSources: ["defaults"],
    });

    const snapshot = publishDiagnosticsSnapshot();
    expect(snapshot.startupMode).toBe("no-module");
    expect(events).toHaveLength(1);
    expect(events[0].startupMode).toBe("no-module");

    unsub();
  });

  it("reset clears bootstrap-only state", () => {
    seedBootstrapDiagnostics({
      startupMode: "hardware",
      settingsSources: ["defaults", "local-storage"],
    });
    reportBootstrapFailure("test", "oops");

    resetRuntimeDiagnostics();

    const snapshot = getDiagnosticsSnapshot();
    expect(snapshot.startupMode).toBe("browser-local");
    expect(snapshot.settingsSources).toEqual(["defaults"]);
    expect(snapshot.bootstrapFailures).toEqual([]);
  });
});
