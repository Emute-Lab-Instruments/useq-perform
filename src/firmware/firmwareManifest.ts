import { compareVersions, parseVersionString } from "../lib/versionUtils.ts";

export const FIRMWARE_BETA_MANIFEST_PATH = "/firmware/beta/manifest.json";
export const FIRMWARE_BETA_LANDING_PATH = "/firmware/beta/";

export const FIRMWARE_TARGETS = [
  "musicthing",
  "hardware_v0_2",
  "hardware_v1_0",
  "expander_aout08_v0_1",
] as const;

export type FirmwareTarget = (typeof FIRMWARE_TARGETS)[number];

export interface FirmwareArtifact {
  target: FirmwareTarget;
  label: string;
  url: string;
  sha256: string;
  size: number;
}

export interface FirmwareReleaseManifest {
  schemaVersion: 1;
  channel: "beta" | "stable";
  version: string;
  publishedAt: string;
  notesUrl?: string;
  artifacts: FirmwareArtifact[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSafeReleaseUrl(value: unknown, baseUrl: string): value is string {
  if (typeof value !== "string" || !value) return false;
  try {
    const base = new URL(baseUrl);
    const url = new URL(value, base);
    return (
      url.origin === base.origin &&
      url.pathname.startsWith("/firmware/beta/") &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

export function parseFirmwareManifest(
  value: unknown,
  baseUrl: string,
): FirmwareReleaseManifest {
  if (!isRecord(value)) throw new Error("Firmware manifest must be an object");
  if (value.schemaVersion !== 1) throw new Error("Unsupported firmware manifest schema");
  if (value.channel !== "beta" && value.channel !== "stable") {
    throw new Error("Firmware manifest has an invalid channel");
  }

  const parsedVersion = parseVersionString(value.version);
  if (
    typeof value.version !== "string" ||
    !parsedVersion ||
    parsedVersion.raw !== value.version
  ) {
    throw new Error("Firmware manifest version must be canonical SemVer");
  }
  if (value.channel === "beta" && parsedVersion.prerelease?.[0] !== "beta") {
    throw new Error("Beta manifest versions must use -beta.N");
  }
  if (typeof value.publishedAt !== "string" || !Number.isFinite(Date.parse(value.publishedAt))) {
    throw new Error("Firmware manifest publishedAt must be an ISO date");
  }
  if (!Array.isArray(value.artifacts) || value.artifacts.length === 0) {
    throw new Error("Firmware manifest must contain at least one artifact");
  }

  const targets = new Set<string>();
  const artifacts = value.artifacts.map((candidate): FirmwareArtifact => {
    if (!isRecord(candidate)) throw new Error("Firmware artifact must be an object");
    if (!FIRMWARE_TARGETS.includes(candidate.target as FirmwareTarget)) {
      throw new Error(`Unknown firmware target: ${String(candidate.target)}`);
    }
    if (targets.has(candidate.target as string)) {
      throw new Error(`Duplicate firmware target: ${String(candidate.target)}`);
    }
    targets.add(candidate.target as string);
    if (typeof candidate.label !== "string" || !candidate.label.trim()) {
      throw new Error("Firmware artifact label is required");
    }
    if (!isSafeReleaseUrl(candidate.url, baseUrl)) {
      throw new Error("Firmware artifact URL must be same-origin under /firmware/beta/");
    }
    if (typeof candidate.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(candidate.sha256)) {
      throw new Error("Firmware artifact sha256 must be lowercase hexadecimal");
    }
    if (!Number.isSafeInteger(candidate.size) || (candidate.size as number) <= 0) {
      throw new Error("Firmware artifact size must be a positive integer");
    }
    return candidate as unknown as FirmwareArtifact;
  });

  if (value.notesUrl !== undefined && !isSafeReleaseUrl(value.notesUrl, baseUrl)) {
    throw new Error("Firmware notes URL must be same-origin under /firmware/beta/");
  }

  return {
    schemaVersion: 1,
    channel: value.channel,
    version: value.version,
    publishedAt: value.publishedAt,
    ...(value.notesUrl ? { notesUrl: value.notesUrl as string } : {}),
    artifacts,
  };
}

export async function fetchFirmwareManifest(
  fetchFn: typeof fetch = fetch,
  manifestUrl: string = FIRMWARE_BETA_MANIFEST_PATH,
  baseUrl: string = typeof window === "undefined"
    ? "https://useq.emutelabinstruments.co.uk/"
    : window.location.href,
): Promise<FirmwareReleaseManifest | null> {
  const response = await fetchFn(manifestUrl, {
    cache: "no-store",
    credentials: "same-origin",
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Firmware manifest request failed (${response.status})`);
  return parseFirmwareManifest(await response.json(), baseUrl);
}

export function shouldOfferFirmwareUpdate(
  currentVersion: string | null,
  manifest: FirmwareReleaseManifest,
): boolean {
  if (!currentVersion) return true;
  const current = parseVersionString(currentVersion);
  const available = parseVersionString(manifest.version);
  if (!current || !available) return true;
  return compareVersions(available, current) > 0;
}

export function artifactForTarget(
  manifest: FirmwareReleaseManifest,
  target: string | null,
): FirmwareArtifact | null {
  if (!target) return null;
  return manifest.artifacts.find((artifact) => artifact.target === target) ?? null;
}

export async function verifyFirmwareArtifact(
  bytes: ArrayBuffer,
  expectedSha256: string,
): Promise<boolean> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const actual = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return actual === expectedSha256;
}
