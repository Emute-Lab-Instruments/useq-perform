/**
 * Profile Import/Export — pure data module.
 *
 * Serialises and deserialises keybinding profiles for sharing via JSON files
 * or URL parameters.  No DOM dependencies.
 *
 * See docs/KEYBINDING_SYSTEM.md § Profile System — Import/Export.
 */

import { actions, type ActionId } from "./actions.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExportedProfile {
  version: 1;
  name: string;
  baseProfile: string;
  overrides: Record<string, string>; // ActionId → key
  gamepadOverrides?: Record<string, string[]>; // ActionId → combo
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function isActionId(value: unknown): value is ActionId {
  return typeof value === "string" && value in actions;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(
  value: unknown,
): value is Record<string, string> {
  if (!isObject(value)) return false;
  for (const v of Object.values(value)) {
    if (typeof v !== "string") return false;
  }
  return true;
}

function isStringArrayRecord(
  value: unknown,
): value is Record<string, string[]> {
  if (!isObject(value)) return false;
  for (const v of Object.values(value)) {
    if (!Array.isArray(v) || v.some((item) => typeof item !== "string")) {
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export function exportProfile(opts: {
  name: string;
  profile: string;
  overrides: Record<string, string>;
  gamepadOverrides?: Record<string, string[]>;
}): ExportedProfile {
  return {
    version: 1,
    name: opts.name,
    baseProfile: opts.profile,
    overrides: opts.overrides,
    ...(opts.gamepadOverrides ? { gamepadOverrides: opts.gamepadOverrides } : {}),
  };
}

// ---------------------------------------------------------------------------
// Import (with validation)
// ---------------------------------------------------------------------------

type ImportResult =
  | { ok: true; profile: ExportedProfile }
  | { ok: false; error: string };

export function importProfile(data: unknown): ImportResult {
  if (!isObject(data)) {
    return { ok: false, error: "Expected an object" };
  }

  // -- version ----------------------------------------------------------------
  if (data.version !== 1) {
    return { ok: false, error: `Unsupported version: ${String(data.version)}` };
  }

  // -- name -------------------------------------------------------------------
  if (typeof data.name !== "string" || data.name.length === 0) {
    return { ok: false, error: "Missing or invalid 'name' (expected non-empty string)" };
  }

  // -- baseProfile ------------------------------------------------------------
  if (typeof data.baseProfile !== "string" || data.baseProfile.length === 0) {
    return {
      ok: false,
      error: "Missing or invalid 'baseProfile' (expected non-empty string)",
    };
  }

  // -- overrides --------------------------------------------------------------
  if (!isStringRecord(data.overrides)) {
    return {
      ok: false,
      error: "Missing or invalid 'overrides' (expected Record<string, string>)",
    };
  }

  const invalidKeys = Object.keys(data.overrides).filter((k) => !isActionId(k));
  if (invalidKeys.length > 0) {
    return {
      ok: false,
      error: `Unknown action IDs in overrides: ${invalidKeys.join(", ")}`,
    };
  }

  // -- gamepadOverrides (optional) -------------------------------------------
  let gamepadOverrides: Record<string, string[]> | undefined;

  if (data.gamepadOverrides !== undefined) {
    if (!isStringArrayRecord(data.gamepadOverrides)) {
      return {
        ok: false,
        error:
          "Invalid 'gamepadOverrides' (expected Record<string, string[]>)",
      };
    }

    const invalidGamepadKeys = Object.keys(data.gamepadOverrides).filter(
      (k) => !isActionId(k),
    );
    if (invalidGamepadKeys.length > 0) {
      return {
        ok: false,
        error: `Unknown action IDs in gamepadOverrides: ${invalidGamepadKeys.join(", ")}`,
      };
    }

    gamepadOverrides = data.gamepadOverrides as Record<string, string[]>;
  }

  // -- Assemble validated profile (strip unknown fields) ----------------------
  const profile: ExportedProfile = {
    version: 1,
    name: data.name as string,
    baseProfile: data.baseProfile as string,
    overrides: data.overrides as Record<string, string>,
    ...(gamepadOverrides ? { gamepadOverrides } : {}),
  };

  return { ok: true, profile };
}

// ---------------------------------------------------------------------------
// JSON serialisation
// ---------------------------------------------------------------------------

export function profileToJson(profile: ExportedProfile): string {
  return JSON.stringify(profile, null, 2);
}

export function profileFromJson(json: string): ImportResult {
  try {
    return importProfile(JSON.parse(json));
  } catch {
    return { ok: false, error: "Invalid JSON" };
  }
}

// ---------------------------------------------------------------------------
// URL encoding / decoding
// ---------------------------------------------------------------------------

export function profileToUrl(
  profile: ExportedProfile,
  baseUrl: string,
): string {
  const encoded = btoa(JSON.stringify(profile));
  const url = new URL(baseUrl);
  url.searchParams.set("keymap", encoded);
  return url.toString();
}

export function profileFromUrl(url: string): ImportResult {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: "Invalid URL" };
  }

  const encoded = parsed.searchParams.get("keymap");
  if (!encoded) {
    return { ok: false, error: "No keymap parameter in URL" };
  }

  try {
    const json = atob(encoded);
    return profileFromJson(json);
  } catch {
    return { ok: false, error: "Invalid base64 encoding" };
  }
}

// ---------------------------------------------------------------------------
// Settings integration
// ---------------------------------------------------------------------------

export function profileToSettings(profile: ExportedProfile): {
  profile: string;
  overrides: Record<string, string>;
  gamepadOverrides?: Record<string, string[]>;
} {
  return {
    profile: profile.baseProfile,
    overrides: profile.overrides,
    ...(profile.gamepadOverrides
      ? { gamepadOverrides: profile.gamepadOverrides }
      : {}),
  };
}
