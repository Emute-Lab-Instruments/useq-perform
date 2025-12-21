/**
 * Serial Communication Module
 *
 * Handles communication with the uSEQ device via Web Serial API
 * including message parsing, sending commands, and managing the serial buffer.
 */
import { CircularBuffer } from "../utils/CircularBuffer.mjs";
import { Buffer } from "buffer";
import { post } from "./console.mjs";
import { upgradeCheck, currentVersion } from "../utils/upgradeCheck.mjs";
import { dbg } from "../utils.mjs";
import { handleExternalTimeUpdate } from "../ui/serialVis/visualisationController.mjs";
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
    post('uSEQ is already connected - would you like to <span class="disconnect-link" style="color: red; font-weight: bold; cursor: pointer;">disconnect</span>?');
    // Add event listener for the disconnect link after DOM update
    setTimeout(() => {
      const disconnectLinks = document.querySelectorAll('.disconnect-link');
      disconnectLinks.forEach(link => {
        // Remove any existing listeners to avoid duplicates
        link.replaceWith(link.cloneNode(true));
      });
      // Get fresh references after cloning
      const freshLinks = document.querySelectorAll('.disconnect-link');
      freshLinks.forEach(link => {
        link.addEventListener('click', () => {
          disconnect();
        });
      });
    }, 0);
  }
}


let connectedToModule = false;

export function setConnectedToModule(connected) {
  connectedToModule = connected;

  if (!connected) {
    resetProtocolState();
  }

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
    // Notify other UI components about connection status changes
    try {
      window.dispatchEvent(new CustomEvent('useq-connection-changed', { detail: { connected } }));
    } catch (e) {
      // no-op if window not available
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
const serialBuffers = Array.from({ length: 9 }, () => new CircularBuffer(400));

// Add reader reference that can be accessed globally
let currentReader = null;
let readingActive = false;

const serialMapFunctions = [];

const PROTOCOL_MODES = {
  LEGACY: 'legacy',
  JSON: 'json'
};

const protocolState = {
  mode: PROTOCOL_MODES.LEGACY,
  negotiationAttempted: false,
  requestIdCounter: 0,
  pendingRequests: new Map(),
  ioConfig: null,
  heartbeatInterval: null,
};

const JSON_PROTOCOL_MIN_VERSION = { major: 1, minor: 2, patch: 0 };
const EDITOR_VERSION = '1.2.0';
const HEARTBEAT_INTERVAL_MS = 60000;
const HEARTBEAT_TIMEOUT_MS = 10000;

function resetProtocolState() {
  protocolState.pendingRequests.forEach((pending) => {
    if (pending && typeof pending.reject === 'function') {
      pending.reject(new Error('Connection reset'));
    }
  });
  protocolState.mode = PROTOCOL_MODES.LEGACY;
  protocolState.negotiationAttempted = false;
  protocolState.requestIdCounter = 0;
  protocolState.pendingRequests.clear();
  protocolState.ioConfig = null;
  stopHeartbeat();
}

function startHeartbeat() {
  if (protocolState.heartbeatInterval) {
    return;
  }

  protocolState.heartbeatInterval = setInterval(async () => {
    if (protocolState.mode !== PROTOCOL_MODES.JSON || !serialport?.writable) {
      stopHeartbeat();
      return;
    }

    // Avoid interfering with in-flight requests (firmware buffers console output per active request).
    if (protocolState.pendingRequests.size > 0) {
      return;
    }

    try {
      await writeJsonRequest(
        { type: 'ping' },
        { skipConsole: true, timeout: HEARTBEAT_TIMEOUT_MS }
      );
    } catch (err) {
      console.warn('Heartbeat failed:', err);
      post('**Warning**: Heartbeat timeout - connection may be lost. Reconnect if needed.');
      stopHeartbeat();
    }
  }, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat() {
  if (protocolState.heartbeatInterval) {
    clearInterval(protocolState.heartbeatInterval);
    protocolState.heartbeatInterval = null;
  }
}

function versionAtLeast(version, target) {
  if (!version) {
    return false;
  }

  if (version.major !== target.major) {
    return version.major > target.major;
  }

  if (version.minor !== target.minor) {
    return version.minor > target.minor;
  }

  return version.patch >= target.patch;
}

function jsonEligibleVersion() {
  return versionAtLeast(currentVersion, JSON_PROTOCOL_MIN_VERSION);
}

function nextRequestId() {
  protocolState.requestIdCounter += 1;
  return `req-${protocolState.requestIdCounter}`;
}

// Initialise connection-dependent UI state after protocol state is ready
setConnectedToModule(false);

function dispatchProtocolReady() {
  try {
    if (typeof window !== 'undefined' && window.dispatchEvent) {
      window.dispatchEvent(new CustomEvent('useq-protocol-ready'));
    }
  } catch (e) {
    console.warn('Failed to dispatch useq-protocol-ready', e);
  }
}

async function maybeNegotiateJsonProtocol() {
  if (protocolState.negotiationAttempted) {
    return;
  }

  if (!jsonEligibleVersion()) {
    protocolState.negotiationAttempted = true;
    dispatchProtocolReady();
    return;
  }

  protocolState.negotiationAttempted = true;

  try {
    const helloPayload = {
      type: 'hello',
      client: 'editor',
      version: EDITOR_VERSION,
    };

    const response = await writeJsonRequest(helloPayload, {
      skipConsole: true,
      timeout: 5000,
    });

    if (response.success && response.mode === 'json') {
      protocolState.mode = PROTOCOL_MODES.JSON;
      if (response.config) {
        protocolState.ioConfig = response.config;
        sendDefaultStreamConfig(response.config);
      }
      post(`**Info**: Using structured JSON protocol (fw: ${response.fw || 'unknown'}).`);
      startHeartbeat();
    } else {
      post(`**Warning**: JSON negotiation failed (${response.text || 'no details'}), using legacy mode.`);
    }
  } catch (err) {
    console.error('JSON negotiation error', err);
    post('**Warning**: Unable to switch to JSON protocol, staying in legacy mode.');
  } finally {
    dispatchProtocolReady();
  }
}

const DEFAULT_STREAM_MAX_RATE_HZ = 30;

function buildDefaultStreamConfig(ioConfig) {
  const channels = [];

  if (ioConfig?.inputs) {
    for (const input of ioConfig.inputs) {
      channels.push({
        id: input.index,
        name: input.name,
        enabled: true,
        maxRateHz: DEFAULT_STREAM_MAX_RATE_HZ,
      });
    }
  }

  return {
    type: 'stream-config',
    maxRateHz: DEFAULT_STREAM_MAX_RATE_HZ,
    channels,
  };
}

async function sendDefaultStreamConfig(ioConfig) {
  if (!ioConfig) {
    return;
  }

  try {
    const config = buildDefaultStreamConfig(ioConfig);
    await writeJsonRequest(config, { skipConsole: true, timeout: 5000 });
    dbg('Stream config sent:', config);
  } catch (err) {
    console.warn('Failed to send stream config:', err);
  }
}

export async function sendStreamConfig(channels, maxRateHz = DEFAULT_STREAM_MAX_RATE_HZ) {
  if (protocolState.mode !== PROTOCOL_MODES.JSON) {
    return Promise.reject(new Error('JSON protocol not active'));
  }

  const payload = {
    type: 'stream-config',
    maxRateHz,
    channels,
  };

  return writeJsonRequest(payload, { skipConsole: true, timeout: 5000 });
}

/**
 * Send a serial input stream update to the module (host -> device).
 *
 * Wire format (10 bytes):
 *   [0x1F][channel: uint8][value: float64 little-endian]
 *
 * Channel numbering is 1-based to align with firmware `(ssin N)` where N ∈ [1, NUM_SERIAL_INS].
 *
 * This is out-of-band (does not use JSON requests) and is safe to send while JSON protocol is active.
 */
export async function sendSerialInputStreamValue(channel, value) {
  const ch = Number(channel);
  const val = Number(value);

  if (!Number.isFinite(ch) || ch < 1 || ch > 255) {
    return Promise.reject(new Error(`Invalid stream channel: ${channel}`));
  }
  if (!Number.isFinite(val)) {
    return Promise.reject(new Error(`Invalid stream value: ${value}`));
  }

  // Dev mode: allow callers to update UI/WASM without requiring hardware.
  const urlParams = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  const isDevMode = urlParams.has('devmode') && urlParams.get('devmode') === 'true';
  if (isDevMode && !serialport) {
    return Promise.resolve();
  }

  if (!serialport || !serialport.writable) {
    return Promise.reject(new Error('Serial port is not writable'));
  }

  // 0: start marker, 1: channel, 2..9: float64 LE
  const packet = Buffer.alloc(10);
  packet.writeUInt8(MESSAGE_START_MARKER, 0);
  packet.writeUInt8(ch & 0xff, 1);
  packet.writeDoubleLE(val, 2);

  const writer = serialport.writable.getWriter();
  try {
    await writer.write(packet);
  } finally {
    writer.releaseLock();
  }
}

function sendJsonEval(code, options = {}) {
  const { capture = null, force = false, skipConsole = false, exec = null } = options;

  if (!serialport || !serialport.writable) {
    return Promise.reject(new Error('Serial port is not writable'));
  }

  if (!force && protocolState.mode !== PROTOCOL_MODES.JSON) {
    return Promise.reject(new Error('JSON protocol not active'));
  }

  const payload = {
    type: 'eval',
    code,
  };

  if (exec) {
    payload.exec = exec;
  }

  return writeJsonRequest(payload, { capture, skipConsole });
}

export function getIoConfig() {
  return protocolState.ioConfig;
}

export function isJsonProtocolActive() {
  return protocolState.mode === PROTOCOL_MODES.JSON;
}

function writeJsonRequest(payload, options = {}) {
  if (!serialport || !serialport.writable) {
    return Promise.reject(new Error('Serial port is not writable'));
  }

  const requestId = payload.requestId || nextRequestId();
  payload.requestId = requestId;

  const pending = {
    resolve: null,
    reject: null,
    capture: options.capture || null,
    skipConsole: options.skipConsole || false,
    timeoutId: null,
  };

  const message = `${JSON.stringify(payload)}\n`;

  return new Promise((resolve, reject) => {
    pending.resolve = resolve;
    pending.reject = reject;

    if (options.timeout && options.timeout > 0) {
      pending.timeoutId = setTimeout(() => {
        protocolState.pendingRequests.delete(requestId);
        reject(new Error(`Request ${requestId} timed out`));
      }, options.timeout);
    }

    protocolState.pendingRequests.set(requestId, pending);

    const writer = serialport.writable.getWriter();

    writer.write(encoder.encode(message))
      .then(() => {
        writer.releaseLock();
      })
      .catch((error) => {
        writer.releaseLock();
        if (pending.timeoutId) {
          clearTimeout(pending.timeoutId);
        }
        protocolState.pendingRequests.delete(requestId);
        reject(error);
      });
  });
}

function handleFirmwareInfo(versionMsg) {
  upgradeCheck(versionMsg);
  maybeNegotiateJsonProtocol();
}

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
  disconnect,
  readingActive,
};

// Constants
const SERIAL_READ_MODES = {
  ANY: 0,
  TEXT: 1,
  SERIALSTREAM: 2,
  JSON: 3,
};

const MESSAGE_START_MARKER = 31;
const MESSAGE_TYPES = {
  STREAM: 0,
  JSON: 101,
  // Any other value is treated as TEXT
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
  post('Make sure that your uSEQ is switched on and plugged in. If it doesn\'t reconnect automatically, click the <span style="color: var(--accent-color); font-weight: bold; display: inline;">[connect]</span> button to pair.');
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

  const urlParams = new URLSearchParams(window.location.search);
  const isDevMode = urlParams.has('devmode') && urlParams.get('devmode') === 'true';

  if (isDevMode && !serialport) {
    dbg("Dev mode: Simulating code execution:", cleanedCode);
    if (capture) {
      capture("Dev mode: Code executed successfully");
    }
    return Promise.resolve({ success: true, text: 'Dev mode: Code executed successfully' });
  }

  if (protocolState.mode === PROTOCOL_MODES.JSON) {
    return sendJsonEval(cleanedCode, { capture }).catch((error) => {
      console.error('Failed to send JSON request to uSEQ', error);
      post('**Error**: Failed to send request to uSEQ. See console for details.');
      throw error;
    });
  }

  if (isPortWritable(serialport)) {
    sendToPort(cleanedCode, capture);
  } else {
    handleNotConnected();
  }

  return Promise.resolve();
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
    case SERIAL_READ_MODES.JSON:
      return processJsonModeData(byteArray);
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
      const messageType = byteArray[1];
      if (messageType === MESSAGE_TYPES.STREAM) {
        mode = SERIAL_READ_MODES.SERIALSTREAM;
      } else if (messageType === MESSAGE_TYPES.JSON) {
        mode = SERIAL_READ_MODES.JSON;
      } else {
        mode = SERIAL_READ_MODES.TEXT;
      }
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

function processJsonModeData(byteArray) {
  for (let i = 2; i < byteArray.length - 1; i++) {
    if (byteArray[i] === 13 && byteArray[i + 1] === 10) {
      const messageBytes = byteArray.slice(2, i);
      const messageText = extractMessageText(messageBytes);
      handleJsonMessage(messageText);

      const remainingBytes = byteArray.slice(i + 2);
      return {
        mode: SERIAL_READ_MODES.ANY,
        processed: false,
        remainingBytes
      };
    }
  }

  return {
    mode: SERIAL_READ_MODES.JSON,
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

function handleJsonMessage(rawMessage) {
  const trimmedMessage = rawMessage.trim();
  if (trimmedMessage.length === 0) {
    return;
  }

  // Debug: Log the raw message received
  dbg("Received raw JSON message:", trimmedMessage);

  let parsed;
  try {
    parsed = JSON.parse(trimmedMessage);
    // Debug: Log the parsed JSON object
    dbg("Parsed JSON message:", parsed);
  } catch (error) {
    console.error('Failed to parse JSON message from uSEQ', trimmedMessage, error);
    return;
  }

  const { requestId, text, meta, success, type: responseType } = parsed;
  const consoleText = parsed.console;
  const adminText = parsed.admin;
  let pending = null;

  if (requestId && protocolState.pendingRequests.has(requestId)) {
    pending = protocolState.pendingRequests.get(requestId);
    protocolState.pendingRequests.delete(requestId);

    if (pending.timeoutId) {
      clearTimeout(pending.timeoutId);
    }
  }

  if (pending) {
    if (pending.capture) {
      try {
        pending.capture(consoleText ?? text ?? '');
      } catch (captureError) {
        console.error('Error running capture callback for JSON response', captureError);
      }
    } else if (!pending.skipConsole) {
      const displayText = consoleText ?? text;
      if (displayText) {
        post(`uSEQ: ${displayText}`);
      }
    }

    pending.resolve(parsed);
  } else {
    const displayText = consoleText ?? text;
    if (displayText) {
      const prefix = success === false ? '**Error**: ' : 'uSEQ: ';
      post(`${prefix}${displayText}`);
    }
  }

  if (meta) {
    try {
      if (typeof window !== 'undefined' && window.dispatchEvent) {
        window.dispatchEvent(new CustomEvent('useq-json-meta', { detail: { response: parsed } }));
      }
    } catch (dispatchError) {
      console.error('Failed to dispatch useq-json-meta event', dispatchError);
    }
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

  // Channel 0 (buffer index 0) carries transport time in seconds.
  if (bufferIndex === 0) {
    handleExternalTimeUpdate(value).catch((error) => {
      dbg(`serialComms: failed to forward time update: ${error}`);
    });
  }

  // Call any registered handler function
  const mapIndex = bufferIndex - 1;
  if (mapIndex >= 0 && serialMapFunctions[mapIndex]) {
    serialMapFunctions[mapIndex](buffer);
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
  resetProtocolState();
  setConnectedToModule(true);
  setSerialPort(port);
  serialReader();
  
  // FIXME In case we just updated the firmware, give the interpreter some time to boot before communication
  await waitForInterpreterBoot();
  sendTouSEQ("@(useq-report-firmware-info)", handleFirmwareInfo);
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
  if (typeof navigator === 'undefined' || !navigator.serial) {
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

if (typeof window !== 'undefined') {
  window.enterBootloaderMode = enterBootloaderMode;
}
