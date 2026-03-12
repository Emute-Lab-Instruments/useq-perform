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

export const JSON_PROTOCOL_MIN_VERSION: FirmwareVersion = Object.freeze({
  major: 1,
  minor: 2,
  patch: 0,
});

export const DEFAULT_STREAM_MAX_RATE_HZ = 30;
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

export function buildDefaultStreamConfig(
  ioConfig: IoConfig,
  maxRateHz: number = DEFAULT_STREAM_MAX_RATE_HZ
): JsonStreamConfigRequest {
  const channels: StreamChannelConfig[] = [];

  for (const input of ioConfig?.inputs ?? []) {
    channels.push({
      id: input.index,
      name: input.name,
      direction: "input",
      enabled: true,
      maxRateHz,
    });
  }

  for (const output of ioConfig?.outputs ?? []) {
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
