import { EditorView } from "@codemirror/view";
import { createTheme } from "./createTheme.mjs";

import { uSEQ1337 } from "./builtinThemes/useq-1337.mjs";
import { amy } from "./builtinThemes/amy.js";
import { ayuLight } from "./builtinThemes/ayu-light.js";
import { useqDark } from "./builtinThemes/useq-dark.js";
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

// Editor base theme - These styles define the fundamental appearance of the CodeMirror editor
export const editorBaseTheme = EditorView.baseTheme({
  // Make the editor fill its container height
  "&": { height: "100%" },
  // Ensure the editor wrapper also fills the available height
  ".cm-wrap": { height: "100%" },
  // Set minimum height for both the content area and line number gutter
  ".cm-content, .cm-gutter": { minHeight: "100%" },
  // Style the main content area of the editor
  ".cm-content": {
    // Enable text wrapping while preserving whitespace
    whitespace: "pre-wrap",
    // Add vertical padding to the content area (Note: "passing" might be a typo of "padding")
    passing: "10px 0",
    // Allow content area to grow/shrink with a base size of 0
    flex: "1 1 0",
    // Set cursor color to match the primary text color defined in CSS variables
    caretColor: "var(--text-primary)",
  },
  // Remove the default focus outline from the editor
  "&.cm-focused": { outline: "0 !important" },
  // Style individual lines of code
  ".cm-line": {
    // Add horizontal padding to each line
    padding: "0 9px",
    // Set line height for comfortable reading
    "line-height": "1.6",
    // Use the monospace font defined in CSS variables
    "font-family": "var(--code-font)",
  },
  // Style matching brackets (like parentheses and braces)
  ".cm-matchingBracket": {
    // Add an underline to matching brackets using the primary text color
    "border-bottom": "1px solid var(--text-primary)",
    // Keep the original text color
    color: "inherit",
  },
  // Style the line number gutters
  ".cm-gutters": {
    // Make the gutter background transparent
    background: "transparent",
    // Remove the default border
    border: "none",
  },
  // Add some spacing to gutter elements (like line numbers)
  ".cm-gutterElement": { "margin-left": "5px" },
  // Enable scrolling for overflow content
  ".cm-scroller": { overflow: "auto" },
  // Hide the cursor when editor is not focused
  // ".cm-cursor": { visibility: "hidden" },
  // Show the cursor only when the editor is focused
  // "&.cm-focused .cm-cursor": { visibility: "visible" },
  ".cm-cursor": {
    display: "block",
  },
  ".cm-cursorLayer": {
    animation: "steps(1) cm-blink 1.2s infinite",
  },
});

const builtinThemes = [
  useqDark,
  amy,
  ayuLight,
  uSEQ1337,
  bespin,
  birdsOfParadise,
  boysAndGirls,
  clouds,
  cobalt,
  coolGlow,
  dracula,
  espresso,
  noctisLilac,
  rosePineDawn,
  solarizedLight,
  smoothy,
  tomorrow,
];

let themes = {};
let themeRecipes = {};

builtinThemes.forEach((themeRecipe) => {
  const name = themeRecipe.name;
  if (name) {
    themeRecipes[name] = themeRecipe;
    themes[name] = createTheme(themeRecipe);
  }
});

export { themes, themeRecipes };
