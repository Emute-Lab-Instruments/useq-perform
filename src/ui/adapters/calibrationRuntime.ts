/** Production transport and lifetime for the calibration takeover UI. */
import type { CalibrationOutput } from "../../contracts/hardware.ts";
import { isConnectedToModule, isJsonProtocolActive, sendCalibrateAdjust, sendCalibrateBegin, sendCalibrateEnd, sendCalibrateSavePoint, sendCalibrateSetTarget } from "../../transport/index.ts";
import { createCalibrationSequencer } from "../../effects/calibrationSequencer.ts";
import { wireCalibrationSequencer, unwireCalibrationSequencer } from "./calibration.tsx";

const outputs: CalibrationOutput[] = ["a1", "a2", "a3", "a4"].map((id) => ({
  id,
  status: { kind: "uncalibrated" },
}));

function assertAccepted(response: { success?: boolean; text?: string }): void {
  if (response.success === false) throw new Error(response.text ?? "Calibration is not supported by this firmware.");
}

const sequencer = createCalibrationSequencer({
  async calibrateBegin(output) { assertAccepted(await sendCalibrateBegin(output)); },
  async calibrateSetTarget(output, voltage) { assertAccepted(await sendCalibrateSetTarget(output, voltage)); },
  async calibrateAdjust(output, delta) {
    const response = await sendCalibrateAdjust(output, delta);
    assertAccepted(response);
    return undefined;
  },
  async calibrateSavePoint(output, octave) { assertAccepted(await sendCalibrateSavePoint(output, octave)); },
  async calibrateEnd(commit) { assertAccepted(await sendCalibrateEnd(commit)); },
});

/** Open the calibration picker when a connected JSON-protocol device is ready. */
export function beginCalibration(): boolean {
  if (!isConnectedToModule() || !isJsonProtocolActive()) return false;
  wireCalibrationSequencer(sequencer);
  sequencer.openPicker(outputs);
  return true;
}

export function handleCalibrationDisconnect(): void {
  sequencer.handleDisconnect();
  unwireCalibrationSequencer();
}
