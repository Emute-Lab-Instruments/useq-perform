/**
 * Theme metadata — names and validation helpers.
 *
 * This module lives in lib/ so that settings normalization and persistence
 * can reference theme names without importing CodeMirror dependencies from
 * editors/themes.ts (which would violate the import boundary).
 *
 * The canonical theme specs (colours, styles, CodeMirror extensions) remain
 * in src/editors/themes.ts and re-export these names for convenience.
 */

// ---------------------------------------------------------------------------
// Theme names — must match the `name` field in each ThemeSpec in
// src/editors/themes.ts.  Keep this list in sync when adding/removing themes.
// ---------------------------------------------------------------------------

export const themeNames: readonly string[] = [
  "uSEQ Dark",
  "Amy",
  "Ayu Light",
  "uSEQ 1337",
  "Bespin",
  "Birds of Paradise",
  "Night Lights",
  "Clouds",
  "Cobalt",
  "Cool Glow",
  "Dracula",
  "Espresso",
  "Noctis Lilac",
  "Rosé Pine Dawn",
  "Solarized Light",
  "Smoothy",
  "Tomorrow",
] as const;

/**
 * Set of valid theme names for O(1) membership checks.
 */
export const themeNameSet: ReadonlySet<string> = new Set(themeNames);

/**
 * Record keyed by theme name — useful for quick existence checks in code
 * that was previously using `themes[name]` from editors/themes.ts.
 */
export const themeNameRecord: Readonly<Record<string, true>> =
  Object.fromEntries(themeNames.map((n) => [n, true as const])) as Record<string, true>;
