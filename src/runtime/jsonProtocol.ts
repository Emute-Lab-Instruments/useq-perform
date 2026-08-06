export interface FirmwareVersion {
  major: number;
  minor: number;
  patch: number;
}

export interface IoChannelConfig {
  index: number;
  name: string;
}

export interface IoConfig {
  inputs?: IoChannelConfig[];
  outputs?: IoChannelConfig[];
  [key: string]: unknown;
}

export type StreamChannelDirection = "input" | "output";

export interface StreamChannelConfig {
  id: number;
  name: string;
  direction: StreamChannelDirection;
  enabled: boolean;
  maxRateHz: number;
}

export interface JsonHelloRequest {
  type: "hello";
  client: "editor";
  version: string;
}

export interface JsonHeartbeatRequest {
  type: "ping";
}

export interface JsonStreamConfigRequest {
  type: "stream-config";
  maxRateHz: number;
  channels: StreamChannelConfig[];
}

export interface JsonEvalRequest {
  type: "eval";
  code: string;
}

export interface JsonSetLiveInputsRequest {
  type: "set-live-inputs";
  slots: Record<string, number | boolean | string>;
}

// ── Calibration request shapes (wire-protocol.md §5.11–§5.15) ───────

export interface JsonCalibrateBeginRequest {
  type: "calibrate-begin";
  output: string;
}

export interface JsonCalibrateSetTargetRequest {
  type: "calibrate-set-target";
  output: string;
  voltage: number;
}

export interface JsonCalibrateAdjustRequest {
  type: "calibrate-adjust";
  output: string;
  delta: number;
}

export interface JsonCalibrateSavePointRequest {
  type: "calibrate-save-point";
  output: string;
  octave: 0 | 1 | 2 | 3 | 4;
}

export interface JsonCalibrateEndRequest {
  type: "calibrate-end";
  commit: boolean;
}

export interface JsonGetStateRequest {
  type: "get-state";
}

export interface JsonSetFailureModeRequest {
  type: "set-failure-mode";
  mode: "lkg" | "zero";
}

export interface JsonRescanModulesRequest {
  type: "rescan-modules";
}

export interface JsonDebugRequest {
  type: "debug";
  action: "capabilities" | "configure" | "query" | "status";
  [key: string]: unknown;
}

/**
 * Discriminated union of every editor → runtime JSON request shape.
 *
 * Used by the in-memory transport (WASM-mode parity) so the same request
 * shapes flow through both hardware and WASM paths. The wire driver in
 * `src/transport/json-protocol.ts` continues to accept loosely-shaped
 * `object` payloads for backwards compatibility, but new code should use
 * this typed union.
 */
export type JsonRequest =
  | JsonHelloRequest
  | JsonHeartbeatRequest
  | JsonStreamConfigRequest
  | JsonEvalRequest
  | JsonSetLiveInputsRequest
  | JsonCalibrateBeginRequest
  | JsonCalibrateSetTargetRequest
  | JsonCalibrateAdjustRequest
  | JsonCalibrateSavePointRequest
  | JsonCalibrateEndRequest
  | JsonGetStateRequest
  | JsonSetFailureModeRequest
  | JsonRescanModulesRequest
  | JsonDebugRequest;

export interface JsonResponseBody {
  requestId?: string;
  success?: boolean;
  type?: string;
  mode?: "json" | "legacy";
  fw?: string;
  config?: IoConfig;
  text?: string;
  console?: string;
  admin?: string;
  meta?: Record<string, unknown>;
}

export const JSON_PROTOCOL_MIN_VERSION: FirmwareVersion = Object.freeze({
  major: 1,
  minor: 2,
  patch: 0,
});

export const DEFAULT_STREAM_MAX_RATE_HZ = 100;
export const SERIAL_OUTPUT_TIME_NAME = "time";

export function versionAtLeast(
  version: FirmwareVersion | null,
  target: FirmwareVersion
): boolean {
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

export function isJsonEligibleVersion(version: FirmwareVersion | null): boolean {
  return versionAtLeast(version, JSON_PROTOCOL_MIN_VERSION);
}

export function buildHelloRequest(version: string): JsonHelloRequest {
  return {
    type: "hello",
    client: "editor",
    version,
  };
}

export function buildHeartbeatRequest(): JsonHeartbeatRequest {
  return { type: "ping" };
}

export function buildEvalRequest(code: string): JsonEvalRequest {
  return { type: "eval", code };
}

export function buildSetLiveInputsRequest(
  slots: Record<string, number | boolean | string>
): JsonSetLiveInputsRequest {
  return { type: "set-live-inputs", slots };
}

// ── Calibration request builders (wire-protocol.md §5.11–§5.15) ─────

export function buildCalibrateBeginRequest(
  output: string
): JsonCalibrateBeginRequest {
  return { type: "calibrate-begin", output };
}

export function buildCalibrateSetTargetRequest(
  output: string,
  voltage: number
): JsonCalibrateSetTargetRequest {
  return { type: "calibrate-set-target", output, voltage };
}

export function buildCalibrateAdjustRequest(
  output: string,
  delta: number
): JsonCalibrateAdjustRequest {
  return { type: "calibrate-adjust", output, delta };
}

export function buildCalibrateSavePointRequest(
  output: string,
  octave: 0 | 1 | 2 | 3 | 4
): JsonCalibrateSavePointRequest {
  return { type: "calibrate-save-point", output, octave };
}

export function buildCalibrateEndRequest(
  commit: boolean
): JsonCalibrateEndRequest {
  return { type: "calibrate-end", commit };
}

export function buildGetStateRequest(): JsonGetStateRequest {
  return { type: "get-state" };
}

export function buildDefaultStreamConfig(
  ioConfig: IoConfig,
  maxRateHz: number = DEFAULT_STREAM_MAX_RATE_HZ
): JsonStreamConfigRequest {
  const channels: StreamChannelConfig[] = [];

  // Subscribe to input channels (ain1, ain2) — these send on-change.
  // Time is always streamed by firmware at the configured rate.
  for (const input of ioConfig?.inputs ?? []) {
    channels.push({
      id: input.index,
      name: input.name,
      direction: "input",
      enabled: true,
      maxRateHz,
    });
  }

  // Subscribe to serial output channels (s1-s8) so the firmware streams the
  // hardware-authoritative output values. The drift detector (state-sync.md
  // §1.2) compares these against the WASM tick; without an output stream the
  // serial output buffers never fill and every drift sample is dropped. The
  // `time` output is excluded here — firmware streams it unconditionally.
  for (const output of ioConfig?.outputs ?? []) {
    if (output.name === SERIAL_OUTPUT_TIME_NAME) continue;
    channels.push({
      id: output.index,
      name: output.name,
      direction: "output",
      enabled: true,
      maxRateHz,
    });
  }

  return {
    type: "stream-config",
    maxRateHz,
    channels,
  };
}

/**
 * The default I/O config advertised by the WASM runtime in its `hello`
 * response. Mirrors the layout the firmware uses so downstream consumers
 * (stream routing, channel naming) see the same shape regardless of which
 * port the response came from.
 *
 * Output 1 is `time`; outputs 2..9 are `s1..s8`. Inputs are `ssin1..ssin8`
 * — the WASM runtime doesn't currently consume serial inputs, but
 * advertising them keeps the shape consistent and makes contract tests
 * trivially symmetric.
 */
export function buildWasmDefaultIoConfig(): IoConfig {
  const inputs: IoChannelConfig[] = Array.from({ length: 8 }, (_, i) => ({
    index: i + 1,
    name: `ssin${i + 1}`,
  }));
  const outputs: IoChannelConfig[] = [
    { index: 1, name: "time" },
    ...Array.from({ length: 8 }, (_, i) => ({
      index: i + 2,
      name: `s${i + 1}`,
    })),
  ];
  return { inputs, outputs };
}

/**
 * Map from firmware stream channel name → WASM g_hw_inputs[] index.
 *
 * The compiler maps ain1→8, ain2→9, in1→0, in2→1 (graph_builder.cpp
 * resolve_hardware_input). Firmware advertises these as ssin1, ssin2, etc.
 */
export const STREAM_NAME_TO_HW_INPUT: Record<string, number> = {
  ssin1: 8,   // ain1 → INP_AI1
  ssin2: 9,   // ain2 → INP_AI2
};

/**
 * Build a mapping from firmware stream channel wire-ID → WASM hw_input index.
 * Only maps input channels that have a known WASM hw_input index.
 */
export function buildInputChannelRouting(
  ioConfig: IoConfig | null | undefined
): Record<number, number> {
  const routing: Record<number, number> = {};
  for (const input of ioConfig?.inputs ?? []) {
    const hwIndex = STREAM_NAME_TO_HW_INPUT[input.name];
    if (hwIndex !== undefined) {
      routing[input.index] = hwIndex;
    }
  }
  return routing;
}

export function buildSerialOutputRouting(ioConfig: IoConfig | null | undefined): Record<number, number> {
  const routing: Record<number, number> = {};

  for (const output of ioConfig?.outputs ?? []) {
    if (!Number.isInteger(output.index) || output.index < 1) {
      continue;
    }

    if (output.name === SERIAL_OUTPUT_TIME_NAME) {
      routing[output.index] = 0;
      continue;
    }

    const match = /^s([1-9]\d*)$/.exec(output.name);
    if (!match) {
      continue;
    }

    routing[output.index] = Number.parseInt(match[1], 10);
  }

  return routing;
}
