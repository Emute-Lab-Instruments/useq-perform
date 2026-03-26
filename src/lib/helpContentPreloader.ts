/**
 * Preloads help content (reference data + user guides) at app startup.
 *
 * All fetches are fire-and-forget: errors are logged but never block startup.
 *
 * Heavy imports (referenceStore, referenceDataLoader) are loaded dynamically
 * inside the async preload functions so that importing this module from
 * bootstrap.ts does not pull in solid-js/store at the top level (which would
 * break test environments that lack a full localStorage mock).
 */

// ── User guide cache ────────────────────────────────────────────────

const guideCache = new Map<string, string>();

/** Return a previously-fetched guide, or undefined if not yet cached. */
export function getCachedGuide(level: string): string | undefined {
  return guideCache.get(level);
}

// ── Preload orchestration ───────────────────────────────────────────

async function preloadReferenceData(): Promise<void> {
  const { loadReferenceDataFromCandidates, normalizeEntry } = await import("./referenceDataLoader.ts");
  const { setReferenceStore } = await import("../utils/referenceStore.ts");
  const raw = await loadReferenceDataFromCandidates();
  const normalized = raw
    .map(normalizeEntry)
    .filter((entry): entry is NonNullable<ReturnType<typeof normalizeEntry>> => Boolean(entry));
  setReferenceStore("data", normalized);
  setReferenceStore("isLoading", false);
}

async function preloadGuide(level: string): Promise<void> {
  const response = await fetch(`assets/userguide_${level}.html`);
  if (!response.ok) throw new Error(`Failed to fetch userguide_${level}.html (${response.status})`);
  guideCache.set(level, await response.text());
}

/**
 * Kick off all help-content fetches concurrently.
 * Intended to be called fire-and-forget from bootstrap.
 */
export function preloadHelpContent(): void {
  Promise.all([
    preloadReferenceData(),
    preloadGuide("beginner"),
    preloadGuide("advanced"),
  ]).catch((err) => {
    console.warn("helpContentPreloader: one or more preloads failed:", err);
  });
}
