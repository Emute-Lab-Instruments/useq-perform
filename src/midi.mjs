import { WebMidi } from "webmidi";
import { serialMapFunctions } from "./serialComms.mjs";

/**
 * Sets up MIDI input/output devices
 */

export { setupMIDI, defSerialMap, midictrl };

function setupMIDI() {
  navigator.requestMIDIAccess().then((access) => {
    WebMidi
      .enable()
      .then(onEnabled)
      .catch(err => alert(err));
      
    function onEnabled() {
      // Log MIDI Inputs
      console.log("MIDI Inputs");
      WebMidi.inputs.forEach(input => console.log(input.manufacturer, input.name));
      
      // Log MIDI Outputs
      console.log("MIDI Outputs");
      WebMidi.outputs.forEach(output => console.log(output.manufacturer, output.name));
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

function defSerialMap(idx, func) {
  serialMapFunctions[idx] = func.bind({ midictrl: midictrl });
  console.log("added defserial", idx);
}

function midictrl(devIdx, chan, ctrlNum, val) {
  if (WebMidi.outputs[devIdx]) {
    WebMidi.outputs[devIdx].sendControlChange(ctrlNum, val, { channels: [chan] });
  }
}