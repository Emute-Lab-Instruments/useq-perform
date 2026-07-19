/**
 * Default production wiring for the state-identity sidecar.
 *
 * The default config:
 *   - uses {@link defaultIdGenerator} (opaque url-safe tokens);
 *   - uses {@link defaultStatefulFormClassifier} (recognises top-level
 *     `(synth …)` forms);
 *   - does not log reconciliation events (the persistence/payload layers
 *     will surface diagnostics instead).
 *
 * Tests pass their own config (deterministic IDs, spy logger, custom
 * classifier) so the field can be exercised in isolation per VAL-ID-020.
 */

import { defaultIdGenerator } from "./identityGenerator.ts";
import { defaultStatefulFormClassifier } from "./identityClassify.ts";
import type { IdentityConfig } from "./identityField.ts";

/** Default production config — opaque IDs + top-level synth classifier. */
export function createDefaultIdentityConfig(): IdentityConfig {
  return {
    ids: defaultIdGenerator(),
    classifier: defaultStatefulFormClassifier,
  };
}
