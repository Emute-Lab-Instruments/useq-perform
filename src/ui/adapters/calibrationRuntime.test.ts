import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({ connected: true, json: true, sequencer: null as null | { state: { phase: string }; pickOutput: (id: string, mode: "fresh") => Promise<void> } }));
vi.mock("../../transport/index.ts", () => ({
  isConnectedToModule: () => harness.connected,
  isJsonProtocolActive: () => harness.json,
  sendCalibrateBegin: vi.fn(async () => ({ success: true })),
  sendCalibrateSetTarget: vi.fn(async () => ({ success: true })),
  sendCalibrateAdjust: vi.fn(async () => ({ success: true })),
  sendCalibrateSavePoint: vi.fn(async () => ({ success: true })),
  sendCalibrateEnd: vi.fn(async () => ({ success: true })),
}));
vi.mock("./calibration.tsx", () => ({
  wireCalibrationSequencer: (seq: typeof harness.sequencer) => { harness.sequencer = seq; },
  unwireCalibrationSequencer: vi.fn(),
}));

import { sendCalibrateBegin, sendCalibrateSetTarget } from "../../transport/index.ts";
import { beginCalibration } from "./calibrationRuntime.ts";

describe("production calibration entry wiring", () => {
  beforeEach(() => {
    harness.connected = true;
    harness.json = true;
    harness.sequencer = null;
  });

  it("opens the picker and carries the selected output through the sequencer transport", async () => {
    expect(beginCalibration()).toBe(true);
    expect(harness.sequencer?.state.phase).toBe("picking");
    await harness.sequencer?.pickOutput("a1", "fresh");
    expect(sendCalibrateBegin).toHaveBeenCalledWith("a1");
    expect(sendCalibrateSetTarget).toHaveBeenCalledWith("a1", 0);
  });

  it("does not open while a JSON hardware connection is unavailable", () => {
    harness.connected = false;
    expect(beginCalibration()).toBe(false);
    expect(harness.sequencer).toBeNull();
    harness.connected = true;
  });
});
