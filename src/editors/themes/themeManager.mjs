import { EditorView } from "@codemirror/view";
import { themeCompartment } from "../state.mjs";
import { registerBuiltinThemes } from "./builtinThemes.mjs";

// Create themes registry
let themes = {};
registerBuiltinThemes(themes);

export {themes};

export function setTheme(editor, themeName) {
  console.log("themeManager.mjs: Setting theme to:", themeName);
  console.log("themeManager.mjs: Available themes:", Object.keys(themes));
  const theme = themes[themeName];
  if (theme) {
    console.log("themeManager.mjs: Found theme, applying...");
    editor.dispatch({
      effects: themeCompartment.reconfigure(theme),
    });
  } else {
    console.error("themeManager.mjs: Theme not found:", themeName);
  }
}

export function setSnippetEditorsTheme(themeName) {
  const theme = themes[themeName];
  if (theme) {
    document.querySelectorAll(".snippet-editors").forEach((element) => {
      const snippetEditor = EditorView.findFromDOM(element);
      if (snippetEditor) {
        snippetEditor.dispatch({
          effects: themeCompartment.reconfigure(theme),
        });
      }
    });
  }
}
