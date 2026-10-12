import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { runtimeDiagnostics as runtimeDiagnosticsChannel } from "../../contracts/runtimeChannels.ts";
import type { RuntimeDiagnosticsSnapshot } from "../../runtime/runtimeDiagnostics.ts";
import { setDevmodeOverride } from "./devmodeContext";
import { RuntimeDiagnosticsSettings } from "./RuntimeDiagnosticsSettings";

afterEach(() => {
  cleanup();
  setDevmodeOverride(null);
});

describe("RuntimeDiagnosticsSettings", () => {
  it("renders and follows diagnostic snapshots in devmode", async () => {
    setDevmodeOverride(true);
    render(() => <RuntimeDiagnosticsSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Runtime diagnostics" }));

    const snapshot: RuntimeDiagnosticsSnapshot = {
      startupMode: "hardware",
      protocolMode: "json",
      settingsSources: ["url-config"],
      activeEnvironment: {
        areInBrowser: true,
        areInDesktopApp: false,
        isWebSerialAvailable: true,
        isInDevmode: true,
        urlParams: { devmode: "true" },
      },
      runtimeSession: {
        hasHardwareConnection: true,
        noModuleMode: false,
        wasmEnabled: false,
        connectionMode: "hardware",
        transportMode: "hardware",
      },
      bootstrapFailures: [],
    };
    runtimeDiagnosticsChannel.publish(snapshot);

    expect(await screen.findByText(/"startupMode": "hardware"/)).toBeTruthy();
    expect(screen.getByText(/"settingsSources": \[/)).toBeTruthy();
  });
});
