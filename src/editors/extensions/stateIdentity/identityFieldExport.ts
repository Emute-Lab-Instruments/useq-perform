/**
 * Singleton production wiring for the state-identity StateField.
 *
 * Production wiring (extensions.ts) installs the field AND its
 * `invertedEffects` history companion via `defaultIdentityExtension`,
 * which lazily builds the field with the default config. CodeMirror
 * StateFields compare by reference, so the SAME instance must be added
 * to the editor extensions and read back from `view.state.field(...)`.
 *
 * Downstream consumers that need to read the live identity map outside
 * the editor (e.g. {@link buildEvalPayload} in editorEvaluation.ts)
 * import {@link identityField} from this module.
 *
 * Tests bypass this singleton: they call {@link buildIdentityField}
 * directly with a custom config, install the returned field in their
 * own EditorView, and pass the same field reference when reading
 * state. The singleton pattern here is purely for the production
 * editor's convenience.
 *
 * Ergo bug f55bcf74: an earlier version of this module installed only
 * the bare `StateField` (`return [identityField()];`) and omitted the
 * `invertedEffects` companion that threads history-aware snapshots
 * through undo/redo. As a result every undo/redo in the running editor
 * minted a fresh forked identity, even though the in-process
 * `identityExtensionsWithField` tests passed because they bypassed the
 * production singleton. The companion is now installed alongside the
 * field via {@link identityExtensionsWithField}, and
 * `productionWiring.test.ts` exercises the production path end-to-end.
 *
 * Spec: docs/specs/state-identity.md §7 (Editor Metadata), §13.3
 * (Phase 3 editor hidden IDs), VAL-ID-008.
 */

import type { Extension } from "@codemirror/state";
import type { StateField } from "@codemirror/state";
import {
  identityExtensionsWithField,
  type IdentityConfig,
  type IdentityFieldValue,
} from "./identityField.ts";
import {
  createDefaultIdentityConfig,
  _productionIdentityConfigOverrideForTests,
} from "./createDefaultIdentityConfig.ts";

let _config: IdentityConfig | null = null;
let _field: StateField<IdentityFieldValue> | null = null;
let _extensions: Extension[] | null = null;

/**
 * Lazily build (or return the cached) default identity field instance.
 * The same instance is returned on every call so that
 * `view.state.field(identityField)` resolves to the value produced by
 * the same field that was installed via {@link defaultIdentityExtension}.
 */
export function identityField(): StateField<IdentityFieldValue> {
  if (_field === null) {
    // Use the test override when set; otherwise build the real
    // production config.
    _config =
      _productionIdentityConfigOverrideForTests() ?? createDefaultIdentityConfig();
    const built = identityExtensionsWithField(_config);
    _field = built.field;
    _extensions = built.extensions;
  }
  return _field;
}

/**
 * Production identity extension set: installs the singleton
 * {@link identityField} AND its `invertedEffects` history companion into
 * the editor. Drop into the main editor's extension list.
 *
 * CodeMirror StateFields compare by reference, so the SAME instance
 * must be installed via this function and read back via
 * {@link identityField}. Tests that build a custom field via
 * {@link buildIdentityField} must NOT use this helper — they should
 * install their field directly.
 *
 * The returned array contains at least two extensions:
 *   1. The identity {@link StateField} itself.
 *   2. An `invertedEffects` facet registration that captures the field's
 *      value at `tr.startState` for every history-stored transaction so
 *      undo/redo restore the exact prior mapping (VAL-ID-008).
 */
export function defaultIdentityExtension(): Extension[] {
  // Trigger lazy build if not yet built, which populates _extensions.
  void identityField();
  // Return a fresh defensive copy so callers cannot mutate the cached
  // singleton extensions array.
  return _extensions === null ? [] : [..._extensions];
}

/**
 * Reset the singleton. Used by tests that swap the production wiring
 * with a custom field; not for application code.
 */
export function _resetIdentityFieldSingletonForTests(): void {
  _config = null;
  _field = null;
  _extensions = null;
}
