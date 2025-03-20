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

console.log('extensions.mjs: Loading...');
console.log('extensions.mjs: Active user settings:', activeUserSettings);
console.log('extensions.mjs: Theme compartment:', themeCompartment);
console.log('extensions.mjs: Available themes:', Object.keys(themes));

// Create update listener
export const updateListener = EditorView.updateListener.of((update) => {
  const userSessionConfig = activeUserSettings.storage || { saveCodeLocally: true };
  if (update.docChanged && userSessionConfig.saveCodeLocally) {
    window.localStorage.setItem(codeStorageKey, update.state.doc.toString());
  }
});

// Theme-related extensions
console.log('extensions.mjs: Creating theme extensions with:', {
  theme: activeUserSettings.editor.theme,
  fontSize: activeUserSettings.editor.fontSize
});

const selectedTheme = themes[activeUserSettings.editor.theme];
console.log('extensions.mjs: Selected theme:', selectedTheme ? 'found' : 'not found');

const themeExtensions = [
  editorBaseTheme,
  themeCompartment.of(themes[activeUserSettings.editor.theme]),
  fontSizeCompartment.of(
    EditorView.theme({
      ".cm-content": { fontSize: `${activeUserSettings.editor.fontSize || 16}px` },
    })
  ),
  lineNumbers(),
  bracketMatching(),
];

// Core functionality extensions
const functionalExtensions = [
  history(),
  foldGutter(),
  drawSelection(),
  updateListener
];

console.log('extensions.mjs: Created base extensions:', {
  themeExtensions: 'themeExtensions array',
  functionalExtensions: 'functionalExtensions array'
});

// Base extensions combine core functionality
export const baseExtensions = [
  baseKeymap,
  ...functionalExtensions,
  ...themeExtensions,
  ...default_clojure_extensions,
];

// Main editor combines all extensions
export const mainEditorExtensions = [
  ...mainEditorKeymap,
  ...baseExtensions
];

console.log('extensions.mjs: Final mainEditorExtensions array created');
