/**
 * Transport layer types, interfaces, and constants.
 *
 * These are shared across the connector, protocol drivers, and stream parser.
 */

import type { IoConfig } from "../runtime/jsonProtocol.ts";
import type { UseqDiagnostic } from "../contracts/runtimeTypes.ts";

// ── Wire constants ───────────────────────────────────────────────────

export const MESSAGE_START_MARKER = 31;

export const MESSAGE_TYPES = {
  STREAM: 0,
  /** Pre-1.2 framed console text. */
  LEGACY_TEXT: 32,
  /** Pre-1.2 framed message-editor output. */
  LEGACY_MESSAGE_TO_EDITOR: 100,
} as const;

// ── Serial read mode constants ───────────────────────────────────────

export const SERIAL_READ_MODES = {
  ANY: 0,
  LEGACY_TEXT: 1,
  SERIALSTREAM: 2,
  /** Bare JSON mode: `{...}\n` with no 0x1F prefix (spec §3.3). */
  BARE_JSON: 4,
} as const;

export type SerialReadMode =
  (typeof SERIAL_READ_MODES)[keyof typeof SERIAL_READ_MODES];

// ── Editor/protocol constants ────────────────────────────────────────

export const EDITOR_VERSION = "1.2.0";
export const HEARTBEAT_INTERVAL_MS = 60_000;
export const HEARTBEAT_TIMEOUT_MS = 10_000;

/**
 * Default timeout for JSON `eval` requests (wire-protocol.md §5.7).
 *
 * Eval responses are must-deliver, so a healthy device answers quickly; a
 * reply that is still missing after 10 s means the device is silent, the
 * line was dropped (e.g. it exceeded the receive buffer), or the cable was
 * pulled without a disconnect event. Without this bound a pending eval
 * would never settle (blocking the Promise.all fan-out in
 * runtimeCodeEvaluation) and its entry in `pendingRequests` would suppress
 * every heartbeat tick until disconnect.
 */
export const EVAL_TIMEOUT_MS = 10_000;

/**
 * Maximum serialised request line length in bytes, terminator included in
 * the device budget: the firmware RX ring is 2048 bytes and a line without
 * a newline is dropped with an unsolicited "Message too long" log that
 * carries no requestId (serial_protocol.cpp). 2047 payload bytes + "\n"
 * exactly fill one buffer.
 */
export const MAX_REQUEST_LINE_BYTES = 2047;

// ── Transport context ────────────────────────────────────────────────

/**
 * Dependencies injected into the transport layer at init time.
 * Replaces the old setter-based dependency injection pattern.
 */
export interface TransportContext {
  /** Returns the current serial port, or null if not connected. */
  getSerialPort: () => SerialPort | null;
  /** Broadcasts a connection-state change to the rest of the app. */
  emitConnectionChanged: () => void;
}

// ── Callback / request types ─────────────────────────────────────────

/** Capture callback type for JSON request responses */
export type CaptureCallback = (response: string) => void;

/** Serial processing state threaded through the stream parser */
export interface SerialProcessingState {
  mode: number;
  processed: boolean;
  remainingBytes: Uint8Array;
}

/** Pending JSON request state */
export interface PendingRequest {
  resolve: ((value: any) => void) | null;
  reject: ((reason: any) => void) | null;
  capture: CaptureCallback | null;
  skipConsole: boolean;
  timeoutId: ReturnType<typeof setTimeout> | null;
}

/** JSON protocol response -- closed set of fields; no index signature. */
export interface JsonResponse {
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
  /** Independent wire-protocol version advertised by current firmware. */
  protocol?: number;
  /** Build target used to select a safe UF2 artifact. */
  target?: string;
  /** Named firmware capabilities; unknown names are ignored. */
  capabilities?: string[];
  /** I2C modules discovered by the main module at startup or explicit rescan. */
  modules?: ConnectedModuleIdentity[];
  /** Diagnostics embedded in eval responses (spec §5.7). */
  diagnostics?: UseqDiagnostic[];
  /** Unsolicited log level (spec §5.6). */
  level?: string;
  /** Hardware input kind (spec §5.10 `hw-input`). */
  kind?: string;
  /** Hardware input id (spec §5.10 `hw-input`). */
  id?: string;
  /** Hardware input state (spec §5.10 `hw-input`), or state-snapshot payload (state-sync.md §2). */
  state?: string | boolean | import("../contracts/runtimeTypes").StateSnapshot;
  /** Device-side timestamp in ms (spec §5.10 `hw-input`). */
  ts?: number;
  /** Firmware's authoritative cumulative offset in cents (spec §5.13 `calibrate-adjust`). */
  clampedOffset?: number;
  /** Per-output calibration status (spec §5.11 `calibrate-begin` response). */
  status?: string | { kind: string; date?: string; savedOctaves?: number[] };
  /** Human-readable error reason (calibrate-* rejections, spec §5.16). */
  error?: string;
}

/** Options for writeJsonRequest */
export interface WriteJsonRequestOptions {
  capture?: CaptureCallback | null;
  skipConsole?: boolean;
  timeout?: number;
}

/** Options for sendJsonEval */
export interface SendJsonEvalOptions {
  capture?: CaptureCallback | null;
  force?: boolean;
  skipConsole?: boolean;
  /** Override the default eval response timeout (EVAL_TIMEOUT_MS). */
  timeout?: number;
}

// ── Protocol state bag ───────────────────────────────────────────────

export interface ProtocolState {
  mode: "negotiating" | "legacy" | "json";
  negotiationAttempted: boolean;
  requestIdCounter: number;
  pendingRequests: Map<string, PendingRequest>;
  ioConfig: IoConfig | null;
  heartbeatInterval: ReturnType<typeof setInterval> | null;
  firmwareVersion: string | null;
  protocolVersion: number | null;
  hardwareTarget: string | null;
  capabilities: string[];
  modules: ConnectedModuleIdentity[];
}

export interface ConnectedModuleIdentity {
  kind: "output-expander" | string;
  address: number;
  identityStatus: "verified" | "unidentified-prototype" | string;
  product: string;
  target?: string;
  connectedVia?: "i2c" | "usb" | string;
  firmware?: string;
  protocol?: number;
  hardwareRevision?: string;
  assemblyVariant?: string;
  batch?: string;
  serial?: string;
  manufactured?: string;
  mcu?: "rp2040" | "rp2350" | "unknown" | string;
  updateTransport: "usb" | "i2c-only" | string;
  autoUpdateSafe: boolean;
}

export interface ConnectedFirmwareIdentity {
  protocolMode: "legacy" | "json";
  firmwareVersion: string | null;
  protocolVersion: number | null;
  hardwareTarget: string | null;
  capabilities: readonly string[];
  modules: readonly ConnectedModuleIdentity[];
}
