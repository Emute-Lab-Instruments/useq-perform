/**
 * Stream Parser
 *
 * Byte-level parsing and routing of serial data. Splits incoming byte
 * streams into TEXT, JSON, and STREAM messages based on the wire protocol.
 */

import { Buffer } from "buffer";
import { CircularBuffer } from "../lib/CircularBuffer.ts";
import { dbg } from "../lib/debug.ts";
import { handleExternalTimeUpdate } from "../ui/visualisation/visualisationController.ts";
import {
  combineBuffers,
  findMessageStartMarker,
  updateRemainingBytes,
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
  type SerialVars,
} from "./types.ts";

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
  onTextMessage: (msg: string) => void,
  onJsonMessage: (msg: string) => void,
  serialVars: SerialVars
): Promise<void> {
  if (!isSerialPortValid(serialport)) return;
  dbg("reading...");

  let buffer: Uint8Array = new Uint8Array(0);

  if (isPortReadableAndUnlocked(serialport)) {
    buffer = await setupReaderAndProcessData(
      serialport!,
      buffer,
      onTextMessage,
      onJsonMessage,
      serialVars
    );
  } else {
    console.log("Serial port is not readable or is locked");
  }
}

async function setupReaderAndProcessData(
  port: SerialPort,
  initialBuffer: Uint8Array,
  onTextMessage: (msg: string) => void,
  onJsonMessage: (msg: string) => void,
  serialVars: SerialVars
): Promise<Uint8Array> {
  let buffer = initialBuffer;
  const reader = port.readable!.getReader();
  currentReader = reader;
  readingActive = true;

  try {
    buffer = await processSerialDataLoop(
      reader,
      buffer,
      onTextMessage,
      onJsonMessage,
      serialVars
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
  onTextMessage: (msg: string) => void,
  onJsonMessage: (msg: string) => void,
  serialVars: SerialVars
): Promise<Uint8Array> {
  while (readingActive) {
    const readResult = await reader.read();
    if (readResult.done) break;

    const byteArray = combineBuffers(
      buffer,
      new Uint8Array(readResult.value!.buffer)
    );
    const state = processAllMessages(
      byteArray,
      onTextMessage,
      onJsonMessage,
      serialVars
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
  reader.releaseLock();
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
  onTextMessage: (msg: string) => void,
  onJsonMessage: (msg: string) => void,
  serialVars: SerialVars
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
      onTextMessage,
      onJsonMessage,
      serialVars
    );
  }

  return state;
}

function processSerialData(
  byteArray: Uint8Array,
  state: SerialProcessingState,
  onTextMessage: (msg: string) => void,
  onJsonMessage: (msg: string) => void,
  serialVars: SerialVars
): SerialProcessingState {
  const { mode } = state;

  switch (mode) {
    case SERIAL_READ_MODES.ANY:
      return processAnyModeData(byteArray);
    case SERIAL_READ_MODES.TEXT:
      return processTextModeData(byteArray, onTextMessage, serialVars);
    case SERIAL_READ_MODES.SERIALSTREAM:
      return processStreamModeData(byteArray);
    case SERIAL_READ_MODES.JSON:
      return processJsonModeData(byteArray, onJsonMessage);
  }

  return state;
}

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
      processed = true;
    }
  } else {
    const startIndex = findMessageStartMarker(
      byteArray,
      MESSAGE_START_MARKER
    );
    remainingBytes = updateRemainingBytes(byteArray, startIndex);
    processed = true;
  }

  return { mode, processed, remainingBytes };
}

function processTextModeData(
  byteArray: Uint8Array,
  onTextMessage: (msg: string) => void,
  serialVars: SerialVars
): SerialProcessingState {
  for (let i = 2; i < byteArray.length - 1; i++) {
    if (byteArray[i] === 13 && byteArray[i + 1] === 10) {
      const msg = extractMessageText(byteArray.slice(2, i));

      if (serialVars.capture) {
        dbg("Serial vars captured");
        serialVars.captureFunc!(msg);
        serialVars.capture = false;
      } else if (msg !== "") {
        onTextMessage(msg);
      }

      return {
        mode: SERIAL_READ_MODES.ANY,
        processed: false,
        remainingBytes: byteArray.slice(i + 2),
      };
    }
  }

  return {
    mode: SERIAL_READ_MODES.TEXT,
    processed: true,
    remainingBytes: byteArray,
  };
}

function processJsonModeData(
  byteArray: Uint8Array,
  onJsonMessage: (msg: string) => void
): SerialProcessingState {
  for (let i = 2; i < byteArray.length - 1; i++) {
    if (byteArray[i] === 13 && byteArray[i + 1] === 10) {
      const messageText = extractMessageText(byteArray.slice(2, i));
      onJsonMessage(messageText);

      return {
        mode: SERIAL_READ_MODES.ANY,
        processed: false,
        remainingBytes: byteArray.slice(i + 2),
      };
    }
  }

  return {
    mode: SERIAL_READ_MODES.JSON,
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
}

function updateSerialBuffer(bufferIndex: number, value: number): void {
  const buffer = serialBuffers[bufferIndex];
  buffer.push(value);

  if (bufferIndex === 0) {
    handleExternalTimeUpdate(value).catch((error: unknown) => {
      dbg(`streamParser: failed to forward time update: ${error}`);
    });
  }

  const mapIndex = bufferIndex - 1;
  if (mapIndex >= 0 && serialMapFunctions[mapIndex]) {
    serialMapFunctions[mapIndex]!(buffer);
  }
}
