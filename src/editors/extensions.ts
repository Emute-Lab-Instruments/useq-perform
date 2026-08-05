import {
  syntaxHighlighting,
  HighlightStyle,
  defaultHighlightStyle,
  foldGutter,
  bracketMatching,
} from "@codemirror/language";
import { default_extensions as default_clojure_extensions } from "@nextjournal/clojure-mode";
import { EditorView } from "@codemirror/view";
import { getAppSettings } from "../runtime/appSettingsRepository.ts";
import { updateSettings } from "../runtime/runtimeService.ts";
import { saveEditorCode } from "../lib/persistence.ts";
import { themes, editorBaseTheme } from "./themes.ts";
import { lineNumbers, drawSelection } from "@codemirror/view";
import { history } from '@codemirror/commands';
import { baseKeymap, mainEditorKeymap } from "./keymaps.ts";
import { themeCompartment, fontSizeCompartment } from "../lib/editorCompartments.ts";
import { lastEvaluatedExpressionField } from "./extensions/expressionEvalState.ts";
import { setEvalIntegrationConfig } from "./extensions/expressionEval.ts";
import { createDefaultEvalIntegrationConfig } from "./extensions/expressionEvalDefaults.ts";
import {
  createExpressionGutter,
  createDefaultGutterConfig,
} from "./extensions/expressionHighlights.ts";
import { structuralCoreExtensions } from "./extensions/structure/adapter/extension.ts";
// State-identity sidecar: opaque hidden IDs for stateful top-level forms
// (synth today; future registrars extend via the classifier). Dependency-
// injected so tests/Inspector can render the editor without synthesis
// runtime singletons. Spec: docs/specs/state-identity.md.
//
// Production uses the singleton field exposed by identityFieldExport so
// editorEvaluation.ts can read the live identity map from the same field
// instance (CodeMirror StateFields compare by reference).
import { defaultIdentityExtension } from "./extensions/stateIdentity/identityFieldExport.ts";

// Wire the default eval-integration config on module load (production wiring).
// Tests/Inspector can override via `setEvalIntegrationConfig()`.
setEvalIntegrationConfig(createDefaultEvalIntegrationConfig());
import { evalHighlightField } from "./extensions/evalHighlight.ts";
import { deleteConfirmField } from "./extensions/deleteConfirmFlash.ts";
import { visReadabilityPlugin } from "./extensions/visReadability.ts";
import { probeExtensions } from "./extensions/probes.ts";
import { inlineResultsField } from "./extensions/inlineResults.ts";
import { diagnosticField } from "./extensions/diagnostics.ts";
import { createLiveEditWidgetsExtension } from "./extensions/liveEdit/widgets.ts";
import { liveEditPasteHandler } from "./extensions/liveEdit/pasteHandler.ts";
import { createIdleEvalPlugin } from "./extensions/liveEdit/idleEval.ts";
import { liveEditOnValueChange, onDocumentChange } from "../effects/liveEditRuntime.ts";
import { dbg } from "../lib/debug.ts";
import { mapManualControlBindingsThroughChanges } from "../lib/manualControlState.ts";

dbg('extensions.mjs: Loading...');
const _initSettings = getAppSettings();
dbg('extensions.mjs: Active user settings:', _initSettings);
dbg('extensions.mjs: Theme compartment:', themeCompartment);
dbg('extensions.mjs: Available themes:', Object.keys(themes));

// Create update listener
export const updateListener = EditorView.updateListener.of((update) => {
  const currentSettings = getAppSettings();
  const userSessionConfig = currentSettings.storage || { saveCodeLocally: true };
  if (update.docChanged && userSessionConfig.saveCodeLocally) {
    saveEditorCode(update.state.doc.toString());
  }

  if (update.docChanged && currentSettings.editor) {
    updateSettings({ editor: { code: update.state.doc.toString() } });
  }

  // Keep manual-control bindings stable across arbitrary edits.
  if (update.docChanged) {
    mapManualControlBindingsThroughChanges(update.changes);
    // §7.3 trigger 2: debounced reconciliation on document change.
    onDocumentChange(update.view);
  }
});

// Theme-related extensions
dbg('extensions.mjs: Creating theme extensions with:', {
  theme: _initSettings.editor.theme,
  fontSize: _initSettings.editor.fontSize
});

const selectedTheme = themes[_initSettings.editor.theme];
dbg('extensions.mjs: Selected theme:', selectedTheme ? 'found' : 'not found');

const themeExtensions = [
  editorBaseTheme,
  themeCompartment.of(themes[_initSettings.editor.theme]),
  fontSizeCompartment.of(
    EditorView.theme({
      ".cm-content": { fontSize: `${_initSettings.editor.fontSize || 16}px` },
    })
  ),
  lineNumbers(),
  bracketMatching()
];

export const exampleEditorExtensions = [
  editorBaseTheme,
  fontSizeCompartment.of(
    EditorView.theme({
      ".cm-content": { fontSize: `${_initSettings.editor.fontSize || 16}px` },
    })
  ),
  bracketMatching(),
  drawSelection()
];

// Minimal extension set for read-only code snippets (e.g., user guide).
// Excludes updateListener, probes, visReadability, and structure extensions
// that perform position-dependent operations which can fail on small/scrolling docs.
export const readOnlyExtensions = [
  editorBaseTheme,
  fontSizeCompartment.of(
    EditorView.theme({
      ".cm-content": { fontSize: `${_initSettings.editor.fontSize || 16}px` },
    })
  ),
  bracketMatching(),
  drawSelection(),
  ...default_clojure_extensions,
];

// Read-only extensions plus the probe extension, so indexed-form snippets
// (from-list / from-flat-list / seq / gates / trigs) get the same live
// active-element highlight as the main editor. The probe extension's
// contextual highlighting runs automatically and only requires WASM eval —
// no user toggle needed.
export const snippetReadOnlyExtensions = [
  ...readOnlyExtensions,
  ...probeExtensions,
];

// Core functionality extensions
const functionalExtensions = [
  history(),
  foldGutter(),
  drawSelection(),
  updateListener
];

// Editable extension set for guide playgrounds.
// Includes clojure mode and editing features but excludes position-dependent
// plugins (probes, evalHighlight, visReadability, structureExtensions) that
// track positions across the main editor's document and fail on smaller docs.
export const guideEditorExtensions = [
  baseKeymap,
  history(),
  foldGutter(),
  drawSelection(),
  ...themeExtensions,
  ...default_clojure_extensions,
];

// S-Expression tracking extensions


// Structural editing layer: state field + cursor halos + hole-pill widget.
// The eval gutter (`lastEvaluatedExpressionField` + `createExpressionGutter`)
// is independent of structural editing and lives in `expressionHighlights.ts`.

// Base extensions combine core functionality
export const baseExtensions = [
  baseKeymap,
  ...functionalExtensions,
  ...themeExtensions,
  ...default_clojure_extensions,
  ...structuralCoreExtensions(),
  // State-identity sidecar: opaque hidden IDs for stateful top-level forms
  // (synth today; future registrars extend via the classifier). Dependency-
  // injected so tests/Inspector can render the editor without synthesis
  // runtime singletons. Spec: docs/specs/state-identity.md.
  ...defaultIdentityExtension(),
  lastEvaluatedExpressionField,
  ...createExpressionGutter(createDefaultGutterConfig()),
  ...probeExtensions,
  ...createLiveEditWidgetsExtension({ onValueChange: liveEditOnValueChange }),
  liveEditPasteHandler,
  createIdleEvalPlugin(),
  evalHighlightField,
  deleteConfirmField,
  inlineResultsField,
  diagnosticField,
  visReadabilityPlugin,
];

// Main editor combines all extensions
export const mainEditorExtensions = [
  ...mainEditorKeymap,
  ...baseExtensions
];

dbg('extensions.mjs: Final mainEditorExtensions array created');
