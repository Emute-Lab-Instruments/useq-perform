/**
 * Bridge module for Solid UI adapter functions.
 *
 * In the Vite runtime, this eagerly imports the real implementations from
 * TypeScript / TSX modules.  Under Mocha (plain Node.js), those imports
 * will fail to resolve, so we fall back to safe no-ops.
 *
 * This allows legacy .mjs files that have Mocha tests to continue working
 * without requiring the Node.js test runner to understand .tsx files.
 *
 * NOTE: This module now imports from adapters, not islands.
 */

let _setEditor = () => {};
let _mountSettingsPanel = () => {};
let _mountHelpPanel = () => {};

// Resolve the imports eagerly. The .then() chains fire asynchronously but
// before any application code calls the functions (the legacy app waits for
// DOMContentLoaded before invoking createAppUI).
import("../../lib/editorStore.ts")
  .then((m) => { _setEditor = m.setEditor; })
  .catch(() => {});

import("../../ui/adapters/panels.tsx")
  .then((m) => { _mountSettingsPanel = m.mountSettingsPanel; })
  .catch(() => {});

import("../../ui/adapters/panels.tsx")
  .then((m) => { _mountHelpPanel = m.mountHelpPanel; })
  .catch(() => {});

export function setEditor(editor) {
  _setEditor(editor);
}

export function mountSettingsPanel(elementId) {
  try {
    _mountSettingsPanel(elementId);
  } catch (_) {
    // Solid rendering may fail in non-browser environments (e.g. Node.js tests)
  }
}

export function mountHelpPanel(elementId) {
  try {
    _mountHelpPanel(elementId);
  } catch (_) {
    // Solid rendering may fail in non-browser environments (e.g. Node.js tests)
  }
}
