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
  cleanCode,
  combineBuffers,
  findMessageStartMarker,
  updateRemainingBytes,
  extractMessageText,
  isSerialPortValid,
  isPortReadableAndUnlocked,
  isPortWritable
} from "./utils.mjs";

/**
 * Toggle the connection state - disconnect if connected, connect if disconnected
 * Tries to use a saved port before requesting a new one
 */
export async function toggleConnect() {
  if (isConnectedToModule()) {
    disconnect();
  } else {
    await tryConnectWithSavedPortOrAsk();
  }
}

/**
 * Try to connect with a saved port or ask for a new one
 * @returns {Promise<void>}
 */
async function tryConnectWithSavedPortOrAsk() {
  const savedport = await checkForSavedPort();
  console.log("Saved port", savedport);
  
  if (savedport) {
    connectToSavedPort(savedport);
  } else {
    // If no saved port is found, ask for a new connection
    askForPortAndConnect();
  }
}

/**
 * Connect to a previously saved port
 * @param {SerialPort} savedport - The saved port to connect to
 */
function connectToSavedPort(savedport) {
  post("**Info**: Connecting to saved port...");
  connectToSerialPort(savedport);
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
  return savedPort ? 
    handleFoundSavedPort(savedPort) : 
    handleNoSavedPort();
}

/**
 * Handle the case when a saved port is found
 * @param {SerialPort} savedPort - The saved port that was found
 * @returns {SerialPort} The saved port
 */
function handleFoundSavedPort(savedPort) {
  post("**Info**: Found a saved port, connecting automatically...");
  connectToSerialPort(savedPort);
  return savedPort;
}

/**
 * Handle the case when no saved port is found
 * @returns {null}
 */
function handleNoSavedPort() {
  dbg("No saved port information found");
  displayConnectInstructions();
  return null;
}

/**
 * Display instructions for connecting to uSEQ for the first time
 */
function displayConnectInstructions() {
  post('It looks like you haven\'t connected to uSEQ before (or you have cleared your cookies). Click the <span style="color: var(--accent-color); font-weight: bold; display: inline;">[connect]</span> button to link to uSEQ - you will only have to do this once.');
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
  const cleanedCode = cleanCode(code);

  if (isPortWritable(serialport)) {
    sendToPort(cleanedCode, capture);
  } else {
    handleNotConnected();
  }
}

/**
 * Send code to the serial port
 * @param {string} code - The code to send
 * @param {Function|null} capture - Optional callback for response capture
 */
function sendToPort(code, capture) {
  const writer = serialport.writable.getWriter();
  dbg("writing...");

  if (capture) {
    setupCapture(capture);
  }

  writeCodeAndRelease(writer, code);
}

/**
 * Set up the capture function for response
 * @param {Function} captureFunc - The capture callback
 */
function setupCapture(captureFunc) {
  serialVars.capture = true;
  serialVars.captureFunc = captureFunc;
}

/**
 * Write code to the writer and release the lock when done
 * @param {WritableStreamDefaultWriter} writer - The writer to use
 * @param {string} code - The code to write
 */
function writeCodeAndRelease(writer, code) {
  writer.write(encoder.encode(code)).then(() => {
    writer.releaseLock();
    dbg("written");
  });
}

/**
 * Handle the case when uSEQ is not connected
 */
function handleNotConnected() {
  post("**Warning**: uSEQ not connected yet - make sure it's ");
  // Add attention-grabbing animation to connect button
  animateConnectButton();
}

/**
 * Animate the connect button to draw attention
 */
function animateConnectButton() {
  $("#button-connect")
    .animate({ scale: 1.2 }, 200)
    .animate({ scale: 1 }, 200)
    .animate({ rotate: "-3deg" }, 100)
    .animate({ rotate: "3deg" }, 100)
    .animate({ rotate: "0deg" }, 100);
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
      return processAnyModeData(byteArray);
    case SERIAL_READ_MODES.TEXT:
      return processTextModeData(byteArray);
    case SERIAL_READ_MODES.SERIALSTREAM:
      return processStreamModeData(byteArray);
  }

  return { mode, processed, remainingBytes };
}

/**
 * Process data in ANY mode to determine message type
 * @param {Uint8Array} byteArray - The bytes to process
 * @returns {Object} Updated processing state
 */
function processAnyModeData(byteArray) {
  let mode = SERIAL_READ_MODES.ANY;
  let processed = false;
  let remainingBytes = byteArray;

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
    const startIndex = findMessageStartMarker(byteArray, MESSAGE_START_MARKER);
    remainingBytes = updateRemainingBytes(byteArray, startIndex);
    processed = true;
  }

  return { mode, processed, remainingBytes };
}



/**
 * Process data in TEXT mode
 * @param {Uint8Array} byteArray - The bytes to process
 * @returns {Object} Updated processing state
 */
function processTextModeData(byteArray) {
  // Find end of line (CR+LF)
  for (let i = 2; i < byteArray.length - 1; i++) {
    if (byteArray[i] === 13 && byteArray[i + 1] === 10) {
      // Extract and process message text
      const msg = extractAndHandleTextMessage(byteArray.slice(2, i));

      // Move to next bytes and reset mode
      const remainingBytes = byteArray.slice(i + 2);
      return { 
        mode: SERIAL_READ_MODES.ANY, 
        processed: false, 
        remainingBytes 
      };
    }
  }
  
  return { 
    mode: SERIAL_READ_MODES.TEXT, 
    processed: true, 
    remainingBytes: byteArray 
  };
}

/**
 * Extract and handle text message from serial data
 * @param {Uint8Array} messageBytes - Message bytes without markers
 * @returns {string} The decoded message
 */
function extractAndHandleTextMessage(messageBytes) {
  const msg = extractMessageText(messageBytes);

  if (serialVars.capture) {
    dbg("Serial vars captured");
    serialVars.captureFunc(msg);
    serialVars.capture = false;
  } else if (msg !== "") {
    post("uSEQ: " + msg);
  }
  
  return msg;
}

/**
 * Process data in SERIALSTREAM mode
 * @param {Uint8Array} byteArray - The bytes to process
 * @returns {Object} Updated processing state
 */
function processStreamModeData(byteArray) {
  if (byteArray.length < 11) {
    // Not enough data yet
    return {
      mode: SERIAL_READ_MODES.SERIALSTREAM,
      processed: true,
      remainingBytes: byteArray
    };
  }
  
  // Process stream data and update buffers
  processSerialStreamValue(byteArray);
  
  // Move to next data
  const remainingBytes = byteArray.slice(11);
  return {
    mode: SERIAL_READ_MODES.ANY,
    processed: false,
    remainingBytes
  };
}

/**
 * Process a serial stream value and update the appropriate buffer
 * @param {Uint8Array} byteArray - The byte array containing the stream data
 */
function processSerialStreamValue(byteArray) {
  const channel = byteArray[2];
  const buf = Buffer.from(byteArray);
  const val = buf.readDoubleLE(3);

  // Store value in circular buffer for that channel
  const bufferIndex = channel - 1;
  if (bufferIndex >= 0 && bufferIndex < serialBuffers.length) {
    updateSerialBuffer(bufferIndex, val);
  }
}

/**
 * Update a serial buffer with a new value and call any registered handlers
 * @param {number} bufferIndex - The index of the buffer to update
 * @param {number} value - The value to add to the buffer
 */
function updateSerialBuffer(bufferIndex, value) {
  const buffer = serialBuffers[bufferIndex];
  // Push the final smoothed value to the buffer
  buffer.push(value);

  // Call any registered handler function
  if (serialMapFunctions[bufferIndex]) {
    serialMapFunctions[bufferIndex](buffer);
  }
}

/**
 * Start reading from the serial port
 */
async function serialReader() {
  if (!isSerialPortValid(serialport)) return;
  dbg("reading...");

  let buffer = new Uint8Array(0);

  // Check if port is readable and not locked
  if (isPortReadableAndUnlocked(serialport)) {
    buffer = await setupReaderAndProcessData(buffer);
  } else {
    console.log("Serial port is not readable or is locked");
  }
}



/**
 * Set up the reader and process incoming data
 * @param {Uint8Array} initialBuffer - Initial buffer with any leftover data
 * @returns {Promise<Uint8Array>} Promise resolving to the final buffer state
 */
async function setupReaderAndProcessData(initialBuffer) {
  let buffer = initialBuffer;
  const reader = serialport.readable.getReader();
  currentReader = reader;
  readingActive = true;

  try {
    buffer = await processSerialDataLoop(reader, buffer);
  } catch (error) {
    console.log("Serial read error:", error);
  } finally {
    cleanupReader(reader);
  }
  
  return buffer;
}

/**
 * Process serial data in a continuous loop until stopped
 * @param {ReadableStreamDefaultReader} reader - The serial port reader
 * @param {Uint8Array} buffer - Initial buffer with any leftover data
 * @returns {Promise<Uint8Array>} Promise resolving to the final buffer state
 */
async function processSerialDataLoop(reader, buffer) {
  while (readingActive) {
    const readResult = await reader.read();
    
    if (readResult.done) {
      // Reader has been canceled
      break;
    }
    
    const byteArray = combineBuffers(buffer, new Uint8Array(readResult.value.buffer));
    const state = processAllMessages(byteArray);
    
    // Save any remaining bytes for the next read
    buffer = state.remainingBytes;
  }
  
  return buffer;
}



/**
 * Process all complete messages in a byte array
 * @param {Uint8Array} byteArray - The byte array to process
 * @returns {Object} The final processing state
 */
function processAllMessages(byteArray) {
  let state = {
    mode: SERIAL_READ_MODES.ANY,
    processed: false,
    remainingBytes: byteArray,
  };

  while (state.remainingBytes.length > 0 && !state.processed) {
    state = processSerialData(state.remainingBytes, state);
  }
  
  return state;
}

/**
 * Clean up the reader resources
 * @param {ReadableStreamDefaultReader} reader - The reader to clean up
 */
function cleanupReader(reader) {
  readingActive = false;
  currentReader = null;
  reader.releaseLock();
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
  return openSerialConnection(port)
    .then(async () => {
      await setupConnectedPort(port);
      return true;
    })
    .catch((err) => {
      handleConnectionError(err);
      return false;
    });
}

/**
 * Open a serial connection with the specified baud rate
 * @param {SerialPort} port - The port to open
 * @returns {Promise} Promise that resolves when port is opened
 */
function openSerialConnection(port) {
  return port.open({ baudRate: 115200 });
}

/**
 * Set up the port after a successful connection
 * @param {SerialPort} port - The connected port
 * @returns {Promise<void>} Promise that resolves when setup is complete
 */
async function setupConnectedPort(port) {
  setConnectedToModule(true);
  setSerialPort(port);
  serialReader();
  
  // FIXME In case we just updated the firmware, give the interpreter some time to boot before communication
  await waitForInterpreterBoot();
  sendTouSEQ("@(useq-report-firmware-info)", upgradeCheck);
}

/**
 * Wait for interpreter to boot after firmware update
 * @returns {Promise<void>} Promise that resolves after waiting
 */
function waitForInterpreterBoot() {
  return new Promise(resolve => setTimeout(resolve, 3500));
}

/**
 * Handle errors during serial connection
 * @param {Error} err - The connection error
 */
function handleConnectionError(err) {
  console.log("Error connecting to serial:", err);
  //connection failed
  post(
    'Connection failed. See <a href="https://www.emutelabinstruments.co.uk/useqinfo/useq-editor/#troubleshooting">https://www.emutelabinstruments.co.uk/useqinfo/useq-editor/#troubleshooting</a>'
  );
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