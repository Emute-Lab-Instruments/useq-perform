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
 *
 * For tests that must exercise the production singleton path (see
 * `productionWiring.test.ts` and Ergo bug f55bcf74), call
 * {@link setProductionIdentityConfigForTests} BEFORE
 * `defaultIdentityExtension()` so the singleton builds from the injected
 * config. The real app never calls that setter.
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

// ─── Test-only override ────────────────────────────────────────────────────

/**
 * Cached test override. When non-null, the production singleton in
 * `identityFieldExport.ts` builds from this config instead of the real
 * production config. This lets the production-wiring tests install an
 * adversarial ID generator and verify the singleton path end-to-end
 * without monkey-patching module internals.
 *
 * The real app NEVER calls the setter. The setter is exported only so
 * `productionWiring.test.ts` can drive the production singleton with a
 * deterministic config.
 *
 * Note: {@link createDefaultIdentityConfig} itself ignores the override
 * and always returns the real production config. Only the singleton
 * builder in `identityFieldExport.ts` consults the override, and only
 * when constructing the field for the first time after a reset.
 */
let _testOverride: IdentityConfig | null = null;

/**
 * Install a test-only override of the default identity config. The next
 * call to `identityField()` / `defaultIdentityExtension()` after a
 * `_resetIdentityFieldSingletonForTests()` call builds the singleton
 * from this config. Pass `null` to restore the real production config.
 *
 * Reserved for `productionWiring.test.ts`. Production code must not call
 * this.
 */
export function setProductionIdentityConfigForTests(
  config: IdentityConfig | null,
): void {
  _testOverride = config;
}

/**
 * Internal accessor used by the singleton in `identityFieldExport.ts`.
 * Returns the test override when set, otherwise signals "use the real
 * default".
 */
export function _productionIdentityConfigOverrideForTests(): IdentityConfig | null {
  return _testOverride;
}

