/**
 * Preloads help content (reference data) at app startup.
 *
 * All fetches are fire-and-forget: errors are logged but never block startup.
 *
 * Loading is deduplicated via `ensureReferenceDataLoaded()` in the reference
 * store — if the ModuLispReferenceTab component mounts before this preload
 * finishes (or vice-versa), only one network request is made.
 *
 * Heavy imports (referenceStore) are loaded dynamically inside the async
 * preload function so that importing this module from bootstrap.ts does not
 * pull in solid-js/store at the top level (which would break test
 * environments that lack a full localStorage mock).
 */

// ── Preload orchestration ───────────────────────────────────────────

async function preloadReferenceData(): Promise<void> {
  const { ensureReferenceDataLoaded } = await import("../utils/referenceStore.ts");
  await ensureReferenceDataLoaded();
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
