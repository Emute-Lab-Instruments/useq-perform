import { marked } from "marked";
import { CircularBuffer } from "./CircularBuffer.mjs";
import { Buffer } from 'buffer';

var consoleLines = []

export var serialport = null;
export var serialVars = { capture: false, captureFunc: null };

export function setSerialPort(newport) {
  serialport = newport;
}

export function getSerialPort() {
  return serialport;

}

export async function serialReader() {
  if (serialport) {
    console.log("reading...");
    let buffer = new Uint8Array(0);
    // let buffer = new ArrayBuffer(bufferSize);    
    if (serialport.readable && !serialport.readable.locked) {
      const reader = serialport.readable.getReader();
      let serialReadModes = { "ANY": 0, "TEXT": 1, "SERIALSTREAM": 2 };
      let serialReadMode = serialReadModes.ANY;
      try {
        while (true) {
          const { value, done } = await reader.read();
          // console.log("rcv...")
          if (done) {
            // |reader| has been canceled.
            break;
          }
          let byteArray = new Uint8Array(value.buffer);
          //if there's unconsumed data from the last read, then prepend to new data
          if (buffer.length > 0) {
            // console.log("prepending")
            // console.log(buffer.length)
            let newBuffer = new Uint8Array(buffer.length + byteArray.length);
            newBuffer.set(buffer);
            newBuffer.set(byteArray, buffer.length);
            byteArray = newBuffer;
          }
          // console.log("buf: " + byteArray.length)
          let processed = false;
          while (byteArray.length > 0) {
            //consume next val
            switch (serialReadMode) {
              case serialReadModes.ANY:
                {
                  // console.log(byteArray)
                  //look for start of message marker
                  if (byteArray[0] == 31) {
                    if (byteArray.length > 1) {
                      //check message type
                      if (byteArray[1] == 0) {
                        serialReadMode = serialReadModes.SERIALSTREAM;
                      } else {
                        serialReadMode = serialReadModes.TEXT;
                      }
                    } else {
                      //wait for more data
                      processed = true;

                    }
                  } else {
                    //no marker, so try to find message start
                    let found = false;
                    for (let i = 0; i < byteArray.length - 1; i++) {
                      if (byteArray[i] === 31) {
                        found = true;
                        byteArray = byteArray.slice(i);
                      }
                    }
                    if (!found) {
                      //lose data and wait for a message start
                      byteArray = byteArray.slice(byteArray.length);
                    }
                    //done for now, wait for more data
                    processed = true;

                  }
                  break;
                }
              case serialReadModes.TEXT:
                {
                  //find end of line?
                  let found = false;
                  for (let i = 2; i < byteArray.length - 1; i++) {
                    if (byteArray[i] === 13 && byteArray[i + 1] === 10) {
                      found = true;
                      let msg = new TextDecoder().decode(byteArray.slice(2, i));
                      console.log(msg);
                      if (serialVars.capture) {
                        console.log("captured");
                        console.log(serialVars);
                        serialVars.captureFunc(msg);
                        serialVars.capture = false;
                      } else {
                        if (msg != "") {
                          post("uSEQ: " + msg);
                        }
                      }
                      byteArray = byteArray.slice(i + 2);
                      console.log(byteArray);
                      serialReadMode = serialReadModes.ANY;
                    }
                  }
                  if (!found) {
                    processed = true;
                  }
                  break;
                }
              case serialReadModes.SERIALSTREAM:
                {
                  // console.log("serial stream")
                  if (byteArray.length < 11) {
                    //wait for more data incoming
                    processed = true;
                  } else {
                    //read channel
                    const channel = byteArray[2];
                    // console.log("ch: " + channel)
                    //decode double
                    const buf = Buffer.from(byteArray);
                    const val = buf.readDoubleLE(3);
                    serialBuffers[channel - 1].push(val);
                    if (serialMapFunctions[channel - 1]) {
                      serialMapFunctions[channel - 1](serialBuffers[channel - 1]);
                    }
                    // console.log(serialBuffers[channel - 1].last(0));


                    //trim data
                    byteArray = byteArray.slice(11);
                    serialReadMode = serialReadModes.ANY;
                  }
                  break;
                }
            } //switch
            if (processed) {
              break;
            }
          }
          //carry through any remainder to the next read
          buffer = byteArray;
          // console.log("consumed")
        }
      } catch (error) {
        reader.releaseLock();
        console.log(error);
      } finally {
        console.log("finally");
        reader.releaseLock();
        serialReader();
      }
    } else {
      console.log(serialport);
    }
  }
}

export function post(value) {
  console.log("post: " + value);
  consoleLines.push(marked.parse(value));
  if (consoleLines.length > 50) {
    consoleLines = consoleLines.slice(1);
  }
  $("#console").html(consoleLines.join(''));
  $('#console').scrollTop($('#console')[0].scrollHeight - $('#console')[0].clientHeight);
}


export function sendTouSEQ(code, capture = null) {
  code = code.replaceAll('\n', '');
  console.log(code);
  if (serialport && serialport.writable) {
    const writer = serialport.writable.getWriter();
    console.log("writing...");
    if (capture) {
      serialVars.capture = true;
      serialVars.captureFunc = capture;
    }
    writer.write(encoder.encode(code)).then(() => {
      writer.releaseLock();
      console.log("written");
    });
  } else {
    post("uSEQ not connected");
  }
}
export const encoder = new TextEncoder();
export var serialBuffers = [];
for (let i = 0; i < 8; i++) serialBuffers[i] = new CircularBuffer(100);
export var serialMapFunctions = [];

