import { post } from "../utils/consoleStore.ts";
import { dbg } from "../lib/debug.ts";

interface ConnectedFirmwareVersion {
  major: number;
  minor: number;
  patch: number;
  string: string;
}

export const MIN_FIRMWARE_VERSION = { major: 1, minor: 2, patch: 0 } as const;

const VERSION_PATTERN = /(\d+)\.(\d+)(?:\.(\d+))?/;

function parseVersion(versionString: unknown): ConnectedFirmwareVersion | null {
  const text = String(versionString ?? "").trim();
  const groups = VERSION_PATTERN.exec(text);
  if (!groups) {
    dbg(`upgradeCheck: could not parse firmware version "${text}"`);
    return null;
  }

  return {
    major: Number.parseInt(groups[1], 10),
    minor: Number.parseInt(groups[2], 10),
    patch: Number.parseInt(groups[3] ?? "0", 10),
    string: text,
  };
}

/**
 * Returns true if `v` meets the minimum firmware version floor.
 */
export function meetsMinimumVersion(v: ConnectedFirmwareVersion): boolean {
  if (v.major !== MIN_FIRMWARE_VERSION.major) return v.major > MIN_FIRMWARE_VERSION.major;
  if (v.minor !== MIN_FIRMWARE_VERSION.minor) return v.minor > MIN_FIRMWARE_VERSION.minor;
  return v.patch >= MIN_FIRMWARE_VERSION.patch;
}

export let currentVersion: ConnectedFirmwareVersion | null = null;

export function upgradeCheck(versionMsg: unknown): void {
  currentVersion = parseVersion(versionMsg);
  const versionLabel = currentVersion?.string ?? String(versionMsg ?? "unknown");
  post(`Connected to uSEQ (v${versionLabel})`);
}
