/**
 * Preloads help content (reference data) at app startup.
 *
 * All fetches are fire-and-forget: errors are logged but never block startup.
 *
 * Heavy imports (referenceStore, referenceDataLoader) are loaded dynamically
 * inside the async preload functions so that importing this module from
 * bootstrap.ts does not pull in solid-js/store at the top level (which would
 * break test environments that lack a full localStorage mock).
 */

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

/**
 * Kick off all help-content fetches concurrently.
 * Intended to be called fire-and-forget from bootstrap.
 */
export function preloadHelpContent(): void {
  preloadReferenceData().catch((err) => {
    console.warn("helpContentPreloader: reference data preload failed:", err);
  });
}
