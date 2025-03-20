import { EditorView } from "@codemirror/view";
import { registerTheme } from "./createTheme.mjs";

import { useqDark } from "./builtinThemes/useq-dark.mjs";
import { amy } from "./builtinThemes/amy.js";
import { ayuLight } from "./builtinThemes/ayu-light.js";
import { barf } from "./builtinThemes/barf.js";
import { bespin } from "./builtinThemes/bespin.js";
import { birdsOfParadise } from "./builtinThemes/birds-of-paradise.js";
import { boysAndGirls } from "./builtinThemes/boys-and-girls.js";
import { clouds } from "./builtinThemes/clouds.js";
import { cobalt } from "./builtinThemes/cobalt.js";
import { coolGlow } from "./builtinThemes/cool-glow.js";
import { dracula } from "./builtinThemes/dracula.js";
import { espresso } from "./builtinThemes/espresso.js";
import { noctisLilac } from "./builtinThemes/noctis-lilac.js";
import { rosePineDawn } from "./builtinThemes/rose-pine-dawn.js";
import { solarizedLight } from "./builtinThemes/solarized-light.js";
import { smoothy } from "./builtinThemes/smoothy.js";
import { tomorrow } from "./builtinThemes/tomorrow.js";

// Editor base theme
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
  ".cm-cursor": { visibility: "hidden" },
  "&.cm-focused .cm-cursor": { visibility: "visible" },
});

export function registerBuiltinThemes(themesRegistry) {
  // Register all built-in themes
  registerTheme(themesRegistry, "uSEQ Dark", useqDark);
  registerTheme(themesRegistry, "Amy", amy);
  registerTheme(themesRegistry, "Ayu Light", ayuLight);
  registerTheme(themesRegistry, "Barf", barf);
  registerTheme(themesRegistry, "Bespin", bespin);
  registerTheme(themesRegistry, "Birds of Paradise", birdsOfParadise);
  registerTheme(themesRegistry, "Boys and Girls", boysAndGirls);
  registerTheme(themesRegistry, "Clouds", clouds);
  registerTheme(themesRegistry, "Cobalt", cobalt);
  registerTheme(themesRegistry, "Cool Glow", coolGlow);
  registerTheme(themesRegistry, "Dracula", dracula);
  registerTheme(themesRegistry, "Espresso", espresso);
  registerTheme(themesRegistry, "Noctis Lilac", noctisLilac);
  registerTheme(themesRegistry, "Rosé Pine Dawn", rosePineDawn);
  registerTheme(themesRegistry, "Solarized Light", solarizedLight);
  registerTheme(themesRegistry, "Smoothy", smoothy);
  registerTheme(themesRegistry, "Tomorrow", tomorrow);
}
