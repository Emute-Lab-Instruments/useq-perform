import { dbg } from "../utils.mjs";
import { WebMidi } from "webmidi";
import { serialMapFunctions } from "./serialComms.mjs";

/**
 * Sets up MIDI input/output devices
 */
export function setupMIDI() {
  navigator.requestMIDIAccess().then((access) => {
    WebMidi
      .enable()
      .then(onEnabled)
      .catch(err => alert(err));
      
    function onEnabled() {
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
serialMapFunctions[0] = (buffer) => {
  // Example MIDI mapping function - can be activated via user code
  // if (WebMidi.outputs[0]) {
  //   WebMidi.outputs[0].sendControlChange(1, 1, {channels:[1]})
  // }
}

export function defSerialMap(idx, func) {
  serialMapFunctions[idx] = func.bind({ midictrl });
  dbg("added defserial", idx);
}

export function midictrl(devIdx, chan, ctrlNum, val) {
  if (WebMidi.outputs[devIdx]) {
    WebMidi.outputs[devIdx].sendControlChange(ctrlNum, val, { channels: [chan] });
  }
}