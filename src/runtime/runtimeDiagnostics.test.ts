import { beforeEach, describe, expect, it } from "vitest";

import {
  getRuntimeDiagnostics,
  publishRuntimeDiagnostics,
  reportBootstrapFailure,
  resetRuntimeDiagnostics,
} from "./runtimeDiagnostics";

describe("runtimeDiagnostics", () => {
  beforeEach(() => {
    resetRuntimeDiagnostics();
  });

  it("publishes runtime diagnostics snapshots as browser events", () => {
    const events: Event[] = [];
    window.addEventListener("useq-runtime-diagnostics", (event) => events.push(event));

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
  });

  it("records bootstrap failures in the published diagnostics stream", () => {
    const failures: Event[] = [];
    window.addEventListener("useq-bootstrap-failure", (event) => failures.push(event));

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
  });
});
