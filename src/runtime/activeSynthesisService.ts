/**
 * Active synthesis service selector.
 *
 * Single read-through accessor that returns the synthesis service
 * constructed by `bootstrap.ts`. Bootstrap is the only place allowed to
 * choose the active service, so the rest of the codebase asks
 * `getActiveSynthesisService()` instead of importing a concrete
 * singleton.
 *
 * Why this indirection exists:
 *
 *   - The autoplay listener (`src/effects/engineAutoplayListener.ts`)
 *     needs to call `resumeOnUserActivation()` on trusted keydown /
 *     pointerdown without reaching into the audio layer's constructor.
 *   - The UI adapter (`src/ui/adapters/toolbars.tsx`) needs to wire the
 *     engine indicator's `onResume` prop to the same service.
 *   - Future devmode panels, recovery affordances, and the eval-to-engine
 *     commit pipeline all need a single entry point.
 *
 * Import boundary note: this file lives in `src/runtime/` so it may be
 * consumed by `src/effects/` and `src/ui/`. It MUST NOT be imported from
 * `src/contracts/` or `src/lib/` (those layers are lower than runtime).
 * The synthesis service type is re-exported from `src/audio/` so consumers
 * do not need to know the audio layer's internal path layout.
 */
import type { SynthesisService } from "../audio/synthesisService";

let activeService: SynthesisService | null = null;

/**
 * Replace the active synthesis service. Called once during bootstrap
 * when the synthesis service is constructed. Idempotent: a second call
 * replaces the previous service (the recovery path uses this to install
 * a fresh service after the previous one was disposed).
 */
export function setActiveSynthesisService(service: SynthesisService | null): void {
  activeService = service;
}

/**
 * Snapshot of the currently active synthesis service, or `null` when no
 * service has been constructed (audio capability absent, bootstrap
 * failed, or the service has been disposed and not yet replaced).
 *
 * Callers that need to attempt a resume should check the return value
 * before calling methods; a null service means audio is unavailable.
 */
export function getActiveSynthesisService(): SynthesisService | null {
  return activeService;
}

/**
 * Reset the active service selector. Used by tests so earlier service
 * instances do not bleed state across cases. The production bootstrap
 * publishes a fresh service on every full page load.
 */
export function resetActiveSynthesisServiceForTests(): void {
  activeService = null;
}
