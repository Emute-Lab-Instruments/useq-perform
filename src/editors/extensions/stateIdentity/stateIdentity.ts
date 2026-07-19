/**
 * Public entrypoint for the state-identity sidecar extension.
 *
 * Spec: docs/specs/state-identity.md.
 *
 * Usage in `src/editors/extensions.ts`:
 *
 * ```ts
 * import { createDefaultIdentityExtension } from "./extensions/stateIdentity/stateIdentity.ts";
 * // ...
 * const baseExtensions = [
 *   // ...
 *   ...createDefaultIdentityExtension(),
 * ];
 * ```
 *
 * Tests import `identityExtensions` directly with a custom config.
 */

import { identityExtensions, buildIdentityField, type IdentityConfig } from "./identityField.ts";
import { createDefaultIdentityConfig } from "./createDefaultIdentityConfig.ts";

export { identityExtensions, buildIdentityField } from "./identityField.ts";
export type { IdentityConfig, IdentityFieldValue, IdentityLogEvent } from "./identityField.ts";
export {
  declareMoveEffect,
  markCutEffect,
  setIdentitySnapshotEffect,
  newPasteToken,
} from "./identityField.ts";
export { readIdentityMap } from "./identityField.ts";

export { createDefaultIdentityConfig } from "./createDefaultIdentityConfig.ts";

/** Default production extension set. Drop into the main editor. */
export function createDefaultIdentityExtension() {
  return identityExtensions(createDefaultIdentityConfig());
}

// Re-export the core types and helpers for downstream consumers (eval
// payload, persistence, tests).
export type {
  FormKey,
  IdentityEntry,
  IdentityMap,
  IdentityRange,
  IdentitySnapshot,
  RecognisedForm,
  StateId,
  StatefulFormKind,
} from "./identityTypes.ts";
export { emptyIdentityMap } from "./identityTypes.ts";
export {
  entriesOf,
  forkAllEntries,
  forkEntry,
  getById,
  getByKey,
  makeContinuitySource,
  mapsEqualByIdentity,
  moveEntry,
  remapRanges,
  type ContinuitySource,
  type MapPosLike,
} from "./identityMapState.ts";
export {
  combineClassifiers,
  classifySynthTopLevel,
  defaultStatefulFormClassifier,
  recogniseStatefulForms,
  type StatefulFormClassifier,
} from "./identityClassify.ts";
export {
  reconcileIdentity,
  stampCutToken,
  type ReconcileResult,
  type ReconcileSignals,
} from "./identityReconcile.ts";
export { defaultIdGenerator, deterministicIdGenerator } from "./identityGenerator.ts";
export type { IdGenerator, IdGeneratorFactory } from "./identityGenerator.ts";
