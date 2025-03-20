import { EditorView } from "@codemirror/view";
import { themeCompartment } from "../state.mjs";
import { registerBuiltinThemes } from "./builtinThemes.mjs";

// Create themes registry
let themes = {};
registerBuiltinThemes(themes);

export {themes};

export function setTheme(editor, themeName) {
  const theme = themes[themeName];
  if (theme) {
    editor.dispatch({
      effects: themeCompartment.reconfigure(theme),
    });

    setSnippetEditorsTheme(themeName);
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
