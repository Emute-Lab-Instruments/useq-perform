/**
 * Consolidated theme system for the uSEQ Perform editor.
 *
 * All theme specs live here as plain data. One pure function converts a spec
 * into a CodeMirror Extension. Theme application (CSS variables, vis palette,
 * compartment dispatch) is handled by simple exported functions — no manager
 * class.
 */

import { tags as t } from "@lezer/highlight";
import { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  syntaxHighlighting,
  HighlightStyle,
  type TagStyle,
} from "@codemirror/language";
import convert from "color-convert";
import { themeCompartment } from "../lib/editorCompartments.ts";
import { dbg } from "../lib/debug.ts";
import { editor as mainEditorSignal } from "../lib/editorStore.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ThemeVariant = "light" | "dark";

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

export interface ThemeSpec {
  name: string;
  variant: ThemeVariant;
  settings: ThemeSettings;
  styles: TagStyle[];
}

// ---------------------------------------------------------------------------
// Theme specs — all 17 themes as plain data
// ---------------------------------------------------------------------------

const themeSpecs: ThemeSpec[] = [
  // ---- uSEQ Dark ----
  {
    name: "uSEQ Dark",
    variant: "dark",
    settings: {
      background: "#15191EFA",
      foreground: "#EEF2F7",
      caret: "#C4C4C4",
      selection: "#90B2D557",
      gutterBackground: "#15191EFA",
      gutterForeground: "#aaaaaa95",
      lineHighlight: "#57575712",
      accentColor: "#A3D295",
    },
    styles: [
      { tag: t.comment, color: "#6E6E6E" },
      { tag: [t.string, t.regexp, t.special(t.brace)], color: "#5C81B3" },
      { tag: t.number, color: "#C1E1B8" },
      { tag: t.bool, color: "#53667D" },
      {
        tag: [t.definitionKeyword, t.modifier, t.function(t.propertyName)],
        color: "#A3D295",
        fontWeight: "bold",
      },
      {
        tag: [t.keyword, t.moduleKeyword, t.operatorKeyword, t.operator],
        color: "#697A8E",
        fontWeight: "bold",
      },
      { tag: [t.variableName, t.attributeName], color: "#708E67" },
      {
        tag: [
          t.function(t.variableName),
          t.definition(t.propertyName),
          t.derefOperator,
        ],
        color: "#fff",
      },
      { tag: t.tagName, color: "#A3D295" },
    ],
  },

  // ---- Amy ----
  {
    name: "Amy",
    variant: "dark",
    settings: {
      background: "#200020",
      foreground: "#D0D0FF",
      caret: "#7070FF",
      selection: "#80000080",
      gutterBackground: "#200020",
      gutterForeground: "#C080C0",
      lineHighlight: "#80000040",
      accentColor: "#60B0FF",
    },
    styles: [
      { tag: t.comment, color: "#404080" },
      { tag: [t.string, t.regexp], color: "#999999" },
      { tag: t.number, color: "#7090B0" },
      { tag: [t.bool, t.null], color: "#8080A0" },
      { tag: [t.punctuation, t.derefOperator], color: "#805080" },
      { tag: t.keyword, color: "#60B0FF" },
      { tag: t.definitionKeyword, color: "#B0FFF0" },
      { tag: t.moduleKeyword, color: "#60B0FF" },
      { tag: t.operator, color: "#A0A0FF" },
      { tag: [t.variableName, t.self], color: "#008080" },
      { tag: t.operatorKeyword, color: "#A0A0FF" },
      { tag: t.controlKeyword, color: "#80A0FF" },
      { tag: t.className, color: "#70E080" },
      { tag: [t.function(t.propertyName), t.propertyName], color: "#50A0A0" },
      { tag: t.tagName, color: "#009090" },
      { tag: t.modifier, color: "#B0FFF0" },
      { tag: [t.squareBracket, t.attributeName], color: "#D0D0FF" },
    ],
  },

  // ---- Ayu Light ----
  {
    name: "Ayu Light",
    variant: "light",
    settings: {
      background: "#fcfcfc",
      foreground: "#5c6166",
      caret: "#ffaa33",
      selection: "#036dd626",
      gutterBackground: "#fcfcfc",
      gutterForeground: "#8a919966",
      lineHighlight: "#8a91991a",
      accentColor: "#fa8d3e",
    },
    styles: [
      { tag: t.comment, color: "#787b8099" },
      { tag: t.string, color: "#86b300" },
      { tag: t.regexp, color: "#4cbf99" },
      { tag: [t.number, t.bool, t.null], color: "#ffaa33" },
      { tag: t.variableName, color: "#5c6166" },
      { tag: [t.definitionKeyword, t.modifier], color: "#fa8d3e" },
      { tag: [t.keyword, t.special(t.brace)], color: "#fa8d3e" },
      { tag: t.operator, color: "#ed9366" },
      { tag: t.separator, color: "#5c6166b3" },
      { tag: t.punctuation, color: "#5c6166" },
      {
        tag: [t.definition(t.propertyName), t.function(t.variableName)],
        color: "#f2ae49",
      },
      { tag: [t.className, t.definition(t.typeName)], color: "#22a4e6" },
      { tag: [t.tagName, t.typeName, t.self, t.labelName], color: "#55b4d4" },
      { tag: t.angleBracket, color: "#55b4d480" },
      { tag: t.attributeName, color: "#f2ae49" },
    ],
  },

  // ---- uSEQ 1337 ----
  {
    name: "uSEQ 1337",
    variant: "dark",
    settings: {
      background: "#0C1710",
      foreground: "#00FF41",
      caret: "#00FF41",
      selection: "#00FF4133",
      gutterBackground: "#0C1710",
      gutterForeground: "#00FF4180",
      lineHighlight: "#00FF411A",
      accentColor: "#00FF41",
    },
    styles: [
      { tag: t.comment, color: "#267F45" },
      { tag: [t.string, t.special(t.brace), t.regexp], color: "#00FF85" },
      {
        tag: [
          t.className,
          t.definition(t.propertyName),
          t.function(t.variableName),
          t.function(t.definition(t.variableName)),
          t.definition(t.typeName),
        ],
        color: "#39FF14",
      },
      { tag: [t.number, t.bool, t.null], color: "#04D939" },
      { tag: [t.keyword, t.operator], color: "#00FF41" },
      { tag: [t.definitionKeyword, t.modifier], color: "#50C878" },
      { tag: [t.variableName, t.self], color: "#98FF98" },
      {
        tag: [t.angleBracket, t.tagName, t.typeName, t.propertyName],
        color: "#32CD32",
      },
      { tag: t.derefOperator, color: "#90EE90" },
      { tag: t.attributeName, color: "#98FB98" },
      { tag: t.controlKeyword, color: "#00FF7F" },
      { tag: t.labelName, color: "#7FFF00" },
      { tag: t.punctuation, color: "#66FF66" },
    ],
  },

  // ---- Bespin ----
  {
    name: "Bespin",
    variant: "dark",
    settings: {
      background: "#2e241d",
      foreground: "#BAAE9E",
      caret: "#A7A7A7",
      selection: "#DDF0FF33",
      gutterBackground: "#28211C",
      gutterForeground: "#BAAE9E90",
      lineHighlight: "#FFFFFF08",
      accentColor: "#5EA6EA",
    },
    styles: [
      { tag: t.comment, color: "#666666" },
      { tag: [t.string, t.special(t.brace)], color: "#54BE0D" },
      { tag: t.regexp, color: "#E9C062" },
      { tag: t.number, color: "#CF6A4C" },
      { tag: [t.keyword, t.operator], color: "#5EA6EA" },
      { tag: t.variableName, color: "#7587A6" },
      { tag: [t.definitionKeyword, t.modifier], color: "#F9EE98" },
      {
        tag: [t.propertyName, t.function(t.variableName)],
        color: "#937121",
      },
      { tag: [t.typeName, t.angleBracket, t.tagName], color: "#9B859D" },
    ],
  },

  // ---- Birds of Paradise ----
  {
    name: "Birds of Paradise",
    variant: "dark",
    settings: {
      background: "#3b2627",
      foreground: "#E6E1C4",
      caret: "#E6E1C4",
      selection: "#16120E",
      gutterBackground: "#3b2627",
      gutterForeground: "#E6E1C490",
      lineHighlight: "#1F1611",
      accentColor: "#EF5D32",
    },
    styles: [
      { tag: t.comment, color: "#6B4E32" },
      { tag: [t.keyword, t.operator, t.derefOperator], color: "#EF5D32" },
      { tag: t.className, color: "#EFAC32", fontWeight: "bold" },
      {
        tag: [
          t.typeName,
          t.propertyName,
          t.function(t.variableName),
          t.definition(t.variableName),
        ],
        color: "#EFAC32",
      },
      { tag: t.definition(t.typeName), color: "#EFAC32", fontWeight: "bold" },
      { tag: t.labelName, color: "#EFAC32", fontWeight: "bold" },
      { tag: [t.number, t.bool], color: "#6C99BB" },
      { tag: [t.variableName, t.self], color: "#7DAF9C" },
      { tag: [t.string, t.special(t.brace), t.regexp], color: "#D9D762" },
      { tag: [t.angleBracket, t.tagName, t.attributeName], color: "#EFCB43" },
    ],
  },

  // ---- Night Lights ----
  {
    name: "Night Lights",
    variant: "dark",
    settings: {
      background: "#000205",
      foreground: "#FFFFFF",
      caret: "#E60065",
      selection: "#E60C6559",
      gutterBackground: "#000205",
      gutterForeground: "#ffffff90",
      lineHighlight: "#4DD7FC1A",
      accentColor: "#E62286",
    },
    styles: [
      { tag: t.comment, color: "#404040" },
      { tag: [t.string, t.special(t.brace), t.regexp], color: "#00D8FF" },
      { tag: t.number, color: "#E62286" },
      {
        tag: [t.variableName, t.attributeName, t.self],
        color: "#E62286",
        fontWeight: "bold",
      },
      { tag: t.function(t.variableName), color: "#fff", fontWeight: "bold" },
    ],
  },

  // ---- Clouds ----
  {
    name: "Clouds",
    variant: "light",
    settings: {
      background: "#fff",
      foreground: "#000",
      caret: "#000",
      selection: "#BDD5FC",
      gutterBackground: "#fff",
      gutterForeground: "#00000070",
      lineHighlight: "#FFFBD1",
      accentColor: "#5D90CD",
    },
    styles: [
      { tag: t.comment, color: "#BCC8BA" },
      { tag: [t.string, t.special(t.brace), t.regexp], color: "#5D90CD" },
      { tag: [t.number, t.bool, t.null], color: "#46A609" },
      { tag: t.keyword, color: "#AF956F" },
      { tag: [t.definitionKeyword, t.modifier], color: "#C52727" },
      { tag: [t.angleBracket, t.tagName, t.attributeName], color: "#606060" },
      { tag: t.self, color: "#000" },
    ],
  },

  // ---- Cobalt ----
  {
    name: "Cobalt",
    variant: "dark",
    settings: {
      background: "#00254b",
      foreground: "#FFFFFF",
      caret: "#FFFFFF",
      selection: "#B36539BF",
      gutterBackground: "#00254b",
      gutterForeground: "#FFFFFF70",
      lineHighlight: "#00000059",
      accentColor: "#FFDD00",
    },
    styles: [
      { tag: t.comment, color: "#0088FF" },
      { tag: t.string, color: "#3AD900" },
      { tag: t.regexp, color: "#80FFC2" },
      { tag: [t.number, t.bool, t.null], color: "#FF628C" },
      { tag: [t.definitionKeyword, t.modifier], color: "#FFEE80" },
      { tag: t.variableName, color: "#CCCCCC" },
      { tag: t.self, color: "#FF80E1" },
      {
        tag: [
          t.className,
          t.definition(t.propertyName),
          t.function(t.variableName),
          t.definition(t.typeName),
          t.labelName,
        ],
        color: "#FFDD00",
      },
      { tag: [t.keyword, t.operator], color: "#FF9D00" },
      { tag: [t.propertyName, t.typeName], color: "#80FFBB" },
      { tag: t.special(t.brace), color: "#EDEF7D" },
      { tag: t.attributeName, color: "#9EFFFF" },
      { tag: t.derefOperator, color: "#fff" },
    ],
  },

  // ---- Cool Glow ----
  {
    name: "Cool Glow",
    variant: "dark",
    settings: {
      background: "#060521",
      foreground: "#E0E0E0",
      caret: "#FFFFFFA6",
      selection: "#122BBB",
      gutterBackground: "#060521",
      gutterForeground: "#E0E0E090",
      lineHighlight: "#FFFFFF0F",
      accentColor: "#2BF1DC",
    },
    styles: [
      { tag: t.comment, color: "#AEAEAE" },
      { tag: [t.string, t.special(t.brace), t.regexp], color: "#8DFF8E" },
      {
        tag: [
          t.className,
          t.definition(t.propertyName),
          t.function(t.variableName),
          t.function(t.definition(t.variableName)),
          t.definition(t.typeName),
        ],
        color: "#A3EBFF",
      },
      { tag: [t.number, t.bool, t.null], color: "#62E9BD" },
      { tag: [t.keyword, t.operator], color: "#2BF1DC" },
      { tag: [t.definitionKeyword, t.modifier], color: "#F8FBB1" },
      { tag: [t.variableName, t.self], color: "#B683CA" },
      {
        tag: [t.angleBracket, t.tagName, t.typeName, t.propertyName],
        color: "#60A4F1",
      },
      { tag: t.derefOperator, color: "#E0E0E0" },
      { tag: t.attributeName, color: "#7BACCA" },
    ],
  },

  // ---- Dracula ----
  {
    name: "Dracula",
    variant: "dark",
    settings: {
      background: "#2d2f3f",
      foreground: "#f8f8f2",
      caret: "#f8f8f0",
      selection: "#44475a",
      gutterBackground: "#282a36",
      gutterForeground: "rgb(144, 145, 148)",
      lineHighlight: "#44475a",
      accentColor: "#bd93f9",
    },
    styles: [
      { tag: t.comment, color: "#6272a4" },
      { tag: [t.string, t.special(t.brace)], color: "#f1fa8c" },
      { tag: [t.number, t.self, t.bool, t.null], color: "#bd93f9" },
      { tag: [t.keyword, t.operator], color: "#ff79c6" },
      { tag: [t.definitionKeyword, t.typeName], color: "#8be9fd" },
      { tag: t.definition(t.typeName), color: "#f8f8f2" },
      {
        tag: [
          t.className,
          t.definition(t.propertyName),
          t.function(t.variableName),
          t.attributeName,
        ],
        color: "#50fa7b",
      },
    ],
  },

  // ---- Espresso ----
  {
    name: "Espresso",
    variant: "light",
    settings: {
      background: "#FFFFFF",
      foreground: "#000000",
      caret: "#000000",
      selection: "#80C7FF",
      gutterBackground: "#FFFFFF",
      gutterForeground: "#00000070",
      lineHighlight: "#C1E2F8",
      accentColor: "#2F6F9F",
    },
    styles: [
      { tag: t.comment, color: "#AAAAAA" },
      {
        tag: [t.keyword, t.operator, t.typeName, t.tagName, t.propertyName],
        color: "#2F6F9F",
        fontWeight: "bold",
      },
      {
        tag: [t.attributeName, t.definition(t.propertyName)],
        color: "#4F9FD0",
      },
      { tag: [t.className, t.string, t.special(t.brace)], color: "#CF4F5F" },
      { tag: t.number, color: "#CF4F5F", fontWeight: "bold" },
      { tag: t.variableName, fontWeight: "bold" },
    ],
  },

  // ---- Noctis Lilac ----
  {
    name: "Noctis Lilac",
    variant: "light",
    settings: {
      background: "#f2f1f8",
      foreground: "#0c006b",
      caret: "#5c49e9",
      selection: "#d5d1f2",
      gutterBackground: "#f2f1f8",
      gutterForeground: "#0c006b70",
      lineHighlight: "#e1def3",
      accentColor: "#5842ff",
    },
    styles: [
      { tag: t.comment, color: "#9995b7" },
      { tag: t.keyword, color: "#ff5792", fontWeight: "bold" },
      { tag: [t.definitionKeyword, t.modifier], color: "#ff5792" },
      {
        tag: [t.className, t.tagName, t.definition(t.typeName)],
        color: "#0094f0",
      },
      { tag: [t.number, t.bool, t.null, t.special(t.brace)], color: "#5842ff" },
      {
        tag: [t.definition(t.propertyName), t.function(t.variableName)],
        color: "#0095a8",
      },
      { tag: t.typeName, color: "#b3694d" },
      { tag: [t.propertyName, t.variableName], color: "#fa8900" },
      { tag: t.operator, color: "#ff5792" },
      { tag: t.self, color: "#e64100" },
      { tag: [t.string, t.regexp], color: "#00b368" },
      { tag: [t.paren, t.bracket], color: "#0431fa" },
      { tag: t.labelName, color: "#00bdd6" },
      { tag: t.attributeName, color: "#e64100" },
      { tag: t.angleBracket, color: "#9995b7" },
    ],
  },

  // ---- Rose Pine Dawn ----
  {
    name: "Rosé Pine Dawn",
    variant: "light",
    settings: {
      background: "#faf4ed",
      foreground: "#575279",
      caret: "#575279",
      selection: "#6e6a8614",
      gutterBackground: "#faf4ed",
      gutterForeground: "#57527970",
      lineHighlight: "#6e6a860d",
      accentColor: "#286983",
    },
    styles: [
      { tag: t.comment, color: "#9893a5" },
      { tag: [t.bool, t.null], color: "#286983" },
      { tag: t.number, color: "#d7827e" },
      { tag: t.className, color: "#d7827e" },
      { tag: [t.angleBracket, t.tagName, t.typeName], color: "#56949f" },
      { tag: t.attributeName, color: "#907aa9" },
      { tag: t.punctuation, color: "#797593" },
      { tag: [t.keyword, t.modifier], color: "#286983" },
      { tag: [t.string, t.regexp], color: "#ea9d34" },
      { tag: t.variableName, color: "#d7827e" },
    ],
  },

  // ---- Solarized Light ----
  {
    name: "Solarized Light",
    variant: "light",
    settings: {
      background: "#fef7e5",
      foreground: "#586E75",
      caret: "#000000",
      selection: "#073642",
      gutterBackground: "#fef7e5",
      gutterForeground: "#586E7580",
      lineHighlight: "#EEE8D5",
      accentColor: "#268BD2",
    },
    styles: [
      { tag: t.comment, color: "#93A1A1" },
      { tag: t.string, color: "#2AA198" },
      { tag: t.regexp, color: "#D30102" },
      { tag: t.number, color: "#D33682" },
      { tag: t.variableName, color: "#268BD2" },
      { tag: [t.keyword, t.operator, t.punctuation], color: "#859900" },
      {
        tag: [t.definitionKeyword, t.modifier],
        color: "#073642",
        fontWeight: "bold",
      },
      {
        tag: [t.className, t.self, t.definition(t.propertyName)],
        color: "#268BD2",
      },
      { tag: t.function(t.variableName), color: "#268BD2" },
      { tag: [t.bool, t.null], color: "#B58900" },
      { tag: t.tagName, color: "#268BD2", fontWeight: "bold" },
      { tag: t.angleBracket, color: "#93A1A1" },
      { tag: t.attributeName, color: "#93A1A1" },
      { tag: t.typeName, color: "#859900" },
    ],
  },

  // ---- Smoothy ----
  {
    name: "Smoothy",
    variant: "light",
    settings: {
      background: "#FFFFFF",
      foreground: "#000000",
      caret: "#000000",
      selection: "#FFFD0054",
      gutterBackground: "#FFFFFF",
      gutterForeground: "#00000070",
      lineHighlight: "#00000008",
      accentColor: "#2EB43B",
    },
    styles: [
      { tag: t.comment, color: "#CFCFCF" },
      { tag: [t.number, t.bool, t.null], color: "#E66C29" },
      {
        tag: [
          t.className,
          t.definition(t.propertyName),
          t.function(t.variableName),
          t.labelName,
          t.definition(t.typeName),
        ],
        color: "#2EB43B",
      },
      { tag: t.keyword, color: "#D8B229" },
      { tag: t.operator, color: "#4EA44E", fontWeight: "bold" },
      { tag: [t.definitionKeyword, t.modifier], color: "#925A47" },
      { tag: t.string, color: "#704D3D" },
      { tag: t.typeName, color: "#2F8996" },
      { tag: [t.variableName, t.propertyName], color: "#77ACB0" },
      { tag: t.self, color: "#77ACB0", fontWeight: "bold" },
      { tag: t.regexp, color: "#E3965E" },
      { tag: [t.tagName, t.angleBracket], color: "#BAA827" },
      { tag: t.attributeName, color: "#B06520" },
      { tag: t.derefOperator, color: "#000" },
    ],
  },

  // ---- Tomorrow ----
  {
    name: "Tomorrow",
    variant: "light",
    settings: {
      background: "#FFFFFF",
      foreground: "#4D4D4C",
      caret: "#AEAFAD",
      selection: "#D6D6D6",
      gutterBackground: "#FFFFFF",
      gutterForeground: "#4D4D4C80",
      lineHighlight: "#EFEFEF",
      accentColor: "#8959A8",
    },
    styles: [
      { tag: t.comment, color: "#8E908C" },
      {
        tag: [
          t.variableName,
          t.self,
          t.propertyName,
          t.attributeName,
          t.regexp,
        ],
        color: "#C82829",
      },
      { tag: [t.number, t.bool, t.null], color: "#F5871F" },
      {
        tag: [t.className, t.typeName, t.definition(t.typeName)],
        color: "#C99E00",
      },
      { tag: [t.string, t.special(t.brace)], color: "#718C00" },
      { tag: t.operator, color: "#3E999F" },
      {
        tag: [t.definition(t.propertyName), t.function(t.variableName)],
        color: "#4271AE",
      },
      { tag: t.keyword, color: "#8959A8" },
      { tag: t.derefOperator, color: "#4D4D4C" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Derived lookups — built once at module load
// ---------------------------------------------------------------------------

/** Name -> ThemeSpec lookup. */
export const themeSpecsByName: Record<string, ThemeSpec> = Object.create(null);

/** Name -> compiled CodeMirror Extension lookup. */
export const themes: Record<string, Extension[]> = Object.create(null);

/** Ordered list of theme names. */
export const themeNames: string[] = [];

for (const spec of themeSpecs) {
  themeSpecsByName[spec.name] = spec;
  themes[spec.name] = createThemeExtension(spec);
  themeNames.push(spec.name);
}

// Re-export themeRecipes as an alias for themeSpecsByName (consumed by the
// legacy migration path in appSettings which indexes by name).
export { themeSpecsByName as themeRecipes };

// ---------------------------------------------------------------------------
// createThemeExtension — pure function, spec -> CodeMirror Extension[]
// ---------------------------------------------------------------------------

export function createThemeExtension(spec: ThemeSpec): Extension[] {
  const { variant, settings, styles } = spec;

  if (!settings) {
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
    { dark: variant === "dark" },
  );

  const highlightStyle = HighlightStyle.define(styles);
  return [theme, syntaxHighlighting(highlightStyle)];
}

// ---------------------------------------------------------------------------
// Editor base theme — structural styles independent of color themes
// ---------------------------------------------------------------------------

export const editorBaseTheme = EditorView.baseTheme({
  "&": { height: "100%" },
  ".cm-wrap": { height: "100%" },
  ".cm-content, .cm-gutter": { minHeight: "100%" },
  ".cm-content": {
    whitespace: "pre-wrap",
    passing: "10px 0",
    flex: "1 1 0",
    caretColor: "var(--text-primary)",
  },
  "&.cm-focused": { outline: "0 !important" },
  ".cm-line": {
    padding: "0 9px",
    "line-height": "1.6",
    "font-family": "var(--code-font)",
  },
  ".cm-matchingBracket": {
    "border-bottom": "1px solid var(--text-primary)",
    color: "inherit",
  },
  ".cm-gutters": {
    background: "transparent",
    border: "none",
  },
  ".cm-gutterElement": { "margin-left": "5px" },
  ".cm-scroller": { overflow: "auto" },
  ".cm-cursor": { display: "block" },
  ".cm-cursorLayer": {
    animation: "steps(1) cm-blink 1.2s infinite",
  },
});

// ---------------------------------------------------------------------------
// Theme application — replaces the old themeManager
// ---------------------------------------------------------------------------

/** Dispatch a theme into an editor view via the shared compartment. */
export function setTheme(editor: EditorView, themeName: string): boolean {
  const theme = themes[themeName];
  if (theme) {
    editor.dispatch({
      effects: themeCompartment.reconfigure(theme),
    });
    return true;
  }
  console.error("themes: Theme not found:", themeName);
  return false;
}

/**
 * Apply a theme to the main editor, CSS variables, and vis palette.
 * This is the primary entry-point that UI code calls when the user picks a
 * theme.
 */
export function setMainEditorTheme(themeName: string): void {
  dbg("setMainEditorTheme:", themeName);

  const spec = themeSpecsByName[themeName];
  if (!spec) {
    console.error("themes: Theme spec not found:", themeName);
    return;
  }

  // Always update CSS variables.
  applyThemeCssVariables(spec);

  // Update the serial visualisation palette based on theme variant.
  if (spec.variant === "dark") {
    import("../lib/visualisationUtils.ts").then((module) => {
      if (module.setSerialVisPalette && module.serialVisPaletteDark) {
        module.setSerialVisPalette(module.serialVisPaletteDark);
      }
    });
  } else {
    import("../lib/visualisationUtils.ts").then((module) => {
      if (module.setSerialVisPalette && module.serialVisPaletteLight) {
        module.setSerialVisPalette(module.serialVisPaletteLight);
      }
    });
  }

  // Apply the CodeMirror theme if the editor is available.
  const editor = mainEditorSignal();
  if (editor) {
    setTheme(editor, themeName);
  } else {
    dbg(
      "Editor session not available, CSS variables updated but editor theme deferred",
    );
  }
}

// Stub — snippet editors theme switching is not yet implemented.
export function setSnippetEditorsTheme(_themeName: string): void {
  // TODO
}

// ---------------------------------------------------------------------------
// CSS variable injection
// ---------------------------------------------------------------------------

function adjustColorBrightness(hex: string, percent: number): string {
  hex = hex.replace(/^#/, "");
  let r = parseInt(hex.substring(0, 2), 16);
  let g = parseInt(hex.substring(2, 4), 16);
  let b = parseInt(hex.substring(4, 6), 16);

  r = Math.max(0, Math.min(255, r + (r * percent) / 100));
  g = Math.max(0, Math.min(255, g + (g * percent) / 100));
  b = Math.max(0, Math.min(255, b + (b * percent) / 100));

  return (
    "#" +
    [r, g, b]
      .map((x) => {
        const h = Math.round(x).toString(16);
        return h.length === 1 ? "0" + h : h;
      })
      .join("")
  );
}

function applyThemeCssVariables(spec: ThemeSpec): void {
  const { settings, variant } = spec;
  const backgroundColor = settings.background;
  const foregroundColor = settings.foreground;
  const isLightTheme = variant === "light";

  document.documentElement.style.setProperty(
    "--editor-background",
    backgroundColor,
  );
  if (document.body) {
    document.body.style.backgroundColor = backgroundColor;
  }

  // Derive adjusted backgrounds for console / help panels.
  const consoleRatio = 1.25;
  const helpRatio = 1.15;

  let adjustedConsoleBackground = backgroundColor;
  let adjustedHelpBackground = backgroundColor;

  if (backgroundColor.startsWith("#")) {
    const stripped = backgroundColor.replace(/^#/, "").substring(0, 6);

    const consoleHsv = convert.hex.hsv(stripped);
    consoleHsv[2] = Math.max(0, Math.min(100, consoleHsv[2] * consoleRatio));
    adjustedConsoleBackground = "#" + convert.hsv.hex(consoleHsv);

    const helpHsv = convert.hex.hsv(stripped);
    helpHsv[2] = Math.max(0, Math.min(100, helpHsv[2] * helpRatio));
    adjustedHelpBackground = "#" + convert.hsv.hex(helpHsv);
  }

  // Update toolbar panel.
  const toolbarPanel = document.getElementById("panel-toolbar");
  if (toolbarPanel) {
    toolbarPanel.style.backgroundColor = adjustedConsoleBackground;
    toolbarPanel.style.borderColor = foregroundColor;
  }

  const docStyle = document.documentElement.style;

  if (isLightTheme) {
    const panelControlBg = "#f0f0f0";
    const panelBorder = "#cccccc";
    const panelItemHoverBg = "#e5e5e5";
    const panelItemActiveBg = "#d5d5d5";
    const textPrimary = "#333333";
    const textSecondary = "#555555";
    const textMuted = "#777777";
    const panelSectionBg = "#f8f8f8";

    docStyle.setProperty("--panel-bg", adjustedHelpBackground + "F0");
    docStyle.setProperty("--toolbar-bg", adjustedConsoleBackground);
    docStyle.setProperty("--panel-border", panelBorder);
    docStyle.setProperty("--panel-section-bg", panelSectionBg);
    docStyle.setProperty("--panel-item-hover-bg", panelItemHoverBg);
    docStyle.setProperty("--panel-item-active-bg", panelItemActiveBg);
    docStyle.setProperty("--panel-control-bg", panelControlBg);
    docStyle.setProperty("--text-primary", textPrimary);
    docStyle.setProperty("--text-secondary", textSecondary);
    docStyle.setProperty("--text-muted", textMuted);
    docStyle.setProperty(
      "--accent-color",
      settings.accentColor || "#0066cc",
    );
    docStyle.setProperty(
      "--accent-color-hover",
      adjustColorBrightness(settings.accentColor || "#0066cc", 10),
    );
    docStyle.setProperty(
      "--accent-color-active",
      adjustColorBrightness(settings.accentColor || "#0066cc", -10),
    );
  } else {
    docStyle.setProperty("--panel-bg", adjustedHelpBackground + "F0");
    docStyle.setProperty("--toolbar-bg", adjustedConsoleBackground);
    docStyle.setProperty("--panel-border", "rgba(255, 255, 255, 0.2)");
    docStyle.setProperty(
      "--panel-section-bg",
      adjustedHelpBackground + "E0",
    );
    docStyle.setProperty(
      "--panel-item-hover-bg",
      "rgba(255, 255, 255, 0.1)",
    );
    docStyle.setProperty(
      "--panel-item-active-bg",
      "rgba(255, 255, 255, 0.15)",
    );
    docStyle.setProperty("--panel-control-bg", "rgba(0, 0, 0, 0.2)");
    docStyle.setProperty("--text-primary", foregroundColor);
    docStyle.setProperty("--text-secondary", "rgba(255, 255, 255, 0.7)");
    docStyle.setProperty("--text-muted", "rgba(255, 255, 255, 0.5)");
    docStyle.setProperty(
      "--accent-color",
      settings.accentColor || foregroundColor,
    );
    docStyle.setProperty(
      "--accent-color-hover",
      adjustColorBrightness(settings.accentColor || foregroundColor, 10),
    );
    docStyle.setProperty(
      "--accent-color-active",
      adjustColorBrightness(settings.accentColor || foregroundColor, -10),
    );
  }
}
