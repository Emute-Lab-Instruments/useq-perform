import {
  syntaxHighlighting,
  HighlightStyle,
  defaultHighlightStyle,
  foldGutter,
  bracketMatching,
} from "@codemirror/language";
// @ts-expect-error — @nextjournal/clojure-mode has no type declarations
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
import {structureExtensions} from "./extensions/structure.ts";
import { evalHighlightField } from "./extensions/evalHighlight.ts";
import { visReadabilityPlugin } from "./extensions/visReadability.ts";
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

// Core functionality extensions
const functionalExtensions = [
  history(),
  foldGutter(),
  drawSelection(),
  updateListener
];

// S-Expression tracking extensions


// Base extensions combine core functionality
export const baseExtensions = [
  baseKeymap,
  ...functionalExtensions,
  ...themeExtensions,
  ...default_clojure_extensions,
  ...structureExtensions,
  evalHighlightField,
  visReadabilityPlugin,
];

// Main editor combines all extensions
export const mainEditorExtensions = [
  ...mainEditorKeymap,
  ...baseExtensions
];

dbg('extensions.mjs: Final mainEditorExtensions array created');
