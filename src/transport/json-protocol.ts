/**
 * JSON Protocol Driver (firmware >= 1.2.0)
 *
 * Handles protocol negotiation, heartbeat keep-alive, JSON request/response
 * lifecycle, structured eval, and code sending.
 *
 * Initialised via initProtocol(context) which encapsulates all mutable state.
 */

import { post } from "../utils/consoleStore.ts";
import { dbg } from "../lib/debug.ts";
import { upgradeCheck } from "./upgradeCheck.ts";
import {
  buildDefaultStreamConfig,
  buildHeartbeatRequest,
  buildHelloRequest,
  buildSerialOutputRouting,
  buildSetLiveInputsRequest,
  buildCalibrateBeginRequest,
  buildCalibrateSetTargetRequest,
  buildCalibrateAdjustRequest,
  buildCalibrateSavePointRequest,
  buildCalibrateEndRequest,
  buildGetStateRequest,
  DEFAULT_STREAM_MAX_RATE_HZ,
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
  standaloneDiagnostics as standaloneDiagnosticsChannel,
} from "../contracts/runtimeChannels";
import { hwInput as hwInputChannel } from "../contracts/hardwareChannels";
import type { HwInputEvent } from "../contracts/hardware";
import { getStartupFlagsSnapshot } from "../runtime/startupContext.ts";
import { cleanCode, isPortWritable } from "./serial-utils.ts";

import {
  EDITOR_VERSION,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  type TransportContext,
  type ProtocolState,
  type JsonResponse,
  type WriteJsonRequestOptions,
  type SendJsonEvalOptions,
  type CaptureCallback,
} from "./types.ts";
import { serialBuffers, setSerialOutputBufferRouting } from "./stream-parser.ts";

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

// ── Serialised writer access ────────────────────────────────────────
// The Web Serial WritableStream only supports one active writer at a
// time.  All write paths must funnel through this queue so concurrent
// sends (heartbeat, queryTransportState, user eval) don't race.

let _writeChain: Promise<void> = Promise.resolve();

function serialWrite(port: SerialPort, data: Uint8Array): Promise<void> {
  const op = _writeChain.then(async () => {
    if (!port.writable) return;
    const writer = port.writable.getWriter();
    try {
      await writer.write(data);
    } finally {
      writer.releaseLock();
    }
  });
  _writeChain = op.catch(() => {});
  return op;
}

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
  // Clear handshake signal — new connection starts fresh.
  _handshakeResolve = null;
  _handshakePromise = null;
  setSerialOutputBufferRouting({});
  for (const buf of serialBuffers) buf.clear();
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
        "Heartbeat timeout — connection may be lost. Reconnect if needed.",
        "warn"
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

/** Per-attempt timeout for the hello handshake (ms). Spec §7: ≈700 ms. */
const HELLO_ATTEMPT_TIMEOUT_MS = 700;
/** Maximum hello attempts before surfacing a connection error. Spec §7: 8. */
const HELLO_MAX_ATTEMPTS = 8;

/**
 * Shared handshake completion signal. `sendHelloWithRetry` awaits this;
 * `retryHelloOnReady` resolves it when the device responds to an
 * out-of-band hello. Reset by `resetProtocolState` so the next connection
 * starts fresh.
 */
let _handshakeResolve: (() => void) | null = null;
let _handshakePromise: Promise<void> | null = null;

function createHandshakeSignal(): Promise<void> {
  _handshakePromise = new Promise<void>((resolve) => {
    _handshakeResolve = resolve;
  });
  return _handshakePromise;
}

function resolveHandshakeSignal(): void {
  if (_handshakeResolve) {
    _handshakeResolve();
    _handshakeResolve = null;
  }
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

/**
 * Complete the handshake once we have a successful hello response.
 * Resolves the shared signal so `sendHelloWithRetry` can exit cleanly.
 */
function completeHandshake(response: JsonResponse): void {
  console.log("[json-protocol] completeHandshake called with:", JSON.stringify(response).slice(0, 300));
  if (response.success && response.mode === "json") {
    protocolState.mode = "json";
    console.log("[json-protocol] Handshake SUCCESS — mode=json, fw=", response.fw);
    if (response.fw) {
      upgradeCheck(response.fw);
    }
    if (response.config) {
      protocolState.ioConfig = response.config;
      setSerialOutputBufferRouting(buildSerialOutputRouting(response.config));
      sendDefaultStreamConfig(response.config);
    }
    startHeartbeat();
    resolveHandshakeSignal();
  } else {
    console.warn("[json-protocol] JSON negotiation FAILED:", response.text || "no details", response);
  }
  dispatchProtocolReady();
}

/**
 * Send the hello request and wait for a response, with per-attempt timeout.
 * Rejects on timeout so the retry loop can move to the next attempt.
 */
async function sendHelloOnce(): Promise<JsonResponse> {
  return writeJsonRequest(buildHelloRequest(EDITOR_VERSION), {
    skipConsole: true,
    timeout: HELLO_ATTEMPT_TIMEOUT_MS,
  });
}

/**
 * Send hello immediately on port open and retry per spec §4.2.
 * Called by connector.ts after setSerialPort + setConnectedToModule.
 * Does not check firmware version — new spec always uses hello (§4.2).
 *
 * The loop races each attempt against a shared handshake-complete signal.
 * When `retryHelloOnReady` resolves that signal (device responded to the
 * out-of-band ready-triggered hello), the loop exits early without waiting
 * for the current attempt's timeout.
 */
export async function sendHelloWithRetry(): Promise<void> {
  protocolState.negotiationAttempted = true;
  const handshakeDone = createHandshakeSignal();
  console.log("[json-protocol] sendHelloWithRetry: starting hello attempts");

  for (let attempt = 1; attempt <= HELLO_MAX_ATTEMPTS; attempt += 1) {
    const mode = (): "negotiating" | "json" => protocolState.mode;
    if (mode() === "json") return;

    const port = serialport();
    if (!port?.writable) {
      console.log("[json-protocol] sendHelloWithRetry: port not writable, aborting");
      return;
    }

    console.log(`[json-protocol] hello attempt ${attempt}/${HELLO_MAX_ATTEMPTS}`);

    const attemptRace = Promise.race([
      sendHelloOnce().then((response) => {
        console.log("[json-protocol] hello response received:", JSON.stringify(response).slice(0, 200));
        if (mode() !== "json") completeHandshake(response);
      }),
      handshakeDone,
    ]);

    try {
      await attemptRace;
      if (mode() === "json") return;
    } catch (err) {
      console.log(`[json-protocol] hello attempt ${attempt} failed: ${String(err)}`);
      if (mode() === "json") return;
    }
  }

  if (protocolState.mode !== "json") {
    console.log("[json-protocol] All hello attempts exhausted — giving up");
    post(
      "uSEQ did not respond to hello. Try unplugging and reconnecting.",
      "error"
    );
    dispatchProtocolReady();
  }
}

/**
 * Re-send hello immediately on receiving an unsolicited `ready` frame (spec §4.2).
 * If the device just finished booting mid-handshake, this gets a fresh response
 * without waiting for the retry timer to fire.
 * If handshake is already complete, this is a no-op.
 */
export function retryHelloOnReady(): void {
  if (protocolState.mode === "json") {
    dbg("Received ready after handshake complete — ignoring (device may have rebooted)");
    return;
  }

  dbg("Received ready — re-sending hello immediately");
  writeJsonRequest(buildHelloRequest(EDITOR_VERSION), {
    skipConsole: true,
    timeout: HELLO_ATTEMPT_TIMEOUT_MS,
  })
    .then((response) => {
      if (protocolState.mode !== "json") {
        completeHandshake(response);
      }
    })
    .catch((err) => {
      dbg(`hello retry after ready failed: ${String(err)}`);
    });
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
  console.log(`[json-protocol] TX → ${message.trim().slice(0, 200)}`);

  return new Promise<JsonResponse>((resolve, reject) => {
    pending.resolve = resolve;
    pending.reject = reject;

    if (options.timeout && options.timeout > 0) {
      pending.timeoutId = setTimeout(() => {
        console.log(`[json-protocol] TIMEOUT: ${requestId} (${options.timeout}ms) — pending: [${Array.from(protocolState.pendingRequests.keys()).join(', ')}]`);
        protocolState.pendingRequests.delete(requestId);
        reject(new Error(`Request ${requestId} timed out`));
      }, options.timeout);
    }

    protocolState.pendingRequests.set(requestId, pending);

    serialWrite(port, encoder.encode(message))
      .catch((error: Error) => {
        console.log(`[json-protocol] serialWrite error for ${requestId}:`, error);
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

// ── JSON eval ────────────────────────────────────────────────────────

export function sendJsonEval(
  code: string,
  options: SendJsonEvalOptions = {}
): Promise<JsonResponse> {
  const { capture = null, force = false, skipConsole = false } = options;

  const port = serialport();
  if (!port || !port.writable) {
    return Promise.reject(new Error("Serial port is not writable"));
  }

  if (!force && protocolState.mode !== "json") {
    return Promise.reject(new Error("JSON protocol not active"));
  }

  return writeJsonRequest({ type: "eval", code }, { capture, skipConsole });
}

// ── Send live-input slot values ──────────────────────────────────────

/**
 * Send a `set-live-inputs` request to the device (spec §5.8).
 * Fire-and-forget: no requestId is added, the device applies what it can
 * and emits no response. Resolves as soon as the bytes are written.
 */
export function sendSetLiveInputs(
  slots: Record<string, number | boolean | string>
): Promise<void> {
  const port = serialport();
  if (!port || !port.writable) {
    return Promise.reject(new Error("Serial port is not writable"));
  }

  const message = `${JSON.stringify(buildSetLiveInputsRequest(slots))}\n`;
  return serialWrite(port, encoder.encode(message));
}

// ── Calibration senders (wire-protocol.md §5.11–§5.15) ──────────────

/** Default timeout for calibration requests (save-point writes can be slow). */
const CALIBRATE_TIMEOUT_MS = 5_000;

/**
 * Enter calibration takeover for one output (§5.10).
 *
 * Returns the response so the caller can read `status` (per-output
 * calibration state) and `success`. On rejection the promise still
 * resolves — the caller checks `success`.
 */
export function sendCalibrateBegin(output: string): Promise<JsonResponse> {
  if (protocolState.mode !== "json") {
    return Promise.reject(new Error("JSON protocol not active"));
  }

  return writeJsonRequest(buildCalibrateBeginRequest(output), {
    skipConsole: true,
    timeout: CALIBRATE_TIMEOUT_MS,
  });
}

/**
 * Drive the output to a target voltage (§5.11).
 */
export function sendCalibrateSetTarget(
  output: string,
  voltage: number
): Promise<JsonResponse> {
  if (protocolState.mode !== "json") {
    return Promise.reject(new Error("JSON protocol not active"));
  }

  return writeJsonRequest(buildCalibrateSetTargetRequest(output, voltage), {
    skipConsole: true,
    timeout: CALIBRATE_TIMEOUT_MS,
  });
}

/**
 * Apply a fine correction delta in cents (§5.12).
 *
 * The response may include `clampedOffset` if the firmware clamped the
 * accumulated value — the caller must snap its UI to match.
 */
export function sendCalibrateAdjust(
  output: string,
  delta: number
): Promise<JsonResponse> {
  if (protocolState.mode !== "json") {
    return Promise.reject(new Error("JSON protocol not active"));
  }

  return writeJsonRequest(buildCalibrateAdjustRequest(output, delta), {
    skipConsole: true,
    timeout: CALIBRATE_TIMEOUT_MS,
  });
}

/**
 * Stage a calibration point for the given octave (§5.13).
 *
 * The value is staged in RAM; it is not flushed to flash until
 * `sendCalibrateEnd(true)`.
 */
export function sendCalibrateSavePoint(
  output: string,
  octave: 0 | 1 | 2 | 3 | 4
): Promise<JsonResponse> {
  if (protocolState.mode !== "json") {
    return Promise.reject(new Error("JSON protocol not active"));
  }

  return writeJsonRequest(buildCalibrateSavePointRequest(output, octave), {
    skipConsole: true,
    timeout: CALIBRATE_TIMEOUT_MS,
  });
}

/**
 * Exit calibration takeover (§5.14).
 *
 * `commit: true`  — flush staged points to flash and resume normal operation.
 * `commit: false` — discard staged points, revert to pre-takeover calibration.
 */
export function sendCalibrateEnd(commit: boolean): Promise<JsonResponse> {
  if (protocolState.mode !== "json") {
    return Promise.reject(new Error("JSON protocol not active"));
  }

  return writeJsonRequest(buildCalibrateEndRequest(commit), {
    skipConsole: true,
    timeout: CALIBRATE_TIMEOUT_MS,
  });
}

// ── State snapshot query (state-sync.md §2) ─────────────────────────

const GET_STATE_TIMEOUT_MS = 5_000;

export function sendGetState(): Promise<JsonResponse> {
  if (protocolState.mode !== "json") {
    return Promise.reject(new Error("JSON protocol not active"));
  }

  return writeJsonRequest(buildGetStateRequest(), {
    skipConsole: true,
    timeout: GET_STATE_TIMEOUT_MS,
  });
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
  let cleanedCode = cleanCode(code);

  // Strip legacy @ prefix (immediate-eval marker from old protocol).
  // New wire protocol (§5.7): eval is immediate by default; quant:true opts
  // into quantised eval. The @ never crosses the wire.
  if (cleanedCode.startsWith("@")) {
    cleanedCode = cleanedCode.slice(1);
  }

  if (!cleanedCode.trim()) {
    return Promise.resolve({ success: true, text: "" });
  }

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
  return sendJsonEval(cleanedCode, { capture }).catch((error: Error) => {
    console.error("Failed to send JSON request to uSEQ", error);
    post(
      "Failed to send request to uSEQ. See browser console for details.",
      "error"
    );
    throw error;
  });
}

function handleNotConnected(): void {
  post("uSEQ not connected yet — make sure it's plugged in and click Connect", "warn");
  try {
    animateConnectChannel.publish(undefined);
  } catch (_e) {
    // no-op if window not available
  }
}

// ── Handle incoming JSON message ─────────────────────────────────────

export function handleJsonMessage(rawMessage: string): void {
  const trimmedMessage = rawMessage.trim();
  if (trimmedMessage.length === 0) return;

  console.log(`[json-protocol] handleJsonMessage: ${trimmedMessage.slice(0, 200)}`);

  let parsed: JsonResponse;
  try {
    parsed = JSON.parse(trimmedMessage);
  } catch (error) {
    console.error(
      "[json-protocol] Failed to parse JSON:",
      trimmedMessage,
      error
    );
    return;
  }

  // §4.2 / §5.5 — unsolicited `ready` frame: re-send hello immediately.
  if (parsed.type === "ready") {
    console.log("[json-protocol] Received 'ready' frame from device");
    retryHelloOnReady();
    return;
  }

  // §5.6 — unsolicited `log` envelope (replaces legacy TEXT/MSG_TO_EDITOR).
  if (parsed.type === "log") {
    const level = parsed.level as string | undefined;
    const text = parsed.text as string | undefined;
    if (text) {
      if (level === "error") {
        post(text, "error");
      } else if (level === "warn") {
        post(text, "warn");
      } else if (level === "notice") {
        // notice = prominent display (used by message-editor builtin)
        post(`[notice] ${text}`, "warn");
      } else {
        // debug / info / unknown → plain console output
        post(`uSEQ: ${text}`);
      }
    }
    return;
  }

  // §5.9 — unsolicited standalone `diagnostics` frame.
  if (parsed.type === "diagnostics") {
    const diags = parsed.diagnostics;
    if (Array.isArray(diags)) {
      try {
        standaloneDiagnosticsChannel.publish({ diagnostics: diags });
      } catch (dispatchError) {
        console.error("Failed to dispatch standalone diagnostics", dispatchError);
      }
    }
    return;
  }

  // §5.10 — unsolicited `hw-input` frame (hardware button/toggle/encoder/gate event).
  if (parsed.type === "hw-input") {
    const kind = parsed.kind as string | undefined;
    const id = parsed.id as string | undefined;
    const state = parsed.state as string | boolean | undefined;
    if (kind && id && state !== undefined) {
      try {
        hwInputChannel.publish({ kind, id, state, ts: parsed.ts as number | undefined } as HwInputEvent);
      } catch (dispatchError) {
        console.error("Failed to dispatch hw-input event", dispatchError);
      }
    } else {
      dbg("Received malformed hw-input frame (missing kind/id/state):", parsed);
    }
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
    console.log(`[json-protocol] Matched response for ${requestId}, success=${success}`);
    pending = protocolState.pendingRequests.get(requestId)!;
    protocolState.pendingRequests.delete(requestId);

    if (pending.timeoutId) {
      clearTimeout(pending.timeoutId);
    }
  } else if (requestId) {
    console.log(`[json-protocol] Response for ${requestId} has NO pending request (already timed out?)`);
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
      if (success === false) {
        post(displayText, "error");
      } else {
        post(`uSEQ: ${displayText}`);
      }
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
