/**
 * OS & Browser reserved key database.
 *
 * Self-contained module with no runtime imports from the app.
 * Used by the binding resolver to warn (OS) or block (browser) key assignments.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OsFamily = "mac" | "windows" | "linux";

export interface ReservedKey {
  /** CodeMirror key notation */
  key: string;
  /** Human-readable explanation */
  reason: string;
}

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------

export function detectOs(): OsFamily {
  // Modern Chromium API (navigator.userAgentData)
   
  const nav: any = typeof navigator !== "undefined" ? navigator : undefined;
  if (nav?.userAgentData?.platform) {
    const platform = (nav.userAgentData.platform as string).toLowerCase();
    if (platform === "macos") return "mac";
    if (platform === "windows") return "windows";
    return "linux";
  }

  // Fallback: navigator.platform (deprecated but widely available)
  if (typeof navigator !== "undefined") {
    const p = (navigator.platform ?? "").toLowerCase();
    if (p.startsWith("mac") || p === "iphone" || p === "ipad" || p === "ipod")
      return "mac";
    if (p.startsWith("win")) return "windows";

    // Last resort: userAgent string
    const ua = (navigator.userAgent ?? "").toLowerCase();
    if (ua.includes("mac os") || ua.includes("iphone") || ua.includes("ipad"))
      return "mac";
    if (ua.includes("windows")) return "windows";
  }

  // Default to linux (also covers unknown/SSR)
  return "linux";
}

// ---------------------------------------------------------------------------
// OS-reserved keys (soft warnings -- user CAN bind but gets a warning)
// ---------------------------------------------------------------------------

const macReserved: ReservedKey[] = [
  { key: "Mod-q", reason: "Quit application" },
  { key: "Mod-h", reason: "Hide application" },
  { key: "Mod-m", reason: "Minimise window" },
  { key: "Mod-w", reason: "Close window" },
  { key: "Ctrl-ArrowLeft", reason: "Desktop switching / Mission Control" },
  { key: "Ctrl-ArrowRight", reason: "Desktop switching / Mission Control" },
  { key: "Ctrl-ArrowUp", reason: "Mission Control" },
  { key: "Ctrl-ArrowDown", reason: "App Expose" },
  { key: "Mod-Space", reason: "Spotlight" },
  { key: "Mod-Tab", reason: "App switcher" },
  { key: "Mod-`", reason: "Window cycling" },
];

const windowsReserved: ReservedKey[] = [
  { key: "Alt-F4", reason: "Close window" },
  { key: "Alt-Tab", reason: "Task switcher" },
  { key: "Meta-l", reason: "Lock screen" },
  { key: "Meta-d", reason: "Show desktop" },
  { key: "Meta-e", reason: "File explorer" },
  { key: "Meta-r", reason: "Run dialog" },
  { key: "Ctrl-Alt-Delete", reason: "System interrupt" },
  { key: "Meta-Tab", reason: "Task view" },
];

// Linux reservations vary heavily by desktop environment (Hyprland, GNOME,
// KDE, Sway, i3, etc.). This list covers only the most common defaults.
// Users on non-standard DEs will likely have remapped these anyway.
const linuxReserved: ReservedKey[] = [
  { key: "Alt-F2", reason: "Run dialog (GNOME)" },
  { key: "Ctrl-Alt-ArrowLeft", reason: "Workspace switching" },
  { key: "Ctrl-Alt-ArrowRight", reason: "Workspace switching" },
  // Meta/Super is the primary WM modifier on most Linux DEs.
  // Individual Meta-<key> combos are too DE-specific to enumerate.
];

const osReservedMap: Record<OsFamily, ReservedKey[]> = {
  mac: macReserved,
  windows: windowsReserved,
  linux: linuxReserved,
};

// ---------------------------------------------------------------------------
// Browser-reserved keys (HARD BLOCK -- JS cannot intercept these)
// ---------------------------------------------------------------------------

export const browserReserved: ReservedKey[] = [
  { key: "Ctrl-w", reason: "Close tab (unreachable)" },
  { key: "Ctrl-t", reason: "New tab (unreachable)" },
  { key: "Ctrl-n", reason: "New window (unreachable)" },
  { key: "Ctrl-l", reason: "Address bar (unreachable)" },
  { key: "Ctrl-Shift-t", reason: "Reopen tab (unreachable)" },
  { key: "F5", reason: "Reload (unreachable)" },
  { key: "Ctrl-r", reason: "Reload (unreachable)" },
  { key: "F6", reason: "Address bar (unreachable)" },
  { key: "F11", reason: "Fullscreen (unreachable)" },
  { key: "F12", reason: "DevTools (unreachable)" },
  { key: "Ctrl-Shift-i", reason: "DevTools (unreachable)" },
  { key: "Ctrl-Shift-j", reason: "DevTools console (unreachable)" },
];

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

/** Normalise key string for comparison (case-insensitive modifier names). */
function normaliseKey(key: string): string {
  return key
    .split("-")
    .map((part, i, arr) =>
      // Last segment is the actual key -- preserve its case
      i === arr.length - 1 ? part : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase(),
    )
    .join("-");
}

/**
 * Check whether a key is reserved by the host OS (soft warning).
 * Auto-detects OS if not provided.
 */
export function isOsReserved(key: string, os?: OsFamily): ReservedKey | null {
  const family = os ?? detectOs();
  const normalised = normaliseKey(key);
  return (
    osReservedMap[family].find((r) => normaliseKey(r.key) === normalised) ??
    null
  );
}

/**
 * Check whether a key is reserved by the browser (hard block).
 * Browser reservations apply to ALL platforms.
 */
export function isBrowserReserved(key: string): ReservedKey | null {
  const normalised = normaliseKey(key);
  return (
    browserReserved.find((r) => normaliseKey(r.key) === normalised) ?? null
  );
}

/**
 * Return the full list of OS-reserved keys for a platform.
 * Auto-detects OS if not provided.
 */
export function getOsReservedKeys(os?: OsFamily): ReservedKey[] {
  const family = os ?? detectOs();
  return osReservedMap[family];
}
