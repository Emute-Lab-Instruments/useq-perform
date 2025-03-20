import { EditorView } from "@codemirror/view";
import { syntaxHighlighting, HighlightStyle } from "@codemirror/language";

/**
 * @typedef {'light' | 'dark'} Variant
 */

/**
 * @typedef {Object} Settings
 * @property {string} background - Editor background
 * @property {string} foreground - Default text color
 * @property {string} caret - Caret color
 * @property {string} selection - Selection background
 * @property {string} lineHighlight - Background of highlighted lines
 * @property {string} gutterBackground - Gutter background
 * @property {string} gutterForeground - Text color inside gutter
 */

/**
 * @typedef {Object} Options
 * @property {Variant} variant - Theme variant. Determines which styles CodeMirror will apply by default
 * @property {Settings} settings - Settings to customize the look of the editor
 * @property {import('@codemirror/language').TagStyle[]} styles - Syntax highlighting styles
 */

/**
 * Creates a CodeMirror theme extension
 */
export function createTheme({ variant, settings, styles }) {
  console.log(
    "themeManager.mjs: Creating theme with variant, settings, styles:",
    { variant, settings, styles }
  );

  if (!settings) {
    console.error("themeManager.mjs: Missing settings in theme configuration");
    throw new Error("Missing settings in theme configuration");
  }

  const theme = EditorView.theme(
    {
      "&": {
        backgroundColor: settings.background,
        color: settings.foreground,
      },
      ".cm-content": {
        caretColor: settings.caret,
      },
      ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: settings.caret,
      },
      "&.cm-focused .cm-selectionBackground, .cm-content ::selection": {
        backgroundColor: settings.selection,
      },
      ".cm-activeLine": {
        backgroundColor: settings.lineHighlight,
      },
      ".cm-gutters": {
        backgroundColor: settings.gutterBackground,
        color: settings.gutterForeground,
      },
      ".cm-activeLineGutter": {
        backgroundColor: settings.lineHighlight,
      },
    },
    {
      dark: variant === "dark",
    }
  );

  console.log("themeManager.mjs: Created base theme");

  const highlightStyle = HighlightStyle.define(styles);
  console.log("themeManager.mjs: Created highlight style");

  const extension = [theme, syntaxHighlighting(highlightStyle)];
  console.log("themeManager.mjs: Created theme extension");

  return extension;
}

export function registerTheme(registry, name, theme) {
  console.log("themeManager.mjs: Registering theme:", name);
  registry[name] = theme;
}
