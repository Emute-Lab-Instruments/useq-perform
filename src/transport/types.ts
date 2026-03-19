/**
 * Transport layer types, interfaces, and constants.
 *
 * These are shared across the connector, protocol drivers, and stream parser.
 */

import type { CircularBuffer } from "../lib/CircularBuffer.ts";
import type { IoConfig } from "../runtime/jsonProtocol.ts";

// ── Wire constants ───────────────────────────────────────────────────

export const MESSAGE_START_MARKER = 31;

export const MESSAGE_TYPES = {
  STREAM: 0,
  JSON: 101,
  // Any other value is treated as TEXT
} as const;

// ── Serial read mode constants ───────────────────────────────────────

export const SERIAL_READ_MODES = {
  ANY: 0,
  TEXT: 1,
  SERIALSTREAM: 2,
  JSON: 3,
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
  /** Shared capture state used by the stream parser for text responses. */
  serialVars: SerialVars;
}

// ── Callback / request types ─────────────────────────────────────────

/** Capture callback type for serial responses */
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
  exec?: string | null;
}

// ── Protocol state bag ───────────────────────────────────────────────

export interface ProtocolState {
  mode: "negotiating" | "json";
  negotiationAttempted: boolean;
  requestIdCounter: number;
  pendingRequests: Map<string, PendingRequest>;
  ioConfig: IoConfig | null;
  heartbeatInterval: ReturnType<typeof setInterval> | null;
}

// ── Serial vars (legacy capture mechanism) ───────────────────────────

export interface SerialVars {
  capture: boolean;
  captureFunc: CaptureCallback | null;
}

// ── Buffer map function type ─────────────────────────────────────────

export type BufferMapFunction = (buffer: CircularBuffer) => void;
