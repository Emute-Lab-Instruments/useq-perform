import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { setWasmFailureModeSync, sendSetFailureMode, isJsonProtocolActive, getAppSettings } =
  vi.hoisted(() => ({
    setWasmFailureModeSync: vi.fn(() => true),
    sendSetFailureMode: vi.fn(() => Promise.resolve({ type: "response", success: true })),
    isJsonProtocolActive: vi.fn(() => true),
    getAppSettings: vi.fn(() => ({ runtime: { failureMode: "lkg" } })),
  }));

vi.mock("../runtime/wasmRuntimePort.ts", () => ({ setWasmFailureModeSync }));
vi.mock("../transport/index.ts", () => ({ sendSetFailureMode, isJsonProtocolActive }));
vi.mock("../runtime/appSettingsRepository.ts", () => ({ getAppSettings }));

import { settingsChanged } from "../contracts/runtimeChannels.ts";
import { initFailureModeSync, teardownFailureModeSync } from "./failureModeSync.ts";
import type { AppSettings } from "../lib/appSettings.ts";

const settingsWith = (failureMode: "lkg" | "zero") =>
  ({ runtime: { failureMode } }) as unknown as AppSettings;

describe("failureModeSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isJsonProtocolActive.mockReturnValue(true);
    initFailureModeSync();
  });

  afterEach(() => {
    teardownFailureModeSync();
  });

  it("pushes a changed failure mode to both runtimes", () => {
    settingsChanged.publish(settingsWith("zero"));
    expect(setWasmFailureModeSync).toHaveBeenCalledWith("zero");
    expect(sendSetFailureMode).toHaveBeenCalledWith("zero");
  });

  it("does not re-push an unchanged mode", () => {
    settingsChanged.publish(settingsWith("lkg"));
    expect(setWasmFailureModeSync).not.toHaveBeenCalled();
    expect(sendSetFailureMode).not.toHaveBeenCalled();
  });

  it("skips the serial send when the JSON protocol is inactive", () => {
    isJsonProtocolActive.mockReturnValue(false);
    settingsChanged.publish(settingsWith("zero"));
    expect(setWasmFailureModeSync).toHaveBeenCalledWith("zero");
    expect(sendSetFailureMode).not.toHaveBeenCalled();
  });
});
