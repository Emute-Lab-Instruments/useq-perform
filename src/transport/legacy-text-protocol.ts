/**
 * Legacy Text Protocol Driver (firmware < 1.2.0 fallback)
 *
 * Handles plain-text serial communication with the uSEQ device.
 * Used when JSON protocol negotiation fails or firmware is too old.
 */

import { post } from "../utils/consoleStore.ts";
import { dbg } from "../legacy/utils.ts";
import { cleanCode, isPortWritable } from "../legacy/io/utils.ts";
import { getStartupFlagsSnapshot } from "../runtime/startupContext.ts";
import {
  dispatchRuntimeEvent,
  ANIMATE_CONNECT_EVENT,
} from "../contracts/runtimeEvents.ts";

import {
  PROTOCOL_MODES,
  type CaptureCallback,
  type SerialVars,
} from "./types.ts";
import { sendJsonEval } from "./json-protocol.ts";

// ── Shared encoder ──────────────────────────────────────────────────

const encoder = new TextEncoder();

// ── Accessor for serial port (set by connector) ─────────────────────

let _getSerialPort: (() => SerialPort | null) | null = null;

export function setGetSerialPort(fn: () => SerialPort | null): void {
  _getSerialPort = fn;
}

function serialport(): SerialPort | null {
  return _getSerialPort ? _getSerialPort() : null;
}

// ── Accessor for protocol mode (set by connector) ───────────────────

let _getProtocolMode: (() => string) | null = null;

export function setGetProtocolMode(fn: () => string): void {
  _getProtocolMode = fn;
}

function protocolMode(): string {
  return _getProtocolMode ? _getProtocolMode() : PROTOCOL_MODES.LEGACY;
}

// ── Shared serial vars reference ────────────────────────────────────

let _serialVars: SerialVars = { capture: false, captureFunc: null };

export function setSerialVars(vars: SerialVars): void {
  _serialVars = vars;
}

// ── Send code to uSEQ ──────────────────────────────────────────────

/**
 * Send code to the uSEQ device.
 * Dispatches to JSON eval when JSON protocol is active, otherwise
 * falls back to plain text serial writes.
 */
export function sendTouSEQ(
  code: string,
  capture: CaptureCallback | null = null
): Promise<any> {
  const cleanedCode = cleanCode(code);
  const isDevMode = getStartupFlagsSnapshot().devmode;
  const port = serialport();

  if (isDevMode && !port) {
    dbg("Dev mode: Simulating code execution:", cleanedCode);
    if (capture) {
      capture("Dev mode: Code executed successfully");
    }
    return Promise.resolve({
      success: true,
      text: "Dev mode: Code executed successfully",
    });
  }

  if (protocolMode() === PROTOCOL_MODES.JSON) {
    return sendJsonEval(cleanedCode, { capture }).catch((error: Error) => {
      console.error("Failed to send JSON request to uSEQ", error);
      post(
        "**Error**: Failed to send request to uSEQ. See console for details."
      );
      throw error;
    });
  }

  if (isPortWritable(port)) {
    sendToPort(cleanedCode, capture);
  } else {
    handleNotConnected();
  }

  return Promise.resolve();
}

// ── Internal helpers ────────────────────────────────────────────────

function sendToPort(
  code: string,
  capture: CaptureCallback | null
): void {
  const port = serialport()!;
  const writer = port.writable!.getWriter();
  dbg("writing...");

  if (capture) {
    _serialVars.capture = true;
    _serialVars.captureFunc = capture;
  }

  writer.write(encoder.encode(code)).then(() => {
    writer.releaseLock();
    dbg("written");
  });
}

function handleNotConnected(): void {
  post("**Warning**: uSEQ not connected yet - make sure it's ");
  animateConnectButton();
}

function animateConnectButton(): void {
  try {
    dispatchRuntimeEvent(ANIMATE_CONNECT_EVENT, undefined);
  } catch (_e) {
    // no-op if window not available
  }
}
