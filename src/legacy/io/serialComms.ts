/**
 * Serial Communication Module
 *
 * Handles communication with the uSEQ device via Web Serial API
 * including message parsing, sending commands, and managing the serial buffer.
 */
import { CircularBuffer } from "../utils/CircularBuffer.ts";
import { Buffer } from "buffer";
import { post } from "./console.ts";
import { upgradeCheck, currentVersion } from "../utils/upgradeCheck.ts";
import { dbg } from "../utils.ts";
import { handleExternalTimeUpdate } from "../ui/serialVis/visualisationController.ts";
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
} from "./utils.ts";


// Extend Window for enterBootloaderMode
declare global {
  interface Window {
    enterBootloaderMode?: typeof enterBootloaderMode;
  }
}

/** Capture callback type for serial responses */
export type CaptureCallback = (response: string) => void;

/** Serial processing state */
interface SerialProcessingState {
  mode: number;
  processed: boolean;
  remainingBytes: Uint8Array;
}

/** Version object used for protocol negotiation */
export interface FirmwareVersion {
  major: number;
  minor: number;
  patch: number;
}

/** IO config received from device during protocol negotiation */
export interface IoConfig {
  inputs?: Array<{ index: number; name: string }>;
  outputs?: Array<{ index: number; name: string }>;
  [key: string]: unknown;
}

/** Stream channel configuration */
export interface StreamChannelConfig {
  id: number;
  name: string;
  enabled: boolean;
  maxRateHz: number;
}

/** Pending JSON request state */
interface PendingRequest {
  resolve: ((value: any) => void) | null;
  reject: ((reason: any) => void) | null;
  capture: CaptureCallback | null;
  skipConsole: boolean;
  timeoutId: ReturnType<typeof setTimeout> | null;
}

/** JSON protocol response */
interface JsonResponse {
  requestId?: string;
  text?: string;
  console?: string;
  admin?: string;
  meta?: Record<string, unknown>;
  success?: boolean;
  type?: string;
  mode?: string;
  config?: IoConfig;
  fw?: string;
  [key: string]: unknown;
}

/** Options for writeJsonRequest */
interface WriteJsonRequestOptions {
  capture?: CaptureCallback | null;
  skipConsole?: boolean;
  timeout?: number;
}

/** Options for sendJsonEval */
interface SendJsonEvalOptions {
  capture?: CaptureCallback | null;
  force?: boolean;
  skipConsole?: boolean;
  exec?: string | null;
}

/**
 * Toggle the connection state - disconnect if connected, connect if disconnected
 * Tries to use a saved port before requesting a new one
 */
export async function toggleConnect(): Promise<void> {
  if (isConnectedToModule()) {
    disconnect();
  } else {
    await tryConnectWithSavedPortOrAsk();
  }
}

/**
 * Try to connect with a saved port or ask for a new one
 */
async function tryConnectWithSavedPortOrAsk(): Promise<void> {
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
 */
function connectToSavedPort(savedport: SerialPort): void {
  post("**Info**: Connecting to saved port...");
  connectToSerialPort(savedport);
}

export function askForPortAndConnect(): void {
  if (!isConnectedToModule()) {
    navigator.serial.requestPort()
      .then((port: SerialPort) => {
        connectToSerialPort(port);
      })
      .catch((err: unknown) => {
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

export function setConnectedToModule(connected: boolean): void {
  connectedToModule = connected;

  if (!connected) {
    resetProtocolState();
  }

  // Update code highlight color
  setCodeHighlightColor(connected);

  // Notify UI components about connection status changes via custom event.
  // Solid toolbars listen to this event to update their own state.
  try {
    if (typeof window !== 'undefined' && window.dispatchEvent) {
      window.dispatchEvent(new CustomEvent('useq-connection-changed', { detail: { connected } }));
    }
  } catch (_e) {
    // no-op if window not available
  }
}

export function isConnectedToModule(): boolean {
  return connectedToModule;
}

// Define variables first before exporting them
let serialport: SerialPort | null = null;
const serialVars: { capture: boolean; captureFunc: CaptureCallback | null } = { capture: false, captureFunc: null };
const encoder = new TextEncoder();
const serialBuffers: CircularBuffer[] = Array.from({ length: 9 }, () => new CircularBuffer(400));

// Add reader reference that can be accessed globally
let currentReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
let readingActive = false;

const serialMapFunctions: Array<((buffer: CircularBuffer) => void) | undefined> = [];

const PROTOCOL_MODES = {
  LEGACY: 'legacy',
  JSON: 'json'
} as const;

interface ProtocolState {
  mode: string;
  negotiationAttempted: boolean;
  requestIdCounter: number;
  pendingRequests: Map<string, PendingRequest>;
  ioConfig: IoConfig | null;
  heartbeatInterval: ReturnType<typeof setInterval> | null;
}

const protocolState: ProtocolState = {
  mode: PROTOCOL_MODES.LEGACY,
  negotiationAttempted: false,
  requestIdCounter: 0,
  pendingRequests: new Map(),
  ioConfig: null,
  heartbeatInterval: null,
};

const JSON_PROTOCOL_MIN_VERSION: FirmwareVersion = { major: 1, minor: 2, patch: 0 };
const EDITOR_VERSION = '1.2.0';
const HEARTBEAT_INTERVAL_MS = 60000;
const HEARTBEAT_TIMEOUT_MS = 10000;

function resetProtocolState(): void {
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

function startHeartbeat(): void {
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

function stopHeartbeat(): void {
  if (protocolState.heartbeatInterval) {
    clearInterval(protocolState.heartbeatInterval);
    protocolState.heartbeatInterval = null;
  }
}

function versionAtLeast(version: FirmwareVersion | null, target: FirmwareVersion): boolean {
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

function jsonEligibleVersion(): boolean {
  return versionAtLeast(currentVersion as FirmwareVersion | null, JSON_PROTOCOL_MIN_VERSION);
}

function nextRequestId(): string {
  protocolState.requestIdCounter += 1;
  return `req-${protocolState.requestIdCounter}`;
}

// Initialise connection-dependent UI state after protocol state is ready
setConnectedToModule(false);

function dispatchProtocolReady(): void {
  try {
    if (typeof window !== 'undefined' && window.dispatchEvent) {
      window.dispatchEvent(new CustomEvent('useq-protocol-ready'));
    }
  } catch (_e) {
    console.warn('Failed to dispatch useq-protocol-ready', _e);
  }
}

async function maybeNegotiateJsonProtocol(): Promise<void> {
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

    const response: JsonResponse = await writeJsonRequest(helloPayload, {
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

function buildDefaultStreamConfig(ioConfig: IoConfig): Record<string, unknown> {
  const channels: StreamChannelConfig[] = [];

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

async function sendDefaultStreamConfig(ioConfig: IoConfig): Promise<void> {
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

export async function sendStreamConfig(channels: StreamChannelConfig[], maxRateHz: number = DEFAULT_STREAM_MAX_RATE_HZ): Promise<JsonResponse> {
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
 * Channel numbering is 1-based to align with firmware `(ssin N)` where N in [1, NUM_SERIAL_INS].
 *
 * This is out-of-band (does not use JSON requests) and is safe to send while JSON protocol is active.
 */
export async function sendSerialInputStreamValue(channel: number, value: number): Promise<void> {
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

function sendJsonEval(code: string, options: SendJsonEvalOptions = {}): Promise<JsonResponse> {
  const { capture = null, force = false, skipConsole = false, exec = null } = options;

  if (!serialport || !serialport.writable) {
    return Promise.reject(new Error('Serial port is not writable'));
  }

  if (!force && protocolState.mode !== PROTOCOL_MODES.JSON) {
    return Promise.reject(new Error('JSON protocol not active'));
  }

  const payload: Record<string, unknown> = {
    type: 'eval',
    code,
  };

  if (exec) {
    payload.exec = exec;
  }

  return writeJsonRequest(payload, { capture, skipConsole });
}

export function getIoConfig(): IoConfig | null {
  return protocolState.ioConfig;
}

export function isJsonProtocolActive(): boolean {
  return protocolState.mode === PROTOCOL_MODES.JSON;
}

function writeJsonRequest(payload: Record<string, unknown>, options: WriteJsonRequestOptions = {}): Promise<JsonResponse> {
  if (!serialport || !serialport.writable) {
    return Promise.reject(new Error('Serial port is not writable'));
  }

  const requestId = (payload.requestId as string) || nextRequestId();
  payload.requestId = requestId;

  const pending: PendingRequest = {
    resolve: null,
    reject: null,
    capture: options.capture || null,
    skipConsole: options.skipConsole || false,
    timeoutId: null,
  };

  const message = `${JSON.stringify(payload)}\n`;

  return new Promise<JsonResponse>((resolve, reject) => {
    pending.resolve = resolve;
    pending.reject = reject;

    if (options.timeout && options.timeout > 0) {
      pending.timeoutId = setTimeout(() => {
        protocolState.pendingRequests.delete(requestId);
        reject(new Error(`Request ${requestId} timed out`));
      }, options.timeout);
    }

    protocolState.pendingRequests.set(requestId, pending);

    const writer = serialport!.writable!.getWriter();

    writer.write(encoder.encode(message))
      .then(() => {
        writer.releaseLock();
      })
      .catch((error: Error) => {
        writer.releaseLock();
        if (pending.timeoutId) {
          clearTimeout(pending.timeoutId);
        }
        protocolState.pendingRequests.delete(requestId);
        reject(error);
      });
  });
}

function handleFirmwareInfo(versionMsg: string): void {
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
} as const;

const MESSAGE_START_MARKER = 31;
const MESSAGE_TYPES = {
  STREAM: 0,
  JSON: 101,
  // Any other value is treated as TEXT
} as const;

// Console output storage
const _consoleLines: string[] = [];
const _MAX_CONSOLE_LINES = 50;

/**
 * Set the active serial port
 */
function setSerialPort(newport: SerialPort): void {
  serialport = newport;
  const portInfo = newport.getInfo();
  localStorage.setItem("uSEQ-Serial-Port-Info", JSON.stringify(portInfo));
}


async function checkForSavedPort(): Promise<SerialPort | null | undefined> {
  dbg("Checking for saved port...");
  // Retrieve saved port information from localStorage
  const savedInfo = JSON.parse(localStorage.getItem("uSEQ-Serial-Port-Info") || "null");

  if (savedInfo) {
    // Get the list of available serial ports
    const ports = await navigator.serial.getPorts();
    dbg("Ports", ports);

    // Find a port that matches the saved information
    const matchingPort = ports.find((port: SerialPort) => {
      const info = port.getInfo() as any;
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
 */
export async function checkForSavedPortAndMaybeConnect(): Promise<SerialPort | null> {
  const savedPort = await checkForSavedPort();
  return savedPort ?
    handleFoundSavedPort(savedPort) :
    handleNoSavedPort();
}

/**
 * Handle the case when a saved port is found
 */
function handleFoundSavedPort(savedPort: SerialPort): SerialPort {
  post("**Info**: Found a saved port, connecting automatically...");
  connectToSerialPort(savedPort);
  return savedPort;
}

/**
 * Handle the case when no saved port is found
 */
function handleNoSavedPort(): null {
  dbg("No saved port information found");
  displayConnectInstructions();
  return null;
}

/**
 * Display instructions for connecting to uSEQ for the first time
 */
function displayConnectInstructions(): void {
  post('Make sure that your uSEQ is switched on and plugged in. If it doesn\'t reconnect automatically, click the <span style="color: var(--accent-color); font-weight: bold; display: inline;">[connect]</span> button to pair.');
}

/**
 * Get the current serial port
 */
function getSerialPort(): SerialPort | null {
  return serialport;
}

/**
 * Send code to the uSEQ device
 */
function sendTouSEQ(code: string, capture: CaptureCallback | null = null): Promise<any> {
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
    return sendJsonEval(cleanedCode, { capture }).catch((error: Error) => {
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
 */
function sendToPort(code: string, capture: CaptureCallback | null): void {
  const writer = serialport!.writable!.getWriter();
  dbg("writing...");

  if (capture) {
    setupCapture(capture);
  }

  writeCodeAndRelease(writer, code);
}

/**
 * Set up the capture function for response
 */
function setupCapture(captureFunc: CaptureCallback): void {
  serialVars.capture = true;
  serialVars.captureFunc = captureFunc;
}

/**
 * Write code to the writer and release the lock when done
 */
function writeCodeAndRelease(writer: WritableStreamDefaultWriter<Uint8Array>, code: string): void {
  writer.write(encoder.encode(code)).then(() => {
    writer.releaseLock();
    dbg("written");
  });
}

/**
 * Handle the case when uSEQ is not connected
 */
function handleNotConnected(): void {
  post("**Warning**: uSEQ not connected yet - make sure it's ");
  // Add attention-grabbing animation to connect button
  animateConnectButton();
}

/**
 * Dispatch an event to animate the connect button to draw attention.
 * Solid toolbars can listen to this event to provide visual feedback.
 */
function animateConnectButton(): void {
  try {
    if (typeof window !== 'undefined' && window.dispatchEvent) {
      window.dispatchEvent(new CustomEvent('useq-animate-connect'));
    }
  } catch (_e) {
    // no-op if window not available
  }
}



/**
 * Process data received from serial port
 */
function processSerialData(byteArray: Uint8Array, state: SerialProcessingState): SerialProcessingState {
  const { mode, processed, remainingBytes } = state;

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
 */
function processAnyModeData(byteArray: Uint8Array): SerialProcessingState {
  let mode: number = SERIAL_READ_MODES.ANY;
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
 */
function processTextModeData(byteArray: Uint8Array): SerialProcessingState {
  // Find end of line (CR+LF)
  for (let i = 2; i < byteArray.length - 1; i++) {
    if (byteArray[i] === 13 && byteArray[i + 1] === 10) {
      // Extract and process message text
      extractAndHandleTextMessage(byteArray.slice(2, i));

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

function processJsonModeData(byteArray: Uint8Array): SerialProcessingState {
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
 */
function extractAndHandleTextMessage(messageBytes: Uint8Array): string {
  const msg = extractMessageText(messageBytes);

  if (serialVars.capture) {
    dbg("Serial vars captured");
    serialVars.captureFunc!(msg);
    serialVars.capture = false;
  } else if (msg !== "") {
    post("uSEQ: " + msg);
  }

  return msg;
}

/**
 * Process data in SERIALSTREAM mode
 */
function processStreamModeData(byteArray: Uint8Array): SerialProcessingState {
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
 */
function processSerialStreamValue(byteArray: Uint8Array): void {
  const channel = byteArray[2];
  const buf = Buffer.from(byteArray);
  const val = buf.readDoubleLE(3);

  // Store value in circular buffer for that channel
  const bufferIndex = channel - 1;
  if (bufferIndex >= 0 && bufferIndex < serialBuffers.length) {
    updateSerialBuffer(bufferIndex, val);
  }
}

function handleJsonMessage(rawMessage: string): void {
  const trimmedMessage = rawMessage.trim();
  if (trimmedMessage.length === 0) {
    return;
  }

  // Debug: Log the raw message received
  dbg("Received raw JSON message:", trimmedMessage);

  let parsed: JsonResponse;
  try {
    parsed = JSON.parse(trimmedMessage);
    // Debug: Log the parsed JSON object
    dbg("Parsed JSON message:", parsed);
  } catch (error) {
    console.error('Failed to parse JSON message from uSEQ', trimmedMessage, error);
    return;
  }

  const { requestId, text, meta, success, type: _responseType } = parsed;
  const consoleText = parsed.console;
  const _adminText = parsed.admin;
  let pending: PendingRequest | null = null;

  if (requestId && protocolState.pendingRequests.has(requestId)) {
    pending = protocolState.pendingRequests.get(requestId)!;
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

    pending.resolve!(parsed);
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
 */
function updateSerialBuffer(bufferIndex: number, value: number): void {
  const buffer = serialBuffers[bufferIndex];
  // Push the final smoothed value to the buffer
  buffer.push(value);

  // Channel 0 (buffer index 0) carries transport time in seconds.
  if (bufferIndex === 0) {
    handleExternalTimeUpdate(value).catch((error: unknown) => {
      dbg(`serialComms: failed to forward time update: ${error}`);
    });
  }

  // Call any registered handler function
  const mapIndex = bufferIndex - 1;
  if (mapIndex >= 0 && serialMapFunctions[mapIndex]) {
    serialMapFunctions[mapIndex]!(buffer);
  }
}

/**
 * Start reading from the serial port
 */
async function serialReader(): Promise<void> {
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
 */
async function setupReaderAndProcessData(initialBuffer: Uint8Array): Promise<Uint8Array> {
  let buffer = initialBuffer;
  const reader = serialport!.readable!.getReader();
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
 */
async function processSerialDataLoop(reader: ReadableStreamDefaultReader<Uint8Array>, buffer: Uint8Array): Promise<Uint8Array> {
  while (readingActive) {
    const readResult = await reader.read();

    if (readResult.done) {
      // Reader has been canceled
      break;
    }

    const byteArray = combineBuffers(buffer, new Uint8Array(readResult.value!.buffer));
    const state = processAllMessages(byteArray);

    // Save any remaining bytes for the next read
    buffer = state.remainingBytes;
  }

  return buffer;
}



/**
 * Process all complete messages in a byte array
 */
function processAllMessages(byteArray: Uint8Array): SerialProcessingState {
  let state: SerialProcessingState = {
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
 */
function cleanupReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  readingActive = false;
  currentReader = null;
  reader.releaseLock();
}

/**
 * Safely stops the serial reader by cancelling the read operation
 */
async function stopSerialReader(): Promise<void> {
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

async function disconnect(port?: SerialPort | null): Promise<void> {
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
 */
function connectToSerialPort(port: SerialPort): Promise<boolean> {
  return openSerialConnection(port)
    .then(async () => {
      await setupConnectedPort(port);
      return true;
    })
    .catch((err: Error) => {
      handleConnectionError(err);
      return false;
    });
}

/**
 * Open a serial connection with the specified baud rate
 */
function openSerialConnection(port: SerialPort): Promise<void> {
  return port.open({ baudRate: 115200 });
}

/**
 * Set up the port after a successful connection
 */
async function setupConnectedPort(port: SerialPort): Promise<void> {
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
 */
function waitForInterpreterBoot(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 3500));
}

/**
 * Handle errors during serial connection
 */
function handleConnectionError(err: Error): void {
  console.log("Error connecting to serial:", err);
  //connection failed
  post(
    'Connection failed. See <a href="https://www.emutelabinstruments.co.uk/useqinfo/useq-editor/#troubleshooting">https://www.emutelabinstruments.co.uk/useqinfo/useq-editor/#troubleshooting</a>'
  );
}

export function checkForWebserialSupport(): boolean {
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
    navigator.serial.addEventListener("connect", (e: Event) => {
      console.log(e);
      const port = getSerialPort();
      if (port) {
        // Notify UI that physical device was plugged in
        try {
          window.dispatchEvent(new CustomEvent('useq-device-plugged-in'));
        } catch (_e) {
          // no-op if window not available
        }
        toggleConnect();
      }
    });

    navigator.serial.addEventListener("disconnect", (_e: Event) => {
      setConnectedToModule(false);
      if (!flag_triggeringBootloader) {
        post("**Info**: uSEQ disconnected");
      }
    });
    return true;
  }
}


let flag_triggeringBootloader = false;

export async function enterBootloaderMode(port?: SerialPort | null): Promise<boolean> {
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
    await port!.open({ baudRate: 1200 });

    // Close immediately after opening at 1200 baud
    await port!.close();

    // Wait for the device to restart in bootloader mode
    post("Waiting for device to reappear as a USB drive...");
    await new Promise<void>(resolve => setTimeout(resolve, 1000));
  } catch (error) {
    console.error("Error entering bootloader mode:", error);
    post(`Error entering bootloader mode: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    flag_triggeringBootloader = false;
  }

  return true;
}

if (typeof window !== 'undefined') {
  window.enterBootloaderMode = enterBootloaderMode;
}
