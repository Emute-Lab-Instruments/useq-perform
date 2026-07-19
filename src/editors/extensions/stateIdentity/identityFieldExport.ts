/**
 * Singleton production wiring for the state-identity StateField.
 *
 * Production wiring (extensions.ts) installs the field via
 * `defaultIdentityExtension`, which lazily builds the field with the
 * default config. CodeMirror StateFields compare by reference, so the
 * SAME instance must be added to the editor extensions and read back
 * from `view.state.field(...)`.
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
 * Spec: docs/specs/state-identity.md §7 (Editor Metadata).
 */

import type { Extension } from "@codemirror/state";
import type { StateField } from "@codemirror/state";
import {
  buildIdentityField,
  type IdentityConfig,
  type IdentityFieldValue,
} from "./identityField.ts";
import { createDefaultIdentityConfig } from "./createDefaultIdentityConfig.ts";

let _config: IdentityConfig | null = null;
let _field: StateField<IdentityFieldValue> | null = null;

/**
 * Lazily build (or return the cached) default identity field instance.
 * The same instance is returned on every call so that
 * `view.state.field(identityField)` resolves to the value produced by
 * the same field that was installed via {@link defaultIdentityExtension}.
 */
export function identityField(): StateField<IdentityFieldValue> {
  if (_field === null) {
    _config = createDefaultIdentityConfig();
    _field = buildIdentityField(_config);
  }
  return _field;
}

/**
 * Production identity extension set: installs the singleton
 * {@link identityField} into the editor. Drop into the main editor's
 * extension list.
 *
 * CodeMirror StateFields compare by reference, so the SAME instance
 * must be installed via this function and read back via
 * {@link identityField}. Tests that build a custom field via
 * {@link buildIdentityField} must NOT use this helper — they should
 * install their field directly.
 */
export function defaultIdentityExtension(): Extension[] {
  return [identityField()];
}

/**
 * Reset the singleton. Used by tests that swap the production wiring
 * with a custom field; not for application code.
 */
export function _resetIdentityFieldSingletonForTests(): void {
  _config = null;
  _field = null;
}
