// @ts-nocheck
import { themeCompartment } from "../state.ts";
import { themes, themeRecipes } from "./builtinThemes.ts";
import convert from "color-convert";
import { dbg } from "../../utils.ts";
import { editor as mainEditor } from "../../../lib/editorStore.ts";

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
  dbg("themename:", themeName);

  if (!themeRecipes[themeName]) {
    console.error("themeManager.mjs: Theme recipe not found:", themeName);
    return false;
  }

  // Always update CSS variables — this doesn't depend on the editor signal.
  adjustPanelsToTheme(themeName);

  // Update the serial visualization palette based on theme variant
  if (themeRecipes[themeName].variant === "dark") {
    import("../../ui/serialVis/serialVis.ts").then(module => {
      if (module.setSerialVisPalette && module.serialVisPaletteDark) {
        module.setSerialVisPalette(module.serialVisPaletteDark);
      }
    });
  } else {
    import("../../ui/serialVis/serialVis.ts").then(module => {
      if (module.setSerialVisPalette && module.serialVisPaletteLight) {
        module.setSerialVisPalette(module.serialVisPaletteLight);
      }
    });
  }

  // Apply the CodeMirror theme if the editor is available.
  const editor = mainEditor();
  if (editor) {
    setTheme(editor, themeName);
    setSnippetEditorsTheme(themeName);
  } else {
    dbg("Editor session not available, CSS variables updated but editor theme deferred");
  }
}

export function setSnippetEditorsTheme(themeName) {
  const theme = themes[themeName];
  // TODO
}


// Update CSS variables based on theme
function adjustPanelsToTheme(themeName) {
  const theme = themes[themeName];
  const themeRecipe = themeRecipes[themeName];
  const backgroundColor = themeRecipe.settings.background;
  const foregroundColor = themeRecipe.settings.foreground;
  const isLightTheme = themeRecipe.variant === "light";

  document.documentElement.style.setProperty('--editor-background', backgroundColor);
  if (document.body) {
    document.body.style.backgroundColor = backgroundColor;
  }
  
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
  
  // Update toolbar panel
  const toolbarPanel = document.getElementById("panel-toolbar");
  if (toolbarPanel) {
    toolbarPanel.style.backgroundColor = adjustedConsoleBackground;
    toolbarPanel.style.borderColor = themeRecipe.settings.foreground;
  }
  
  // For light themes, we need to adjust contrast on form controls and borders
  if (isLightTheme) {
    // Create contrasting colors for light themes
    let panelControlBg = "#f0f0f0";
    let panelBorder = "#cccccc";
    let panelItemHoverBg = "#e5e5e5";
    let panelItemActiveBg = "#d5d5d5";
    let textPrimary = "#333333";
    let textSecondary = "#555555";
    let textMuted = "#777777";
    let panelSectionBg = "#f8f8f8";
    
    // Update CSS variables for light theme
    document.documentElement.style.setProperty('--panel-bg', adjustedHelpBackground + "F0");
    document.documentElement.style.setProperty('--toolbar-bg', adjustedConsoleBackground);
    document.documentElement.style.setProperty('--panel-border', panelBorder);
    document.documentElement.style.setProperty('--panel-section-bg', panelSectionBg);
    document.documentElement.style.setProperty('--panel-item-hover-bg', panelItemHoverBg);
    document.documentElement.style.setProperty('--panel-item-active-bg', panelItemActiveBg);
    document.documentElement.style.setProperty('--panel-control-bg', panelControlBg);
    document.documentElement.style.setProperty('--text-primary', textPrimary);
    document.documentElement.style.setProperty('--text-secondary', textSecondary);
    document.documentElement.style.setProperty('--text-muted', textMuted);
    document.documentElement.style.setProperty('--accent-color', themeRecipe.settings.accentColor || '#0066cc');
    document.documentElement.style.setProperty('--accent-color-hover', adjustColorBrightness(themeRecipe.settings.accentColor || '#0066cc', 10));
    document.documentElement.style.setProperty('--accent-color-active', adjustColorBrightness(themeRecipe.settings.accentColor || '#0066cc', -10));
  } else {
    // Dark theme variables - use existing color scheme
    document.documentElement.style.setProperty('--panel-bg', adjustedHelpBackground + "F0");
    document.documentElement.style.setProperty('--toolbar-bg', adjustedConsoleBackground);
    document.documentElement.style.setProperty('--panel-border', 'rgba(255, 255, 255, 0.2)');
    document.documentElement.style.setProperty('--panel-section-bg', adjustedHelpBackground + "E0");
    document.documentElement.style.setProperty('--panel-item-hover-bg', 'rgba(255, 255, 255, 0.1)');
    document.documentElement.style.setProperty('--panel-item-active-bg', 'rgba(255, 255, 255, 0.15)');
    document.documentElement.style.setProperty('--panel-control-bg', 'rgba(0, 0, 0, 0.2)');
    document.documentElement.style.setProperty('--text-primary', foregroundColor);
    document.documentElement.style.setProperty('--text-secondary', 'rgba(255, 255, 255, 0.7)');
    document.documentElement.style.setProperty('--text-muted', 'rgba(255, 255, 255, 0.5)');
    document.documentElement.style.setProperty('--accent-color', themeRecipe.settings.accentColor || foregroundColor);
    document.documentElement.style.setProperty('--accent-color-hover', adjustColorBrightness(themeRecipe.settings.accentColor || foregroundColor, 10));
    document.documentElement.style.setProperty('--accent-color-active', adjustColorBrightness(themeRecipe.settings.accentColor || foregroundColor, -10));
  }
}

// Helper function to adjust color brightness
function adjustColorBrightness(hex, percent) {
  // Remove the '#' if present
  hex = hex.replace(/^#/, '');

  // Convert to RGB
  let r = parseInt(hex.substring(0, 2), 16);
  let g = parseInt(hex.substring(2, 4), 16);
  let b = parseInt(hex.substring(4, 6), 16);

  // Adjust brightness
  r = Math.max(0, Math.min(255, r + (r * percent / 100)));
  g = Math.max(0, Math.min(255, g + (g * percent / 100)));
  b = Math.max(0, Math.min(255, b + (b * percent / 100)));

  // Convert back to hex
  return '#' + [r, g, b].map(x => {
    const hex = Math.round(x).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
}
