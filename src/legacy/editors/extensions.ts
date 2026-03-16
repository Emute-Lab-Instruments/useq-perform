// @ts-nocheck
import {
  syntaxHighlighting,
  HighlightStyle,
  defaultHighlightStyle,
  foldGutter,
  bracketMatching,
} from "@codemirror/language";
import { default_extensions as default_clojure_extensions } from "@nextjournal/clojure-mode";
import { EditorView } from "@codemirror/view";
import { getAppSettings, updateAppSettings } from "../../runtime/appSettingsRepository.ts";
import { codeStorageKey } from "../config/appSettings.ts";
import { themes } from "./themes/themeManager.ts";
import { editorBaseTheme } from "./themes/builtinThemes.ts";
import { lineNumbers, drawSelection } from "@codemirror/view";
import { history } from '@codemirror/commands';
import { baseKeymap, mainEditorKeymap } from "./keymaps.ts";
import { themeCompartment, fontSizeCompartment } from "./state.ts";
import {structureExtensions} from "./extensions/structure.ts";
import { evalHighlightField } from "./extensions/evalHighlight.ts";
import { visReadabilityPlugin } from "./extensions/visReadability.ts";
import { dbg } from "../utils.ts";
import { mapManualControlBindingsThroughChanges } from "./manualControlState.ts";

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
    window.localStorage.setItem(codeStorageKey, update.state.doc.toString());
  }

  if (update.docChanged && currentSettings.editor) {
    updateAppSettings({ editor: { code: update.state.doc.toString() } });
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
