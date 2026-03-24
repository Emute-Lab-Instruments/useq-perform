/**
 * Centralised persistence service wrapping localStorage.
 *
 * All localStorage access in the application should eventually go through
 * this module. It provides:
 *
 * - A typed registry of every known storage key
 * - JSON parse error handling (returns fallback, never crashes)
 * - A single place that respects the `?nosave` URL parameter
 */

import { isLocalStorageBypassedInStartupContext } from "../runtime/startupContext.ts";

// ---------------------------------------------------------------------------
// Key Registry
// ---------------------------------------------------------------------------

/**
 * Every localStorage key used by the application.
 * Prevents typos and makes it easy to discover what is persisted.
 */
export const PERSISTENCE_KEYS = {
  // Settings
  settings: "uSEQ-Perform-User-Settings",
  editorCode: "uSEQ-Perform-User-Code",

  // Serial
  serialPortInfo: "uSEQ-Serial-Port-Info",

  // Editor autosave
  editorContent: "editorContent",
  editorProbes: "uSEQ-Perform-Editor-Probes",

  // Reference panel
  referenceStarred: "moduLispReference:starredFunctions",
  referenceExpanded: "moduLispReference:expandedFunctions",
  referenceVersion: "moduLispReference:targetVersion",

  // Snippets
  snippets: "codeSnippets:snippets",
  snippetsStarred: "codeSnippets:starred",
  snippetsNextId: "codeSnippets:nextId",

  // Help / onboarding
  experienceLevel: "useqExperienceLevel",

  // DevMode
  devModeState: "uSEQ-Perform-DevMode-State",

  // Legacy migration keys (will be removed after migration)
  legacyEditorConfig: "editorConfig",
  legacySettings: "useqConfig",
  legacyCode: "useqcode",
} as const;

export type PersistenceKey =
  (typeof PERSISTENCE_KEYS)[keyof typeof PERSISTENCE_KEYS];

// ---------------------------------------------------------------------------
// nosave detection
// ---------------------------------------------------------------------------

/**
 * Returns true when persistence should be completely disabled.
 * Checks the startupContext flag first, then falls back to URL params.
 */
function isNosaveActive(): boolean {
  // startupContext is the canonical source — it is populated at boot from
  // URL params and is always available (including in non-browser contexts).
  if (isLocalStorageBypassedInStartupContext()) {
    return true;
  }

  // Belt-and-suspenders: if startupContext hasn't been initialised yet
  // (e.g. very early in boot) we fall back to reading the URL directly.
  if (typeof window !== "undefined") {
    try {
      return new URLSearchParams(window.location.search).has("nosave");
    } catch {
      return false;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Core API
// ---------------------------------------------------------------------------

/**
 * Load a value from localStorage, parsed as JSON.
 *
 * @param key       The storage key (use a value from `PERSISTENCE_KEYS`).
 * @param fallback  Value to return when the key is missing or JSON is corrupt.
 *                  Defaults to `null`.
 * @returns The parsed value, or `fallback` on any failure.
 */
export function load<T>(key: string, fallback: T): T;
export function load<T>(key: string): T | null;
export function load<T>(key: string, fallback?: T): T | null {
  if (typeof window === "undefined") {
    return fallback ?? null;
  }

  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) {
      return fallback ?? null;
    }
    return JSON.parse(raw) as T;
  } catch {
    console.warn(`[persistence] Failed to parse key "${key}", returning fallback.`);
    return fallback ?? null;
  }
}

/**
 * Load a raw (non-JSON) string value from localStorage.
 *
 * Use this for keys that store plain strings (not JSON-encoded), such as
 * `editorContent` or `editorCode`.
 */
export function loadRaw(key: string, fallback: string): string;
export function loadRaw(key: string): string | null;
export function loadRaw(key: string, fallback?: string): string | null {
  if (typeof window === "undefined") {
    return fallback ?? null;
  }

  const raw = window.localStorage.getItem(key);
  return raw ?? fallback ?? null;
}

/**
 * Save a value to localStorage as JSON.
 *
 * When `?nosave` is active this is a silent no-op.
 */
export function save(key: string, value: unknown): void {
  if (typeof window === "undefined" || isNosaveActive()) {
    return;
  }

  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn(`[persistence] Failed to save key "${key}".`, e);
  }
}

/**
 * Save a raw string value (no JSON.stringify) to localStorage.
 *
 * When `?nosave` is active this is a silent no-op.
 */
export function saveRaw(key: string, value: string): void {
  if (typeof window === "undefined" || isNosaveActive()) {
    return;
  }

  try {
    window.localStorage.setItem(key, value);
  } catch (e) {
    console.warn(`[persistence] Failed to saveRaw key "${key}".`, e);
  }
}

/**
 * Remove a key from localStorage.
 *
 * When `?nosave` is active this is a silent no-op.
 */
export function remove(key: string): void {
  if (typeof window === "undefined" || isNosaveActive()) {
    return;
  }

  window.localStorage.removeItem(key);
}

/**
 * Check whether a key exists in localStorage.
 */
export function has(key: string): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return window.localStorage.getItem(key) !== null;
}
