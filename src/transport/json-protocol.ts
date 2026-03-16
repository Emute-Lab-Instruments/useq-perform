/**
 * JSON Protocol Driver (firmware >= 1.2.0)
 *
 * Handles protocol negotiation, heartbeat keep-alive, JSON request/response
 * lifecycle, and structured eval.
 */

import { Buffer } from "buffer";
import { post } from "../utils/consoleStore.ts";
import { dbg } from "../lib/debug.ts";
import { upgradeCheck, currentVersion } from "./upgradeCheck.ts";
import {
  buildDefaultStreamConfig,
  buildHeartbeatRequest,
  buildHelloRequest,
  buildSerialOutputRouting,
  DEFAULT_STREAM_MAX_RATE_HZ,
  isJsonEligibleVersion,
  type FirmwareVersion,
  type IoConfig,
  type StreamChannelConfig,
} from "../runtime/jsonProtocol.ts";
import {
  reportProtocolModeChanged,
} from "../runtime/runtimeService.ts";
import {
  dispatchRuntimeEvent,
  JSON_META_EVENT,
  PROTOCOL_READY_EVENT,
} from "../contracts/runtimeEvents.ts";
import { getStartupFlagsSnapshot } from "../runtime/startupContext.ts";

import {
  PROTOCOL_MODES,
  EDITOR_VERSION,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  MESSAGE_START_MARKER,
  type ProtocolState,
  type JsonResponse,
  type WriteJsonRequestOptions,
  type SendJsonEvalOptions,
  type CaptureCallback,
} from "./types.ts";
import { setSerialOutputBufferRouting } from "./stream-parser.ts";

// ── Protocol state (module-level singleton) ──────────────────────────

export const protocolState: ProtocolState = {
  mode: PROTOCOL_MODES.LEGACY,
  negotiationAttempted: false,
  requestIdCounter: 0,
  pendingRequests: new Map(),
  ioConfig: null,
  heartbeatInterval: null,
};

const encoder = new TextEncoder();

// ── emitConnectionChanged callback ───────────────────────────────────
// Set by the connector so the protocol layer can trigger connection
// change broadcasts without a circular import.

let _emitConnectionChanged: (() => void) | null = null;

export function setEmitConnectionChanged(fn: () => void): void {
  _emitConnectionChanged = fn;
}

// ── Accessor for the serial port (set by connector) ──────────────────

let _getSerialPort: (() => SerialPort | null) | null = null;

export function setGetSerialPort(fn: () => SerialPort | null): void {
  _getSerialPort = fn;
}

function serialport(): SerialPort | null {
  return _getSerialPort ? _getSerialPort() : null;
}

// ── Protocol accessors ──────────────────────────────────────────────

export function getProtocolMode(): "legacy" | "json" {
  return protocolState.mode === PROTOCOL_MODES.JSON ? "json" : "legacy";
}

export function isJsonProtocolActive(): boolean {
  return protocolState.mode === PROTOCOL_MODES.JSON;
}

export function getIoConfig(): IoConfig | null {
  return protocolState.ioConfig;
}

// ── State reset ──────────────────────────────────────────────────────

export function resetProtocolState(): void {
  protocolState.pendingRequests.forEach((pending) => {
    if (pending && typeof pending.reject === "function") {
      pending.reject(new Error("Connection reset"));
    }
  });
  protocolState.mode = PROTOCOL_MODES.LEGACY;
  protocolState.negotiationAttempted = false;
  protocolState.requestIdCounter = 0;
  protocolState.pendingRequests.clear();
  protocolState.ioConfig = null;
  setSerialOutputBufferRouting({});
  stopHeartbeat();
  reportProtocolModeChanged(getProtocolMode());
}

// ── Heartbeat ────────────────────────────────────────────────────────

function startHeartbeat(): void {
  if (protocolState.heartbeatInterval) return;

  protocolState.heartbeatInterval = setInterval(async () => {
    const port = serialport();
    if (protocolState.mode !== PROTOCOL_MODES.JSON || !port?.writable) {
      stopHeartbeat();
      return;
    }

    if (protocolState.pendingRequests.size > 0) return;

    try {
      await writeJsonRequest(buildHeartbeatRequest(), {
        skipConsole: true,
        timeout: HEARTBEAT_TIMEOUT_MS,
      });
    } catch (err) {
      console.warn("Heartbeat failed:", err);
      post(
        "**Warning**: Heartbeat timeout - connection may be lost. Reconnect if needed."
      );
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

// ── Negotiation ──────────────────────────────────────────────────────

function jsonEligibleVersion(): boolean {
  return isJsonEligibleVersion(currentVersion as FirmwareVersion | null);
}

function nextRequestId(): string {
  protocolState.requestIdCounter += 1;
  return `req-${protocolState.requestIdCounter}`;
}

function dispatchProtocolReady(): void {
  _emitConnectionChanged?.();

  try {
    dispatchRuntimeEvent(PROTOCOL_READY_EVENT, {
      protocolMode: getProtocolMode(),
    });
  } catch (_e) {
    console.warn("Failed to dispatch useq-protocol-ready", _e);
  }
}

export async function maybeNegotiateJsonProtocol(): Promise<void> {
  if (protocolState.negotiationAttempted) return;

  if (!jsonEligibleVersion()) {
    protocolState.negotiationAttempted = true;
    dispatchProtocolReady();
    return;
  }

  protocolState.negotiationAttempted = true;

  try {
    const response: JsonResponse = await writeJsonRequest(
      buildHelloRequest(EDITOR_VERSION),
      { skipConsole: true, timeout: 5000 }
    );

    if (response.success && response.mode === "json") {
      protocolState.mode = PROTOCOL_MODES.JSON;
      if (response.config) {
        protocolState.ioConfig = response.config;
        setSerialOutputBufferRouting(
          buildSerialOutputRouting(response.config)
        );
        sendDefaultStreamConfig(response.config);
      }
      post(
        `**Info**: Using structured JSON protocol (fw: ${response.fw || "unknown"}).`
      );
      startHeartbeat();
    } else {
      post(
        `**Warning**: JSON negotiation failed (${response.text || "no details"}), using legacy mode.`
      );
    }
  } catch (err) {
    console.error("JSON negotiation error", err);
    post(
      "**Warning**: Unable to switch to JSON protocol, staying in legacy mode."
    );
  } finally {
    dispatchProtocolReady();
  }
}

async function sendDefaultStreamConfig(ioConfig: IoConfig): Promise<void> {
  if (!ioConfig) return;

  try {
    const config = buildDefaultStreamConfig(ioConfig);
    await writeJsonRequest(config, { skipConsole: true, timeout: 5000 });
    dbg("Stream config sent:", config);
  } catch (err) {
    console.warn("Failed to send stream config:", err);
  }
}

// ── Write JSON request ───────────────────────────────────────────────

export function writeJsonRequest(
  payload: object,
  options: WriteJsonRequestOptions = {}
): Promise<JsonResponse> {
  const port = serialport();
  if (!port || !port.writable) {
    return Promise.reject(new Error("Serial port is not writable"));
  }

  const mutablePayload = payload as Record<string, unknown>;
  const requestId =
    (mutablePayload.requestId as string) || nextRequestId();
  mutablePayload.requestId = requestId;

  const pending = {
    resolve: null as ((value: any) => void) | null,
    reject: null as ((reason: any) => void) | null,
    capture: options.capture || null,
    skipConsole: options.skipConsole || false,
    timeoutId: null as ReturnType<typeof setTimeout> | null,
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

    const writer = port.writable!.getWriter();

    writer
      .write(encoder.encode(message))
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

// ── Send stream config ───────────────────────────────────────────────

export async function sendStreamConfig(
  channels: StreamChannelConfig[],
  maxRateHz: number = DEFAULT_STREAM_MAX_RATE_HZ
): Promise<JsonResponse> {
  if (protocolState.mode !== PROTOCOL_MODES.JSON) {
    return Promise.reject(new Error("JSON protocol not active"));
  }

  return writeJsonRequest(
    { type: "stream-config", maxRateHz, channels },
    { skipConsole: true, timeout: 5000 }
  );
}

// ── Send serial input stream value ───────────────────────────────────

export async function sendSerialInputStreamValue(
  channel: number,
  value: number
): Promise<void> {
  const ch = Number(channel);
  const val = Number(value);

  if (!Number.isFinite(ch) || ch < 1 || ch > 255) {
    return Promise.reject(new Error(`Invalid stream channel: ${channel}`));
  }
  if (!Number.isFinite(val)) {
    return Promise.reject(new Error(`Invalid stream value: ${value}`));
  }

  const isDevMode = getStartupFlagsSnapshot().devmode;
  const port = serialport();
  if (isDevMode && !port) {
    return Promise.resolve();
  }

  if (!port || !port.writable) {
    return Promise.reject(new Error("Serial port is not writable"));
  }

  const packet = Buffer.alloc(10);
  packet.writeUInt8(MESSAGE_START_MARKER, 0);
  packet.writeUInt8(ch & 0xff, 1);
  packet.writeDoubleLE(val, 2);

  const writer = port.writable.getWriter();
  try {
    await writer.write(packet);
  } finally {
    writer.releaseLock();
  }
}

// ── JSON eval ────────────────────────────────────────────────────────

export function sendJsonEval(
  code: string,
  options: SendJsonEvalOptions = {}
): Promise<JsonResponse> {
  const { capture = null, force = false, skipConsole = false, exec = null } =
    options;

  const port = serialport();
  if (!port || !port.writable) {
    return Promise.reject(new Error("Serial port is not writable"));
  }

  if (!force && protocolState.mode !== PROTOCOL_MODES.JSON) {
    return Promise.reject(new Error("JSON protocol not active"));
  }

  const payload: Record<string, unknown> = { type: "eval", code };
  if (exec) payload.exec = exec;

  return writeJsonRequest(payload, { capture, skipConsole });
}

// ── Handle firmware info (bridge from text message) ──────────────────

export function handleFirmwareInfo(versionMsg: string): void {
  upgradeCheck(versionMsg);
  maybeNegotiateJsonProtocol();
}

// ── Handle incoming JSON message ─────────────────────────────────────

export function handleJsonMessage(rawMessage: string): void {
  const trimmedMessage = rawMessage.trim();
  if (trimmedMessage.length === 0) return;

  dbg("Received raw JSON message:", trimmedMessage);

  let parsed: JsonResponse;
  try {
    parsed = JSON.parse(trimmedMessage);
    dbg("Parsed JSON message:", parsed);
  } catch (error) {
    console.error(
      "Failed to parse JSON message from uSEQ",
      trimmedMessage,
      error
    );
    return;
  }

  const { requestId, text, meta, success } = parsed;
  const consoleText = parsed.console;
  let pending: (typeof protocolState.pendingRequests extends Map<
    string,
    infer V
  >
    ? V
    : never) | null = null;

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
        pending.capture(consoleText ?? text ?? "");
      } catch (captureError) {
        console.error(
          "Error running capture callback for JSON response",
          captureError
        );
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
      const prefix = success === false ? "**Error**: " : "uSEQ: ";
      post(`${prefix}${displayText}`);
    }
  }

  if (meta) {
    try {
      dispatchRuntimeEvent(JSON_META_EVENT, { response: parsed });
    } catch (dispatchError) {
      console.error(
        "Failed to dispatch useq-json-meta event",
        dispatchError
      );
    }
  }
}
