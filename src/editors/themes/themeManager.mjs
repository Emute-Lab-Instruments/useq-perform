import { EditorView } from "@codemirror/view";
import { themeCompartment } from "../state.mjs";
import { themes, themeRecipes } from "./builtinThemes.mjs";
// import { convert } from "color-convert";

export { themes, themeRecipes };

export function setTheme(editor, themeName) {
  const theme = themes[themeName];
  if (theme) {
    editor.dispatch({
      effects: themeCompartment.reconfigure(theme),
    });

    return true;
  } else {
    console.error("themeManager.mjs: Theme not found:", themeName);
    return false;
  }
}

export function setMainEditorTheme(themeName) {
  console.log("themename:", themeName);
  const editor = EditorView.findFromDOM(document.querySelector("#panel-main-editor .cm-editor"));
  const success = setTheme(editor, themeName);
  if (success) {
    setSnippetEditorsTheme(themeName);

    const theme = themes[themeName];
    // Set text-primary color based on theme variant
    // const theme = themes[themeName];
    // if (theme && Array.isArray(theme)) {
    //   const isDark = theme.some(ext => {
    //     if (typeof ext === 'object' && ext.extension && ext.extension.value === true) {
    //       return true;
    //     }
    //     return false;
    //   });
    //   document.documentElement.style.setProperty('--text-primary', isDark ? 'white' : 'black');
    // }

    const themeRecipe = themeRecipes[themeName];
    const backgroundColor = themeRecipe.settings.background;
    const foregroundColor = themeRecipe.settings.foreground;

    $("#panel-console").css({
      backgroundColor: backgroundColor,
      color: foregroundColor,
      //"border-color": themeRecipe.settings.foreground,
      "box-shadow": `0 4px 12px ${themeRecipe.settings.foreground}`,
    });

    // $("#panel-toolbar").css({
    //   backgroundColor: backgroundColor,
    //   color: foregroundColor,
    // });

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
