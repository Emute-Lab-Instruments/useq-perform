// URL <-> exercise mapping for zen mode.
//
// Format: `#/zen` (grid) or `#/zen/<exercise-id>` (specific exercise).
// IDs are kebab-case strings defined in `exercises.ts` (e.g. `nav-right-1`).
// Older slashed URLs (`#/zen/nav/right/1`) are accepted by joining path
// segments with `-` so legacy bookmarks keep working.

export const ZEN_HASH_PREFIX = "#/zen";

export function isZenRoute(): boolean {
  return window.location.hash.startsWith(ZEN_HASH_PREFIX);
}

export function buildZenHash(exerciseId: string | null): string {
  return exerciseId ? `${ZEN_HASH_PREFIX}/${exerciseId}` : ZEN_HASH_PREFIX;
}

export function parseZenHash(hash: string): { exerciseId: string | null } {
  if (!hash.startsWith(ZEN_HASH_PREFIX)) return { exerciseId: null };
  const rest = hash.slice(ZEN_HASH_PREFIX.length).replace(/^\//, "");
  if (!rest) return { exerciseId: null };
  const id = rest.split("/").filter(Boolean).join("-");
  return { exerciseId: id || null };
}
