/**
 * Pre-1.2 firmware compatibility adapter.
 *
 * Legacy uSEQ firmware accepts raw ModuLisp over USB serial. A leading `@`
 * means immediate evaluation; an unprefixed form is quantised. Replies are
 * framed as `[0x1f][0x20|0x64]...\r\n` and are routed here by
 * `stream-parser.ts`.
 *
 * This adapter is deliberately small and stateful in one place. It does not
 * emulate the old interpreter and it does not add legacy branches to the JSON
 * request lifecycle. The attached hardware remains authoritative.
 */

import type { CaptureCallback } from "./types.ts";

// The newline makes this one complete request for both generations: old
// firmware reads through `\n`, while JSON firmware can reject and discard the
// line without concatenating it with the subsequent hello.
export const LEGACY_FIRMWARE_PROBE = "@(useq-report-firmware-info)\n";

export interface LegacyFirmwareIdentity {
  version: string;
  raw: string;
}

type WriteBytes = (data: Uint8Array) => Promise<void>;

const encoder = new TextEncoder();
const VERSION_PATTERN = /(?:uSEQ\s+Firmware\s+)?v?(\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?)/i;

let pendingCapture: CaptureCallback | null = null;
let pendingProbeResolve: ((identity: LegacyFirmwareIdentity) => void) | null = null;

export function parseLegacyFirmwareIdentity(
  message: string,
): LegacyFirmwareIdentity | null {
  const match = VERSION_PATTERN.exec(message.trim());
  if (!match) return null;
  return { version: match[1], raw: message.trim() };
}

export function resetLegacyProtocol(): void {
  pendingCapture = null;
  pendingProbeResolve = null;
}

/**
 * Route one framed legacy text message. Returns its parsed firmware identity
 * when it is the response to the negotiation probe.
 */
export function handleLegacyText(
  message: string,
): { captured: boolean; identity: LegacyFirmwareIdentity | null } {
  const identity = parseLegacyFirmwareIdentity(message);
  if (identity && pendingProbeResolve) {
    const resolve = pendingProbeResolve;
    pendingProbeResolve = null;
    resolve(identity);
    return { captured: true, identity };
  }

  if (pendingCapture) {
    const capture = pendingCapture;
    pendingCapture = null;
    capture(message);
    return { captured: true, identity };
  }

  return { captured: false, identity };
}

/** Write raw ModuLisp exactly as legacy firmware expects it. */
export async function writeLegacyCode(
  code: string,
  write: WriteBytes,
  capture: CaptureCallback | null = null,
): Promise<void> {
  if (capture && pendingCapture) {
    throw new Error("A legacy firmware response is already being captured");
  }
  if (capture) pendingCapture = capture;

  try {
    await write(encoder.encode(code));
  } catch (error) {
    if (capture && pendingCapture === capture) pendingCapture = null;
    throw error;
  }
}

/**
 * Probe for a pre-1.2 device before sending any JSON. Legacy firmware would
 * otherwise interpret a JSON hello as scheduled ModuLisp, so negotiation must
 * be ordered rather than symmetric.
 */
export async function probeLegacyFirmware(
  write: WriteBytes,
  timeoutMs: number,
): Promise<LegacyFirmwareIdentity | null> {
  if (pendingProbeResolve) return null;

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const response = new Promise<LegacyFirmwareIdentity | null>((resolve) => {
    pendingProbeResolve = resolve;
    timeoutId = setTimeout(() => {
      pendingProbeResolve = null;
      resolve(null);
    }, timeoutMs);
  });

  try {
    await write(encoder.encode(LEGACY_FIRMWARE_PROBE));
    return await response;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    pendingProbeResolve = null;
  }
}
