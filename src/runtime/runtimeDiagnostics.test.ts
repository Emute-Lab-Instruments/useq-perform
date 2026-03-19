import { beforeEach, describe, expect, it } from "vitest";

import {
  getRuntimeDiagnostics,
  publishRuntimeDiagnostics,
  reportBootstrapFailure,
  resetRuntimeDiagnostics,
  type RuntimeDiagnosticsSnapshot,
  type RuntimeBootstrapFailure,
} from "./runtimeDiagnostics";

import {
  runtimeDiagnostics as runtimeDiagnosticsChannel,
  bootstrapFailure as bootstrapFailureChannel,
} from "../contracts/runtimeChannels";

describe("runtimeDiagnostics", () => {
  beforeEach(() => {
    resetRuntimeDiagnostics();
  });

  it("publishes runtime diagnostics snapshots via typed channel", () => {
    const events: RuntimeDiagnosticsSnapshot[] = [];
    const unsub = runtimeDiagnosticsChannel.subscribe((detail) => events.push(detail));

    const snapshot = publishRuntimeDiagnostics({
      startupMode: "hardware",
      protocolMode: "json",
      settingsSources: ["defaults", "local-storage"],
      activeEnvironment: {
        areInBrowser: true,
        areInDesktopApp: false,
        isWebSerialAvailable: true,
        isInDevmode: false,
        urlParams: { devmode: "false" },
      },
      runtimeSession: {
        hasHardwareConnection: true,
        noModuleMode: false,
        wasmEnabled: true,
        connectionMode: "hardware",
        transportMode: "both",
      },
    });

    expect(snapshot.protocolMode).toBe("json");
    expect(events).toHaveLength(1);
    expect(getRuntimeDiagnostics().settingsSources).toEqual([
      "defaults",
      "local-storage",
    ]);

    unsub();
  });

  it("records bootstrap failures in the published diagnostics stream", () => {
    const failures: RuntimeBootstrapFailure[] = [];
    const unsub = bootstrapFailureChannel.subscribe((detail) => failures.push(detail));

    const failure = reportBootstrapFailure(
      "ui-adapter-import",
      new Error("failed to mount adapter")
    );

    expect(failure).toEqual({
      scope: "ui-adapter-import",
      message: "failed to mount adapter",
    });
    expect(failures).toHaveLength(1);
    expect(getRuntimeDiagnostics().bootstrapFailures).toContainEqual(failure);

    unsub();
  });
});
