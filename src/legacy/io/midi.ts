import { dbg } from "../utils.ts";
import { WebMidi } from "webmidi";
import { serialMapFunctions } from "./serialComms.ts";
import type { CircularBuffer } from "../utils/CircularBuffer.ts";

/**
 * Sets up MIDI input/output devices
 */
export function setupMIDI(): void {
  navigator.requestMIDIAccess().then((_access) => {
    WebMidi
      .enable()
      .then(onEnabled)
      .catch((err: unknown) => alert(err));

    function onEnabled(): void {
      // Log MIDI Inputs
      dbg("MIDI Inputs");
      WebMidi.inputs.forEach(input => dbg(input.manufacturer, input.name));

      // Log MIDI Outputs
      dbg("MIDI Outputs");
      WebMidi.outputs.forEach(output => dbg(output.manufacturer, output.name));
    }
  });
}

// MIDI control functions
serialMapFunctions[0] = (_buffer: CircularBuffer) => {
  // Example MIDI mapping function - can be activated via user code
  // if (WebMidi.outputs[0]) {
  //   WebMidi.outputs[0].sendControlChange(1, 1, {channels:[1]})
  // }
};

export function defSerialMap(idx: number, func: (...args: any[]) => any): void {
  serialMapFunctions[idx] = func.bind({ midictrl });
  dbg("added defserial", idx);
}

export function midictrl(devIdx: number, chan: number, ctrlNum: number, val: number): void {
  if (WebMidi.outputs[devIdx]) {
    WebMidi.outputs[devIdx].sendControlChange(ctrlNum, val, { channels: [chan] });
  }
}
