/**
 * Transport layer types, interfaces, and constants.
 *
 * These are shared across the connector, protocol drivers, and stream parser.
 */

import type { CircularBuffer } from "../lib/CircularBuffer.ts";
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
  /** Transitional framed JSON accepted on input only. */
  FRAMED_JSON: 101,
} as const;

// ── Serial read mode constants ───────────────────────────────────────

export const SERIAL_READ_MODES = {
  ANY: 0,
  LEGACY_TEXT: 1,
  SERIALSTREAM: 2,
  FRAMED_JSON: 3,
  /** Bare JSON mode: `{...}\n` with no 0x1F prefix (spec §3.3). */
  BARE_JSON: 4,
} as const;

export type SerialReadMode =
  (typeof SERIAL_READ_MODES)[keyof typeof SERIAL_READ_MODES];

// ── Editor/protocol constants ────────────────────────────────────────

export const EDITOR_VERSION = "1.2.0";
export const HEARTBEAT_INTERVAL_MS = 60_000;
export const HEARTBEAT_TIMEOUT_MS = 10_000;

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
  status?: { kind: string; date?: string; savedOctaves?: number[] };
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
}

export interface ConnectedFirmwareIdentity {
  protocolMode: "legacy" | "json";
  firmwareVersion: string | null;
  protocolVersion: number | null;
  hardwareTarget: string | null;
  capabilities: readonly string[];
}

// ── Buffer map function type ─────────────────────────────────────────

export type BufferMapFunction = (buffer: CircularBuffer) => void;
