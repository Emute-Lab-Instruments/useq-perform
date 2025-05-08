import {
  syntaxHighlighting,
  HighlightStyle,
  defaultHighlightStyle,
  foldGutter,
  bracketMatching,
} from "@codemirror/language";
import { default_extensions as default_clojure_extensions } from "@nextjournal/clojure-mode";
import { EditorView } from "@codemirror/view";
import { activeUserSettings } from "../utils/persistentUserSettings.mjs";
import { themes } from "./themes/themeManager.mjs";
import { editorBaseTheme } from "./themes/builtinThemes.mjs";
import { codeStorageKey } from "../utils/persistentUserSettings.mjs";
import { lineNumbers, drawSelection } from "@codemirror/view";
import { history } from '@codemirror/commands';
import { baseKeymap, mainEditorKeymap } from "./keymaps.mjs";
import { themeCompartment, fontSizeCompartment } from "./state.mjs";
import {structureExtensions} from "./extensions/structure.mjs";
import { evalHighlightField } from "./extensions/evalHighlight.mjs";
import { dbg } from "../utils.mjs";

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
  evalHighlightField
];

// Main editor combines all extensions
export const mainEditorExtensions = [
  ...mainEditorKeymap,
  ...baseExtensions
];

dbg('extensions.mjs: Final mainEditorExtensions array created');
