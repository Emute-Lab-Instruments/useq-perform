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
import { activeUserSettings } from "../utils/persistentUserSettings.ts";
import { themes } from "./themes/themeManager.ts";
import { editorBaseTheme } from "./themes/builtinThemes.ts";
import { codeStorageKey } from "../utils/persistentUserSettings.ts";
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
dbg('extensions.mjs: Active user settings:', activeUserSettings);
dbg('extensions.mjs: Theme compartment:', themeCompartment);
dbg('extensions.mjs: Available themes:', Object.keys(themes));

// Create update listener
export const updateListener = EditorView.updateListener.of((update) => {
  const userSessionConfig = activeUserSettings.storage || { saveCodeLocally: true };
  if (update.docChanged && userSessionConfig.saveCodeLocally) {
    window.localStorage.setItem(codeStorageKey, update.state.doc.toString());
  }

  // Keep manual-control bindings stable across arbitrary edits.
  if (update.docChanged) {
    mapManualControlBindingsThroughChanges(update.changes);
  }
});

// Theme-related extensions
dbg('extensions.mjs: Creating theme extensions with:', {
  theme: activeUserSettings.editor.theme,
  fontSize: activeUserSettings.editor.fontSize
});

const selectedTheme = themes[activeUserSettings.editor.theme];
dbg('extensions.mjs: Selected theme:', selectedTheme ? 'found' : 'not found');

const themeExtensions = [
  editorBaseTheme,
  themeCompartment.of(themes[activeUserSettings.editor.theme]),
  fontSizeCompartment.of(
    EditorView.theme({
      ".cm-content": { fontSize: `${activeUserSettings.editor.fontSize || 16}px` },
    })
  ),
  lineNumbers(),
  bracketMatching()
];

export const exampleEditorExtensions = [
  editorBaseTheme,
  fontSizeCompartment.of(
    EditorView.theme({
      ".cm-content": { fontSize: `${activeUserSettings.editor.fontSize || 16}px` },
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
