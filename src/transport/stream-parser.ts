/**
 * Stream Parser
 *
 * Byte-level parsing and routing of serial data. Splits incoming byte
 * streams into STREAM (binary §3.2) and bare-JSON (§3.3) messages.
 */

import { Buffer } from "buffer";
import { CircularBuffer } from "../lib/CircularBuffer.ts";
import { dbg } from "../lib/debug.ts";
import { notifyExternalTimeUpdate } from "../effects/visualisationRuntime.ts";
import {
  combineBuffers,
  extractMessageText,
  isSerialPortValid,
  isPortReadableAndUnlocked,
} from "./serial-utils.ts";
import {
  SERIAL_READ_MODES,
  MESSAGE_START_MARKER,
  MESSAGE_TYPES,
  type SerialProcessingState,
  type BufferMapFunction,
} from "./types.ts";
import { hwInputStream } from "../contracts/hardwareChannels.ts";

// ── Shared mutable state ─────────────────────────────────────────────
// These are the canonical instances; other modules reference them.

export const serialBuffers: CircularBuffer[] = Array.from(
  { length: 9 },
  () => new CircularBuffer(400)
);

export let serialOutputBufferRouting: Record<number, number> = {};

export function setSerialOutputBufferRouting(
  routing: Record<number, number>
): void {
  serialOutputBufferRouting = routing;
}

export let serialInputHwRouting: Record<number, number> = {};

export function setSerialInputHwRouting(
  routing: Record<number, number>
): void {
  serialInputHwRouting = routing;
}

export const serialMapFunctions: Array<BufferMapFunction | undefined> = [];

// ── Reader lifecycle ─────────────────────────────────────────────────

let currentReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
export let readingActive = false;

/**
 * Start reading from the serial port.
 * Incoming bytes are routed through processAllMessages.
 */
export async function serialReader(
  serialport: SerialPort | null,
  onJsonMessage: (msg: string) => void
): Promise<void> {
  if (!isSerialPortValid(serialport)) return;
  dbg("reading...");

  let buffer: Uint8Array = new Uint8Array(0);

  if (isPortReadableAndUnlocked(serialport)) {
    buffer = await setupReaderAndProcessData(
      serialport!,
      buffer,
      onJsonMessage
    );
  } else {
    console.log("Serial port is not readable or is locked");
  }
}

async function setupReaderAndProcessData(
  port: SerialPort,
  initialBuffer: Uint8Array,
  onJsonMessage: (msg: string) => void
): Promise<Uint8Array> {
  let buffer = initialBuffer;
  const reader = port.readable!.getReader();
  currentReader = reader;
  readingActive = true;

  try {
    buffer = await processSerialDataLoop(
      reader,
      buffer,
      onJsonMessage
    );
  } catch (error) {
    console.log("Serial read error:", error);
  } finally {
    cleanupReader(reader);
  }

  return buffer;
}

async function processSerialDataLoop(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  buffer: Uint8Array,
  onJsonMessage: (msg: string) => void
): Promise<Uint8Array> {
  let chunkCount = 0;
  while (readingActive) {
    const readResult = await reader.read();
    if (readResult.done) break;

    const v = readResult.value!;
    const incoming = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    chunkCount++;
    if (chunkCount <= 20) {
      const hex = Array.from(incoming.slice(0, 40)).map(b => b.toString(16).padStart(2, '0')).join(' ');
      // console.log(`[stream-parser] chunk #${chunkCount} (${incoming.length} bytes): ${hex}${incoming.length > 40 ? '...' : ''}`);
    }

    const byteArray = combineBuffers(buffer, incoming);
    const state = processAllMessages(
      byteArray,
      onJsonMessage
    );
    buffer = state.remainingBytes;
  }
  return buffer;
}

function cleanupReader(
  reader: ReadableStreamDefaultReader<Uint8Array>
): void {
  readingActive = false;
  currentReader = null;
  try {
    reader.releaseLock();
  } catch {
    // Already released by cancel() — safe to ignore.
  }
}

/**
 * Safely stops the serial reader by cancelling the read operation.
 */
export async function stopSerialReader(): Promise<void> {
  if (currentReader) {
    readingActive = false;
    try {
      await currentReader.cancel();
    } catch (err) {
      console.log("Error cancelling reader:", err);
    }
  }
}

// ── Message processing ───────────────────────────────────────────────

/**
 * Process all complete messages in a byte array.
 */
export function processAllMessages(
  byteArray: Uint8Array,
  onJsonMessage: (msg: string) => void
): SerialProcessingState {
  let state: SerialProcessingState = {
    mode: SERIAL_READ_MODES.ANY,
    processed: false,
    remainingBytes: byteArray,
  };

  while (state.remainingBytes.length > 0 && !state.processed) {
    state = processSerialData(
      state.remainingBytes,
      state,
      onJsonMessage
    );
  }

  return state;
}

function processSerialData(
  byteArray: Uint8Array,
  state: SerialProcessingState,
  onJsonMessage: (msg: string) => void
): SerialProcessingState {
  const { mode } = state;

  switch (mode) {
    case SERIAL_READ_MODES.ANY:
      return processAnyModeData(byteArray);
    case SERIAL_READ_MODES.SERIALSTREAM:
      return processStreamModeData(byteArray);
    case SERIAL_READ_MODES.BARE_JSON:
      return processBareJsonModeData(byteArray, onJsonMessage);
  }

  return state;
}

// ASCII `{` (0x7b) — start of a bare JSON message per spec §3.3.
const BARE_JSON_START = 0x7b;

function processAnyModeData(byteArray: Uint8Array): SerialProcessingState {
  if (byteArray[0] === MESSAGE_START_MARKER) {
    if (byteArray.length < 2) {
      // Not enough bytes yet to read the type byte — wait for more.
      return { mode: SERIAL_READ_MODES.ANY, processed: true, remainingBytes: byteArray };
    }
    const typebyte = byteArray[1];
    if (typebyte === MESSAGE_TYPES.STREAM) {
      return { mode: SERIAL_READ_MODES.SERIALSTREAM, processed: false, remainingBytes: byteArray };
    }
    // Unknown binary type byte (§3.4): advance one byte and re-discriminate.
    return { mode: SERIAL_READ_MODES.ANY, processed: false, remainingBytes: byteArray.slice(1) };
  }

  if (byteArray[0] === BARE_JSON_START) {
    // Spec §3.3: bare `{...}\n` JSON message — no 0x1F prefix.
    return { mode: SERIAL_READ_MODES.BARE_JSON, processed: false, remainingBytes: byteArray };
  }

  // Garbage / out-of-sync: advance one byte and re-discriminate (spec §3.1).
  return { mode: SERIAL_READ_MODES.ANY, processed: false, remainingBytes: byteArray.slice(1) };
}

/**
 * Process a bare JSON frame: `{...}\n` with no 0x1F prefix (spec §3.3).
 * Scans from the `{` byte (index 0) for a `\n` or `\r\n` terminator.
 * Blank lines between messages are silently skipped per the spec.
 */
function processBareJsonModeData(
  byteArray: Uint8Array,
  onJsonMessage: (msg: string) => void
): SerialProcessingState {
  for (let i = 0; i < byteArray.length; i++) {
    if (byteArray[i] === 10) {
      const end = (i > 0 && byteArray[i - 1] === 13) ? i - 1 : i;
      const messageText = extractMessageText(byteArray.slice(0, end));
      if (messageText.length > 0) {
        // console.log(`[stream-parser] JSON frame received: ${messageText.slice(0, 200)}${messageText.length > 200 ? '...' : ''}`);
        onJsonMessage(messageText);
      }
      return {
        mode: SERIAL_READ_MODES.ANY,
        processed: false,
        remainingBytes: byteArray.slice(i + 1),
      };
    }
  }

  return {
    mode: SERIAL_READ_MODES.BARE_JSON,
    processed: true,
    remainingBytes: byteArray,
  };
}

function processStreamModeData(byteArray: Uint8Array): SerialProcessingState {
  if (byteArray.length < 11) {
    return {
      mode: SERIAL_READ_MODES.SERIALSTREAM,
      processed: true,
      remainingBytes: byteArray,
    };
  }

  processSerialStreamValue(byteArray);

  return {
    mode: SERIAL_READ_MODES.ANY,
    processed: false,
    remainingBytes: byteArray.slice(11),
  };
}

function processSerialStreamValue(byteArray: Uint8Array): void {
  const channel = byteArray[2];
  const buf = Buffer.from(byteArray);
  const val = buf.readDoubleLE(3);

  const bufferIndex =
    serialOutputBufferRouting[channel] ?? channel - 1;
  if (bufferIndex >= 0 && bufferIndex < serialBuffers.length) {
    updateSerialBuffer(bufferIndex, val);
  }

  const hwInputIndex = serialInputHwRouting[channel];
  if (hwInputIndex !== undefined) {
    hwInputStream.publish({ hwInputIndex, value: val });
  }
}

function updateSerialBuffer(bufferIndex: number, value: number): void {
  const buffer = serialBuffers[bufferIndex];
  buffer.push(value);

  if (bufferIndex === 0) {
    // Push the time into the visualisation runtime; it updates the store
    // immediately and queues a fresh sample (latest-time-wins).
    try {
      notifyExternalTimeUpdate(value);
    } catch (error: unknown) {
      dbg(`streamParser: failed to forward time update: ${error}`);
    }
  }

  const mapIndex = bufferIndex - 1;
  if (mapIndex >= 0 && serialMapFunctions[mapIndex]) {
    serialMapFunctions[mapIndex]!(buffer);
  }
}
