import { post } from "../utils/consoleStore.ts";
import { dbg } from "../lib/debug.ts";

interface ConnectedFirmwareVersion {
  major: number;
  minor: number;
  patch: number;
  string: string;
}

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

export let currentVersion: ConnectedFirmwareVersion | null = null;

export function upgradeCheck(versionMsg: unknown): void {
  currentVersion = parseVersion(versionMsg);
  const versionLabel = currentVersion?.string ?? String(versionMsg ?? "unknown");
  post(
    `<span style="color: var(--accent-color); font-weight: bold; display: inline;">**Connected to uSEQ (v${versionLabel})**</span>`
  );
}
