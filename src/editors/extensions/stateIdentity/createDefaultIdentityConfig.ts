/**
 * Default production wiring for the state-identity sidecar.
 *
 * The default config:
 *   - uses {@link defaultIdGenerator} (opaque url-safe tokens);
 *   - uses {@link defaultStatefulFormClassifier} (recognises top-level
 *     `(synth …)` forms);
 *   - wires {@link createIdentityPersistence} so the sidecar persists
 *     through the central persistence service (state-identity.md §7.3,
 *     persistence.md). `?nosave` is applied by the central service
 *     itself, so this adapter is unconditionally installed;
 *   - does not log reconciliation events (the persistence/payload layers
 *     will surface diagnostics instead).
 *
 * Tests pass their own config (deterministic IDs, spy logger, custom
 * classifier, no persistence) so the field can be exercised in isolation
 * per VAL-ID-020.
 */

import { defaultIdGenerator } from "./identityGenerator.ts";
import { defaultStatefulFormClassifier } from "./identityClassify.ts";
import { createIdentityPersistence } from "./identityPersistence.ts";
import type { IdentityConfig } from "./identityField.ts";

/**
 * Default production config — opaque IDs, top-level synth classifier, and
 * persistence through the central persistence service. The persistence
 * adapter never touches localStorage directly (VAL-ID-024).
 */
export function createDefaultIdentityConfig(): IdentityConfig {
  return {
    ids: defaultIdGenerator(),
    classifier: defaultStatefulFormClassifier,
    persistence: createIdentityPersistence(),
  };
}
