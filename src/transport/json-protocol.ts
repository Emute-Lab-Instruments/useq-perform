/**
 * JSON Protocol Driver (firmware >= 1.2.0)
 *
 * Handles protocol negotiation, heartbeat keep-alive, JSON request/response
 * lifecycle, structured eval, and code sending.
 *
 * Initialised via initProtocol(context) which encapsulates all mutable state.
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
  protocolReady as protocolReadyChannel,
  jsonMeta as jsonMetaChannel,
  animateConnect as animateConnectChannel,
} from "../contracts/runtimeChannels";
import { getStartupFlagsSnapshot } from "../runtime/startupContext.ts";
import { cleanCode, isPortWritable } from "./serial-utils.ts";

import {
  EDITOR_VERSION,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  MESSAGE_START_MARKER,
  type TransportContext,
  type ProtocolState,
  type JsonResponse,
  type WriteJsonRequestOptions,
  type SendJsonEvalOptions,
  type CaptureCallback,
} from "./types.ts";
import { setSerialOutputBufferRouting } from "./stream-parser.ts";

// ── Module state (set once by initProtocol) ──────────────────────────

let _ctx: TransportContext | null = null;

export const protocolState: ProtocolState = {
  mode: "negotiating",
  negotiationAttempted: false,
  requestIdCounter: 0,
  pendingRequests: new Map(),
  ioConfig: null,
  heartbeatInterval: null,
};

const encoder = new TextEncoder();

// ── Initialisation ───────────────────────────────────────────────────

/**
 * Inject transport dependencies. Called once by connector.ts at module init.
 * Replaces the old setGetSerialPort / setEmitConnectionChanged setters.
 */
export function initProtocol(ctx: TransportContext): void {
  _ctx = ctx;
}

function serialport(): SerialPort | null {
  return _ctx ? _ctx.getSerialPort() : null;
}

// ── Protocol accessors ──────────────────────────────────────────────

export function getProtocolMode(): "legacy" | "json" {
  return protocolState.mode === "json" ? "json" : "legacy";
}

export function isJsonProtocolActive(): boolean {
  return protocolState.mode === "json";
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
  protocolState.mode = "negotiating";
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
    if (protocolState.mode !== "json" || !port?.writable) {
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
  _ctx?.emitConnectionChanged();

  try {
    protocolReadyChannel.publish({
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
      protocolState.mode = "json";
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
  if (protocolState.mode !== "json") {
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

  if (!force && protocolState.mode !== "json") {
    return Promise.reject(new Error("JSON protocol not active"));
  }

  const payload: Record<string, unknown> = { type: "eval", code };
  if (exec) payload.exec = exec;

  return writeJsonRequest(payload, { capture, skipConsole });
}

// ── sendTouSEQ (primary code-send API) ───────────────────────────────

/**
 * Send code to the uSEQ device.
 * Uses JSON eval when the protocol is active; falls back to raw text
 * serial write during early boot (before negotiation completes).
 * In dev mode without a port, simulates execution.
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

  if (!isPortWritable(port)) {
    handleNotConnected();
    return Promise.resolve();
  }

  // JSON protocol active — use structured eval
  if (protocolState.mode === "json") {
    return sendJsonEval(cleanedCode, { capture }).catch((error: Error) => {
      console.error("Failed to send JSON request to uSEQ", error);
      post(
        "**Error**: Failed to send request to uSEQ. See console for details."
      );
      throw error;
    });
  }

  // Pre-negotiation: send as raw text (used for firmware info probe)
  return writeRawText(port!, cleanedCode, capture);
}

function handleNotConnected(): void {
  post("**Warning**: uSEQ not connected yet - make sure it's plugged in and click Connect");
  try {
    animateConnectChannel.publish(undefined);
  } catch (_e) {
    // no-op if window not available
  }
}

// ── Raw text write (pre-negotiation only) ────────────────────────────

/**
 * Write raw text to the serial port and optionally capture the text
 * response via the shared serialVars mechanism.
 * Used for the firmware info probe before JSON negotiation.
 */
function writeRawText(
  port: SerialPort,
  code: string,
  capture: CaptureCallback | null
): Promise<void> {
  const writer = port.writable!.getWriter();
  dbg("writing raw text...");

  if (capture && _ctx) {
    _ctx.serialVars.capture = true;
    _ctx.serialVars.captureFunc = capture;
  }

  return writer.write(encoder.encode(code)).then(() => {
    writer.releaseLock();
    dbg("raw text written");
  }).catch((err) => {
    writer.releaseLock();
    console.error("Serial write failed:", err);
  });
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
      jsonMetaChannel.publish({ response: parsed });
    } catch (dispatchError) {
      console.error(
        "Failed to dispatch useq-json-meta event",
        dispatchError
      );
    }
  }
}
