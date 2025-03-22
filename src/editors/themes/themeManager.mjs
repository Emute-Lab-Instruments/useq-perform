import { EditorView } from "@codemirror/view";
import { themeCompartment } from "../state.mjs";
import { themes, themeRecipes } from "./builtinThemes.mjs";
import convert from "color-convert";

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

function adjustPanelsToTheme(themeName) {
  const theme = themes[themeName];
  const themeRecipe = themeRecipes[themeName];
  const backgroundColor = themeRecipe.settings.background;
  const foregroundColor = themeRecipe.settings.foreground;

  // Adjust panel background colors based on theme variant
  const consoleAdjustmentPercentage = 0.25;
  const helpAdjustmentPercentage = 0.15; // Slightly less adjustment for help panel
  const consoleAdjustmentRatio = 1 + consoleAdjustmentPercentage;
  const helpAdjustmentRatio = 1 + helpAdjustmentPercentage;
  
  let adjustedConsoleBackground = backgroundColor;
  let adjustedHelpBackground = backgroundColor;
  
  if (backgroundColor.startsWith("#")) {
    // Convert hex to HSV for console
    const consoleHsv = convert.hex.hsv(backgroundColor.substring(1));
    // Adjust vibrancy
    consoleHsv[2] = Math.max(0, Math.min(100, consoleHsv[2] * consoleAdjustmentRatio));
    // Convert back to hex
    adjustedConsoleBackground = "#" + convert.hsv.hex(consoleHsv);
    
    // Convert hex to HSV for help panel
    const helpHsv = convert.hex.hsv(backgroundColor.substring(1));
    // Adjust vibrancy and add opacity
    helpHsv[2] = Math.max(0, Math.min(100, helpHsv[2] * helpAdjustmentRatio));
    // Convert back to hex
    adjustedHelpBackground = "#" + convert.hsv.hex(helpHsv);
  }

  // Update console panel
  $("#panel-console").css({
    backgroundColor: adjustedConsoleBackground,
    color: foregroundColor,
    "box-shadow": `0 4px 12px ${themeRecipe.settings.foreground}`,
    "border-color": themeRecipe.settings.foreground,
  });
  
  // Update help panel
  $("#panel-help").css({
    backgroundColor: adjustedHelpBackground + "F0", // Add 94% opacity
    color: foregroundColor,
    "border-color": themeRecipe.settings.foreground,
  });
  
  // Update toolbar panel
  $("#panel-toolbar").css({
    backgroundColor: adjustedConsoleBackground,
    "border-color": themeRecipe.settings.foreground,
  });
  
  // Update CSS variables for other panels to use
  document.documentElement.style.setProperty('--panel-bg', adjustedHelpBackground + "F0");
  document.documentElement.style.setProperty('--toolbar-bg', adjustedConsoleBackground);
  document.documentElement.style.setProperty('--accent-color', themeRecipe.settings.accent || foregroundColor);
}

export function setMainEditorTheme(themeName) {
  console.log("themename:", themeName);
  const editor = EditorView.findFromDOM(
    document.querySelector("#panel-main-editor .cm-editor")
  );
  const success = setTheme(editor, themeName);
  if (success) {
    setSnippetEditorsTheme(themeName);
    
    // Update the serial visualization palette based on theme variant
    if (themeRecipes[themeName] && themeRecipes[themeName].variant === "dark") {
      // Import and use the setter function from serialVis module
      import("../../ui/serialVis.mjs").then(module => {
        if (module.setSerialVisPalette && module.serialVisPaletteDark) {
          module.setSerialVisPalette(module.serialVisPaletteDark);
        }
      });
    } else {
      // Use light theme palette for light themes
      import("../../ui/serialVis.mjs").then(module => {
        if (module.setSerialVisPalette && module.serialVisPaletteLight) {
          module.setSerialVisPalette(module.serialVisPaletteLight);
        }
      });
    }
    
    adjustPanelsToTheme(themeName);
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
