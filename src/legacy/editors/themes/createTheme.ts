import { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { syntaxHighlighting, HighlightStyle, TagStyle } from "@codemirror/language";

export type ThemeVariant = 'light' | 'dark';

export interface ThemeSettings {
  background: string;
  foreground: string;
  caret: string;
  selection: string;
  lineHighlight: string;
  gutterBackground: string;
  gutterForeground: string;
  accentColor?: string;
}

export interface ThemeRecipe {
  name: string;
  variant: ThemeVariant;
  settings: ThemeSettings;
  styles: TagStyle[];
}

/**
 * Creates a CodeMirror theme extension
 */
export function createTheme({ name = null, variant, settings, styles }: {
  name?: string | null;
  variant: ThemeVariant;
  settings: ThemeSettings;
  styles: TagStyle[];
}): Extension[] {
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

  const highlightStyle = HighlightStyle.define(styles);
  const extension = [theme, syntaxHighlighting(highlightStyle)];

  return extension;
}
