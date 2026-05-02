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
import { saveRaw, PERSISTENCE_KEYS } from "../lib/persistence.ts";
import { themes, editorBaseTheme } from "./themes.ts";
import { lineNumbers, drawSelection } from "@codemirror/view";
import { history } from '@codemirror/commands';
import { baseKeymap, mainEditorKeymap } from "./keymaps.ts";
import { themeCompartment, fontSizeCompartment } from "../lib/editorCompartments.ts";
import {
  navigationMetaField,
  nodeHighlightPlugin,
  lastEvaluatedExpressionField,
  createExpressionGutter,
  createDefaultGutterConfig,
} from "./extensions/structure.ts";
import { structuralCoreExtensions } from "./extensions/structure/adapter/extension.ts";
import { evalHighlightField } from "./extensions/evalHighlight.ts";
import { visReadabilityPlugin } from "./extensions/visReadability.ts";
import { probeExtensions } from "./extensions/probes.ts";
import { inlineResultsField } from "./extensions/inlineResults.ts";
import { diagnosticField } from "./extensions/diagnostics.ts";
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
    saveRaw(PERSISTENCE_KEYS.editorCode, update.state.doc.toString());
  }

  if (update.docChanged && currentSettings.editor) {
    updateSettings({ editor: { code: update.state.doc.toString() } });
  }

  // Keep manual-control bindings stable across arbitrary edits.
  if (update.docChanged) {
    mapManualControlBindingsThroughChanges(update.changes);
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


// Structural editing layers. The cursor-halo decoration comes from one of
// two sources, gated on `settings.structure.useNewCore`:
//   - false (legacy): legacy `nodeHighlightPlugin` (SVG halos + indent guides)
//   - true (new core): adapter's `structuralCoreExtensions()` (state field +
//     halos + hole-pill widget)
// Mounting both at once double-paints the cursor; pick one. The eval gutter
// (`lastEvaluatedExpressionField` + `createExpressionGutter`) is independent
// of the structural rewrite and stays mounted in both modes.
const useNewCore = _initSettings.structure?.useNewCore === true;

const structuralLayer = useNewCore
  ? structuralCoreExtensions()
  : [navigationMetaField, nodeHighlightPlugin];

// Base extensions combine core functionality
export const baseExtensions = [
  baseKeymap,
  ...functionalExtensions,
  ...themeExtensions,
  ...default_clojure_extensions,
  ...structuralLayer,
  lastEvaluatedExpressionField,
  ...createExpressionGutter(createDefaultGutterConfig()),
  ...probeExtensions,
  evalHighlightField,
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
