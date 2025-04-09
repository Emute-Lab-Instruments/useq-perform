/**
 * Serial Communication Module
 *
 * Handles communication with the uSEQ device via Web Serial API
 * including message parsing, sending commands, and managing the serial buffer.
 */
import { CircularBuffer } from "../utils/CircularBuffer.mjs";
import { Buffer } from "buffer";
import { post } from "./console.mjs";
import { upgradeCheck } from "../utils/upgradeCheck.mjs";
import { dbg } from "../utils.mjs";
import {
  setCodeHighlightColor,
  smoothingSettings,
  applySmoothing,
  applyInterpolation,
  createPreviousValuesArray
} from "./utils.mjs";


export async function toggleConnect() {
  if (isConnectedToModule()) {
    disconnect();
  } else {
    const savedport = await checkForSavedPort();
    console.log("Saved port", savedport);
    if (savedport) {
      post("**Info**: Connecting to saved port...");
      connectToSerialPort(savedport);
    }
    else {
      // If no saved port is found, ask for a new connection
      askForPortAndConnect();
    }
  }
}

export function askForPortAndConnect() {
  if (!isConnectedToModule()) {
    navigator.serial.requestPort()
      .then((port) => {
        connectToSerialPort(port);
      })
      .catch((err) => {
        console.log("Error requesting port:", err);
        post("Error requesting port. Please try again.");
      });
  }
  else {
    post('uSEQ is already connected - would you like to <span style="color: red; font-weight: bold; cursor: pointer;" onclick="disconnect()">disconnect</span>?');
  }
}


let connectedToModule = false;
setConnectedToModule(false);

export function setConnectedToModule(connected) {
  connectedToModule = connected;

  // Update code highlight color
  setCodeHighlightColor(connected);
  // Make sure the DOM is ready before modifying the 'connect' button
  setTimeout(() => {
    const $button = $("#button-connect");
    if ($button.length) {
      $button.removeClass("plugged-in");
      
      if (connected) {
        $button.removeClass("disconnected").addClass("connected");
      } else {
        $button.removeClass("connected").addClass("disconnected");
      }
    } else {
      console.log("Button not found when trying to set color!");
    }
  }, 0);
}

export function isConnectedToModule() {
  return connectedToModule;
}

// Define variables first before exporting them
var serialport = null;
var serialVars = { capture: false, captureFunc: null };
const encoder = new TextEncoder();
const serialBuffers = Array.from({ length: 8 }, () => new CircularBuffer(400));

// Add reader reference that can be accessed globally
let currentReader = null;
let readingActive = false;

// Arrays to store previous values for smoothing
const previousValues = createPreviousValuesArray(8);

const serialMapFunctions = [];

// Export everything at once to avoid duplication
export {
  serialport,
  serialVars,
  encoder,
  serialBuffers,
  serialMapFunctions,
  setSerialPort,
  getSerialPort,
  sendTouSEQ,
  serialReader,
  connectToSerialPort,
  smoothingSettings,
  readingActive,
};

// Constants
const SERIAL_READ_MODES = {
  ANY: 0,
  TEXT: 1,
  SERIALSTREAM: 2,
};

const MESSAGE_START_MARKER = 31;
const MESSAGE_TYPES = {
  STREAM: 0,
  // Any value other than 0 is treated as TEXT
};

// Console output storage
const consoleLines = [];
const MAX_CONSOLE_LINES = 50;

/**
 * Set the active serial port
 * @param {SerialPort} newport - The Web Serial port to use
 */
function setSerialPort(newport) {
  serialport = newport;
  const portInfo = newport.getInfo();
  localStorage.setItem("uSEQ-Serial-Port-Info", JSON.stringify(portInfo));
}


async function checkForSavedPort() {
  dbg("Checking for saved port...");
  // Retrieve saved port information from localStorage
  const savedInfo = JSON.parse(localStorage.getItem("uSEQ-Serial-Port-Info") || "null");

  if (savedInfo) {
    // Get the list of available serial ports
    const ports = await navigator.serial.getPorts();
    dbg("Ports", ports);

    // Find a port that matches the saved information
    const matchingPort = ports.find((port) => {
      const info = port.getInfo();
      return (
        info.usbVendorId === savedInfo.usbVendorId &&
        info.usbProductId === savedInfo.usbProductId
      );
    });

    if (matchingPort) {
      return matchingPort;
    }
  } else {
    return null;
  }
}


/**
 * Check for a previously saved serial port and attempt to reconnect automatically
 * @returns {Promise<SerialPort|null>} The matching saved port if found, otherwise null
 */
export async function checkForSavedPortAndMaybeConnect() {
  let savedPort = await checkForSavedPort();
  if (savedPort) {
    post("**Info**: Found a saved port, connecting automatically...");
    connectToSerialPort(savedPort);
    return savedPort;
  }
  else {
    dbg("No saved port information found");
    // No saved port information or no matching port found
    post('It looks like you haven\'t connected to uSEQ before (or you have cleared your cookies). Click the <span style="color: var(--accent-color); font-weight: bold; display: inline;">[connect]</span> button to link to uSEQ - you will only have to do this once.');
    return null;
  }
}

/**
 * Get the current serial port
 * @returns {SerialPort|null} The current Web Serial port or null
 */
function getSerialPort() {
  return serialport;
}

/**
 * Send code to the uSEQ device
 * @param {string} code - Code to send
 * @param {Function|null} capture - Optional callback for response capture
 */
function sendTouSEQ(code, capture = null) {
  // Remove comments (anything between ; and newline) and all newlines in a single step
  code = code.replace(/;[^\n]*(\n|$)|\n/g, (match) =>
    match.startsWith(";") ? "" : ""
  );

  if (serialport && serialport.writable) {
    const writer = serialport.writable.getWriter();
    dbg("writing...");

    if (capture) {
      serialVars.capture = true;
      serialVars.captureFunc = capture;
    }

    writer.write(encoder.encode(code)).then(() => {
      writer.releaseLock();
      dbg("written");
    });
  } else {
    post("**Info**: uSEQ not connected yet");
    // Add attention-grabbing animation to connect button
    $("#button-connect")
      .animate({ scale: 1.2 }, 200)
      .animate({ scale: 1 }, 200)
      .animate({ rotate: "-3deg" }, 100)
      .animate({ rotate: "3deg" }, 100)
      .animate({ rotate: "0deg" }, 100);
  }
}



/**
 * Process data received from serial port
 * @param {Uint8Array} byteArray - The bytes to process
 * @param {Object} state - Current processing state
 * @returns {Object} Updated processing state
 */
function processSerialData(byteArray, state) {
  let { mode, processed, remainingBytes } = state;

  switch (mode) {
    case SERIAL_READ_MODES.ANY:
      if (byteArray[0] === MESSAGE_START_MARKER) {
        if (byteArray.length > 1) {
          // Check message type
          mode =
            byteArray[1] === MESSAGE_TYPES.STREAM
              ? SERIAL_READ_MODES.SERIALSTREAM
              : SERIAL_READ_MODES.TEXT;
        } else {
          // Not enough data yet, wait for more
          processed = true;
        }
      } else {
        // No marker, search for message start
        const startIndex = byteArray.findIndex(
          (byte, i) => i < byteArray.length - 1 && byte === MESSAGE_START_MARKER
        );

        if (startIndex >= 0) {
          // Found message start, keep from here onwards
          remainingBytes = byteArray.slice(startIndex);
        } else {
          // Nothing useful, discard everything
          remainingBytes = new Uint8Array(0);
        }
        processed = true;
      }
      break;

    case SERIAL_READ_MODES.TEXT:
      // Find end of line (CR+LF)
      for (let i = 2; i < byteArray.length - 1; i++) {
        if (byteArray[i] === 13 && byteArray[i + 1] === 10) {
          // Extract message text
          const msg = new TextDecoder().decode(byteArray.slice(2, i));

          if (serialVars.capture) {
            dbg("Serial vars captured");
            serialVars.captureFunc(msg);
            serialVars.capture = false;
          } else if (msg !== "") {
            post("uSEQ: " + msg);
          }

          // Move to next bytes and reset mode
          remainingBytes = byteArray.slice(i + 2);
          mode = SERIAL_READ_MODES.ANY;
          return { mode, processed: false, remainingBytes };
        }
      }
      processed = true;
      break;

    case SERIAL_READ_MODES.SERIALSTREAM:
      if (byteArray.length < 11) {
        // Not enough data yet
        processed = true;
      } else {
        // Read channel and value
        const channel = byteArray[2];
        const buf = Buffer.from(byteArray);
        const val = buf.readDoubleLE(3);

        // Store value in circular buffer for that channel
        const bufferIndex = channel - 1;
        if (bufferIndex >= 0 && bufferIndex < serialBuffers.length) {
          // Apply smoothing to the incoming value
          const smoothedValue = applySmoothing(previousValues, bufferIndex, val);

          // Get previous value for interpolation (if any)
          const buffer = serialBuffers[bufferIndex];
          const previousValue =
            buffer.length > 0 ? buffer.last(0) : smoothedValue;

          // Apply interpolation between previous and current value
          if (smoothingSettings.interpolationEnabled && buffer.length > 0) {
            applyInterpolation(
              bufferIndex,
              previousValue,
              smoothedValue,
              serialBuffers,
              bufferIndex
            );
          }

          // Push the final smoothed value to the buffer
          buffer.push(smoothedValue);

          // Call any registered handler function
          if (serialMapFunctions[bufferIndex]) {
            serialMapFunctions[bufferIndex](serialBuffers[bufferIndex]);
          }
        }

        // Move to next data
        remainingBytes = byteArray.slice(11);
        mode = SERIAL_READ_MODES.ANY;
        return { mode, processed: false, remainingBytes };
      }
      break;
  }

  return { mode, processed, remainingBytes };
}

/**
 * Start reading from the serial port
 */
async function serialReader() {
  if (!serialport) return;
  dbg("reading...");

  let buffer = new Uint8Array(0);

  // Check if port is readable and not locked
  if (serialport.readable && !serialport.readable.locked) {
    const reader = serialport.readable.getReader();
    currentReader = reader;
    readingActive = true;

    try {
      while (readingActive) {
        const { value, done } = await reader.read();

        if (done) {
          // Reader has been canceled
          break;
        }

        let byteArray = new Uint8Array(value.buffer);

        // If there's unconsumed data from the last read, prepend to new data
        if (buffer.length > 0) {
          let newBuffer = new Uint8Array(buffer.length + byteArray.length);
          newBuffer.set(buffer);
          newBuffer.set(byteArray, buffer.length);
          byteArray = newBuffer;
        }

        // Process all complete messages in the byte array
        let state = {
          mode: SERIAL_READ_MODES.ANY,
          processed: false,
          remainingBytes: byteArray,
        };

        while (state.remainingBytes.length > 0 && !state.processed) {
          state = processSerialData(state.remainingBytes, state);
        }

        // Save any remaining bytes for the next read
        buffer = state.remainingBytes;
      }
    } catch (error) {
      console.log("Serial read error:", error);
    } finally {
      readingActive = false;
      currentReader = null;
      reader.releaseLock();
    }
  } else {
    console.log("Serial port is not readable or is locked");
  }
}

/**
 * Safely stops the serial reader by cancelling the read operation
 * @returns {Promise<void>}
 */
async function stopSerialReader() {
  if (currentReader) {
    readingActive = false;
    try {
      await currentReader.cancel();
      // Lock will be released in the finally block of serialReader
    } catch (err) {
      console.log("Error cancelling reader:", err);
    }
  }
}

async function disconnect(port) {
  if (!port) {
    port = serialport;
  }

  if (port) {
    // First stop any active reader to properly release the lock
    if (port === serialport && readingActive) {
      await stopSerialReader();
    }

    // Now we can safely close the port
    try {
      if (port.readable || port.writable) {
        await port.close();

        // If the port we closed was the main module port
        if (port === serialport) {
          setConnectedToModule(false);
          post("**Info**: uSEQ disconnected");
        }
      }
    } catch (err) {
      console.log("Error closing port:", err);
      // Even if there's an error, we should update UI state
      if (port === serialport) {
        setConnectedToModule(false);
        post("**Warning**: uSEQ disconnected with errors\n" + err);
      }
    }
  }
}

/**
 * Connect to the serial port for uSEQ communication
 * @returns {Promise<boolean>} Promise resolving to true on success, false on failure
 */



function connectToSerialPort(port) {
  return port
    .open({ baudRate: 115200 })
    .then(async () => {
      setConnectedToModule(true);
      setSerialPort(port);
      serialReader();
      // FIXME In case we just updated the firmware, give the interpreter some time to boot before communication
      await new Promise(resolve => setTimeout(resolve, 3500));
      sendTouSEQ("@(useq-report-firmware-info)", upgradeCheck);
      return true;
    })
    .catch((err) => {
      console.log("Error connecting to serial:", err);
      //connection failed
      post(
        'Connection failed. See <a href="https://www.emutelabinstruments.co.uk/useqinfo/useq-editor/#troubleshooting">https://www.emutelabinstruments.co.uk/useqinfo/useq-editor/#troubleshooting</a>'
      );
      return false;
    });
}

export function checkForWebserialSupport() {
  console.log("Checking for Web Serial API support...");
  // Check for Web Serial API support
  if (!navigator.serial) {
    post(
      "A Web Serial compatible browser such as Chrome, Edge or Opera is required, for connection to the uSEQ module"
    );
    post("See https://caniuse.com/web-serial for more information");
    return false;
  } else {
    console.log("Web Serial API supported");
    // Set up serial connection event listeners
    navigator.serial.addEventListener("connect", (e) => {
      console.log(e);
      let port = getSerialPort();
      if (port) {
        $("#button-connect").removeClass("connected").removeClass("disconnected").addClass("plugged-in");
        toggleConnect();
        // post(`uSEQ is plugged in but not connected yet, use the <span style="color: var(--accent-color); font-weight: bold; display: inline;">[connect]</span> button to re-connect.`);
      }
    });

    navigator.serial.addEventListener("disconnect", (e) => {
      setConnectedToModule(false);
      if (!flag_triggeringBootloader) {
        post("**Info**: uSEQ disconnected");
      }
    });
    return true;
  }
}


let flag_triggeringBootloader = false;

export async function enterBootloaderMode(port) {
  flag_triggeringBootloader = true;

  if (!port) {
    port = serialport;
  }

  try {
    // If we're triggering bootloader mode on a port that is already open
    // we need to close it first, as we need to open it with 1200 baud instead
    if (port && (port.readable || port.writable)) {
      await disconnect(port);
    }

    // Reopen at 1200 baud - this is a common technique to trigger bootloader mode
    post("Putting uSEQ into bootloader mode...");
    await port.open({ baudRate: 1200 });
    
    // Close immediately after opening at 1200 baud
    await port.close();
    
    // Wait for the device to restart in bootloader mode
    post("Waiting for device to reappear as a USB drive...");
    await new Promise(resolve => setTimeout(resolve, 1000));
  } catch (error) {
    console.error("Error entering bootloader mode:", error);
    post(`Error entering bootloader mode: ${error.message}`);
  } finally {
    flag_triggeringBootloader = false;
  }
  
  return true;
}

window.enterBootloaderMode = enterBootloaderMode;