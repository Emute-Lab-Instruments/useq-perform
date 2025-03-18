import { EditorView } from '@codemirror/view';
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { tags } from "@lezer/highlight";

// ColorSystem class to handle color manipulations and relationships
class ColorSystem {
  /**
   * Convert hex to HSL
   * @param {string} hex - Hex color code
   * @returns {object} HSL values {h, s, l}
   */
  static hexToHSL(hex) {
    // Remove the # if present
    hex = hex.replace(/^#/, '');
    
    // Parse the RGB components
    const r = parseInt(hex.substr(0, 2), 16) / 255;
    const g = parseInt(hex.substr(2, 2), 16) / 255;
    const b = parseInt(hex.substr(4, 2), 16) / 255;
    
    // Find min and max RGB components
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    
    if (max === min) {
      // Achromatic case (gray)
      h = 0;
      s = 0;
    } else {
      // Calculate hue and saturation
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      
      h = h / 6;
    }
    
    return { h: h * 360, s: s * 100, l: l * 100 };
  }
  
  /**
   * Convert HSL to hex
   * @param {number} h - Hue (0-360)
   * @param {number} s - Saturation (0-100)
   * @param {number} l - Lightness (0-100)
   * @returns {string} Hex color
   */
  static hslToHex(h, s, l) {
    h /= 360;
    s /= 100;
    l /= 100;
    
    let r, g, b;
    
    if (s === 0) {
      // Achromatic case (gray)
      r = g = b = l;
    } else {
      const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
      };
      
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      
      r = hue2rgb(p, q, h + 1/3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1/3);
    }
    
    // Convert to hex
    const toHex = (c) => {
      const hex = Math.round(c * 255).toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    };
    
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }
  
  /**
   * Generate tints and shades from a base color
   * @param {string} baseColor - Base color in hex
   * @param {number} steps - Number of steps to generate
   * @returns {object} Object with tints and shades
   */
  static generateVariations(baseColor, steps = 5) {
    const hsl = this.hexToHSL(baseColor);
    const variations = {
      base: baseColor,
      tints: [],
      shades: []
    };
    
    // Generate tints (lighter)
    for (let i = 1; i <= steps; i++) {
      const newL = Math.min(100, hsl.l + (i * (100 - hsl.l) / (steps + 1)));
      variations.tints.push(this.hslToHex(hsl.h, hsl.s, newL));
    }
    
    // Generate shades (darker)
    for (let i = 1; i <= steps; i++) {
      const newL = Math.max(0, hsl.l - (i * hsl.l / (steps + 1)));
      variations.shades.push(this.hslToHex(hsl.h, hsl.s, newL));
    }
    
    return variations;
  }
  
  /**
   * Generate a palette of neutrals based on a base color
   * @param {string} baseColor - Base color to derive neutrals from
   * @param {number} steps - Number of steps to generate
   * @returns {Array} Array of neutral colors from light to dark
   */
  static generateNeutrals(baseColor, steps = 8) {
    const hsl = this.hexToHSL(baseColor);
    const neutrals = [];
    
    // Keep the hue but reduce saturation and vary lightness
    const saturation = Math.max(0, hsl.s * 0.2);
    
    for (let i = 0; i < steps; i++) {
      const lightness = 95 - (i * (85 / (steps - 1)));
      neutrals.push(this.hslToHex(hsl.h, saturation, lightness));
    }
    
    return neutrals;
  }
}

// Theme settings interface following the structure:
// {
//   name: string
//   variant: 'light' | 'dark'
//   colors: {
//     primary: { base: string, tints: string[], shades: string[] }
//     secondary: { base: string, tints: string[], shades: string[] }
//     accent: { base: string, tints: string[], shades: string[] }
//     neutral: string[]
//     semantic: { success: string, warning: string, error: string, info: string }
//   }
//   settings: {
//     background: string
//     foreground: string
//     caret: string
//     selection: string
//     lineHighlight: string
//     gutterBackground: string
//     gutterForeground: string
//   }
//   styles: Array<{tag: tags, color: string}>
//   cssVars: Record<string, string>
// }

// Define our base colors
const darkColors = {
  primary: '#528bff',      // Vibrant blue for primary actions/identity
  secondary: '#98c379',    // Green for complementary elements
  accent: '#c678dd',       // Purple for highlights/accents
  neutralBase: '#1e1e1e',  // Dark background base
  semantic: {
    success: '#98c379',    // Green
    warning: '#e5c07b',    // Yellow/Amber
    error: '#e06c75',      // Red
    info: '#61afef'        // Blue
  }
};

const lightColors = {
  primary: '#526fff',      // Vibrant blue for primary actions/identity
  secondary: '#50a14f',    // Green for complementary elements
  accent: '#a626a4',       // Purple for highlights/accents
  neutralBase: '#ffffff',  // Light background base
  semantic: {
    success: '#50a14f',    // Green
    warning: '#c18401',    // Yellow/Amber
    error: '#e45649',      // Red
    info: '#4078f2'        // Blue
  }
};

// Build full color systems
const darkColorSystem = {
  primary: ColorSystem.generateVariations(darkColors.primary, 5),
  secondary: ColorSystem.generateVariations(darkColors.secondary, 5),
  accent: ColorSystem.generateVariations(darkColors.accent, 5),
  neutral: ColorSystem.generateNeutrals(darkColors.neutralBase, 10),
  semantic: {
    success: darkColors.semantic.success,
    warning: darkColors.semantic.warning,
    error: darkColors.semantic.error,
    info: darkColors.semantic.info
  }
};

const lightColorSystem = {
  primary: ColorSystem.generateVariations(lightColors.primary, 5),
  secondary: ColorSystem.generateVariations(lightColors.secondary, 5),
  accent: ColorSystem.generateVariations(lightColors.accent, 5),
  neutral: ColorSystem.generateNeutrals(lightColors.neutralBase, 10),
  semantic: {
    success: lightColors.semantic.success,
    warning: lightColors.semantic.warning,
    error: lightColors.semantic.error,
    info: lightColors.semantic.info
  }
};

const baseThemes = {
  dark: {
    name: 'Dark',
    variant: 'dark',
    colors: darkColorSystem,
    settings: {
      background: darkColorSystem.neutral[8],
      foreground: darkColorSystem.neutral[1],
      caret: darkColorSystem.primary.base,
      selection: darkColorSystem.primary.shades[3],
      lineHighlight: darkColorSystem.neutral[7],
      gutterBackground: darkColorSystem.neutral[8],
      gutterForeground: darkColorSystem.neutral[3]
    },
    styles: [
      { tag: tags.comment, color: darkColorSystem.neutral[3] },
      { tag: tags.string, color: darkColorSystem.secondary.base },
      { tag: tags.keyword, color: darkColorSystem.accent.base },
      { tag: tags.function, color: darkColorSystem.primary.base },
      { tag: tags.number, color: darkColorSystem.secondary.shades[2] },
      { tag: tags.operator, color: darkColorSystem.primary.shades[1] },
      { tag: tags.bracket, color: darkColorSystem.neutral[2] },
      { tag: tags.variableName, color: darkColorSystem.semantic.error },
      { tag: tags.typeName, color: darkColorSystem.semantic.warning },
      { tag: tags.propertyName, color: darkColorSystem.primary.base },
    ],
    cssVars: {
      // Core UI colors
      '--editor-bg': darkColorSystem.neutral[8],
      '--editor-fg': darkColorSystem.neutral[1],
      '--panel-bg': darkColorSystem.neutral[7],
      '--panel-border': darkColorSystem.neutral[5],
      '--console-bg': darkColorSystem.primary.shades[4], // Using primary-color-most for console
      
      // Button styling
      '--button-bg': darkColorSystem.neutral[6],
      '--button-hover': darkColorSystem.neutral[5],
      '--button-border': darkColorSystem.neutral[4],
      
      // Text colors
      '--text-primary': darkColorSystem.neutral[1],
      '--text-secondary': darkColorSystem.neutral[3],
      '--accent-color': darkColorSystem.primary.base,
      
      // Semantic colors
      '--color-success': darkColorSystem.semantic.success,
      '--color-warning': darkColorSystem.semantic.warning,
      '--color-error': darkColorSystem.semantic.error,
      '--color-info': darkColorSystem.semantic.info,
      
      // Primary color variations with new terminology
      '--primary-color-base': darkColorSystem.primary.base,
      '--primary-color-more': darkColorSystem.primary.shades[0], // Darker
      '--primary-color-most': darkColorSystem.primary.shades[4], // Darkest
      '--primary-color-less': darkColorSystem.primary.tints[0], // Lighter
      '--primary-color-least': darkColorSystem.primary.tints[4], // Lightest
      
      // Secondary color variations
      '--secondary-color-base': darkColorSystem.secondary.base,
      '--secondary-color-more': darkColorSystem.secondary.shades[0], // Darker
      '--secondary-color-most': darkColorSystem.secondary.shades[4], // Darkest
      '--secondary-color-less': darkColorSystem.secondary.tints[0], // Lighter
      '--secondary-color-least': darkColorSystem.secondary.tints[4], // Lightest
      
      // Accent color variations
      '--accent-color-base': darkColorSystem.accent.base,
      '--accent-color-more': darkColorSystem.accent.shades[0], // Darker
      '--accent-color-most': darkColorSystem.accent.shades[4], // Darkest
      '--accent-color-less': darkColorSystem.accent.tints[0], // Lighter
      '--accent-color-least': darkColorSystem.accent.tints[4], // Lightest
      
      // Code font
      '--code-font': 'monospace'
    }
  },
  light: {
    name: 'Light',
    variant: 'light',
    colors: lightColorSystem,
    settings: {
      background: lightColorSystem.neutral[0],
      foreground: lightColorSystem.neutral[8],
      caret: lightColorSystem.primary.base,
      selection: lightColorSystem.primary.tints[3],
      lineHighlight: lightColorSystem.neutral[1],
      gutterBackground: lightColorSystem.neutral[0],
      gutterForeground: lightColorSystem.neutral[5]
    },
    styles: [
      { tag: tags.comment, color: lightColorSystem.neutral[5] },
      { tag: tags.string, color: lightColorSystem.secondary.base },
      { tag: tags.keyword, color: lightColorSystem.accent.base },
      { tag: tags.function, color: lightColorSystem.primary.base },
      { tag: tags.number, color: lightColorSystem.secondary.shades[2] },
      { tag: tags.operator, color: lightColorSystem.primary.shades[1] },
      { tag: tags.bracket, color: lightColorSystem.neutral[6] },
      { tag: tags.variableName, color: lightColorSystem.semantic.error },
      { tag: tags.typeName, color: lightColorSystem.semantic.warning },
      { tag: tags.propertyName, color: lightColorSystem.primary.base },
    ],
    cssVars: {
      // Core UI colors
      '--editor-bg': lightColorSystem.neutral[0],
      '--editor-fg': lightColorSystem.neutral[8],
      '--panel-bg': lightColorSystem.neutral[1],
      '--panel-border': lightColorSystem.neutral[3],
      '--console-bg': lightColorSystem.primary.tints[4], // Using primary-color-most for console
      
      // Button styling
      '--button-bg': lightColorSystem.neutral[0],
      '--button-hover': lightColorSystem.neutral[1],
      '--button-border': lightColorSystem.neutral[2],
      
      // Text colors
      '--text-primary': lightColorSystem.neutral[8],
      '--text-secondary': lightColorSystem.neutral[6],
      '--accent-color': lightColorSystem.primary.base,
      
      // Semantic colors
      '--color-success': lightColorSystem.semantic.success,
      '--color-warning': lightColorSystem.semantic.warning,
      '--color-error': lightColorSystem.semantic.error,
      '--color-info': lightColorSystem.semantic.info,
      
      // Primary color variations with new terminology
      '--primary-color-base': lightColorSystem.primary.base,
      '--primary-color-more': lightColorSystem.primary.tints[0], // Lighter
      '--primary-color-most': lightColorSystem.primary.tints[4], // Lightest
      '--primary-color-less': lightColorSystem.primary.shades[0], // Darker
      '--primary-color-least': lightColorSystem.primary.shades[4], // Darkest
      
      // Secondary color variations
      '--secondary-color-base': lightColorSystem.secondary.base,
      '--secondary-color-more': lightColorSystem.secondary.tints[0], // Lighter
      '--secondary-color-most': lightColorSystem.secondary.tints[4], // Lightest
      '--secondary-color-less': lightColorSystem.secondary.shades[0], // Darker
      '--secondary-color-least': lightColorSystem.secondary.shades[4], // Darkest
      
      // Accent color variations
      '--accent-color-base': lightColorSystem.accent.base,
      '--accent-color-more': lightColorSystem.accent.tints[0], // Lighter
      '--accent-color-most': lightColorSystem.accent.tints[4], // Lightest
      '--accent-color-less': lightColorSystem.accent.shades[0], // Darker
      '--accent-color-least': lightColorSystem.accent.shades[4], // Darkest
      
      // Code font
      '--code-font': 'monospace'
    }
  }
};

function createTheme({ variant, settings, styles }) {
  // Create CodeMirror theme
  const theme = EditorView.theme(
    {
      '&': {
        backgroundColor: settings.background,
        color: settings.foreground
      },
      '.cm-content': {
        caretColor: settings.caret
      },
      '.cm-cursor, .cm-dropCursor': {
        borderLeftColor: settings.caret
      },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
        backgroundColor: settings.selection
      },
      '.cm-activeLine': {
        backgroundColor: settings.lineHighlight
      },
      '.cm-gutters': {
        backgroundColor: settings.gutterBackground,
        color: settings.gutterForeground
      },
      '.cm-activeLineGutter': {
        backgroundColor: settings.lineHighlight
      }
    },
    {
      dark: variant === 'dark'
    }
  );

  // Create syntax highlighting style
  const highlightStyle = HighlightStyle.define(styles);
  
  return [theme, syntaxHighlighting(highlightStyle)];
}

function applyTheme(themeName, editor) {
  const theme = baseThemes[themeName];
  if (!theme) return;

  // Apply CodeMirror theme
  const extension = createTheme(theme);
  editor.dispatch({
    effects: window.themeCompartment.reconfigure(extension)
  });

  // Apply CSS variables
  const root = document.documentElement;
  Object.entries(theme.cssVars).forEach(([key, value]) => {
    root.style.setProperty(key, value);
  });

  // Update all patch editors if they exist
  document.querySelectorAll('.patch-code').forEach(element => {
    const patchEditor = EditorView.findFromDOM(element);
    if (patchEditor) {
      patchEditor.dispatch({
        effects: window.themeCompartment.reconfigure(extension)
      });
    }
  });
}

// Generate a custom theme with specific base colors
function generateCustomTheme(name, variant, primaryColor, secondaryColor, accentColor) {
  const neutralBase = variant === 'dark' ? '#1e1e1e' : '#ffffff';
  
  const customColors = {
    primary: primaryColor,
    secondary: secondaryColor,
    accent: accentColor,
    neutralBase: neutralBase,
    semantic: variant === 'dark' ? darkColors.semantic : lightColors.semantic
  };
  
  const colorSystem = {
    primary: ColorSystem.generateVariations(customColors.primary, 5),
    secondary: ColorSystem.generateVariations(customColors.secondary, 5),
    accent: ColorSystem.generateVariations(customColors.accent, 5),
    neutral: ColorSystem.generateNeutrals(customColors.neutralBase, 10),
    semantic: customColors.semantic
  };
  
  // Clone and adapt the appropriate base theme
  const baseTheme = JSON.parse(JSON.stringify(baseThemes[variant]));
  baseTheme.name = name;
  baseTheme.colors = colorSystem;
  
  // Update theme settings and styles with new colors
  if (variant === 'dark') {
    baseTheme.settings.caret = colorSystem.primary.base;
    baseTheme.settings.selection = colorSystem.primary.shades[3];
    
    baseTheme.styles.find(s => s.tag === tags.string).color = colorSystem.secondary.base;
    baseTheme.styles.find(s => s.tag === tags.keyword).color = colorSystem.accent.base;
    baseTheme.styles.find(s => s.tag === tags.function).color = colorSystem.primary.base;
    
    // Update CSS variables with new terminology
    baseTheme.cssVars['--accent-color'] = colorSystem.primary.base;
    baseTheme.cssVars['--console-bg'] = colorSystem.primary.shades[4];
    baseTheme.cssVars['--primary-color-base'] = colorSystem.primary.base;
    baseTheme.cssVars['--primary-color-more'] = colorSystem.primary.shades[0];
    baseTheme.cssVars['--primary-color-most'] = colorSystem.primary.shades[4];
    baseTheme.cssVars['--primary-color-less'] = colorSystem.primary.tints[0];
    baseTheme.cssVars['--primary-color-least'] = colorSystem.primary.tints[4];
    baseTheme.cssVars['--secondary-color-base'] = colorSystem.secondary.base;
    baseTheme.cssVars['--secondary-color-more'] = colorSystem.secondary.shades[0];
    baseTheme.cssVars['--secondary-color-most'] = colorSystem.secondary.shades[4];
    baseTheme.cssVars['--secondary-color-less'] = colorSystem.secondary.tints[0];
    baseTheme.cssVars['--secondary-color-least'] = colorSystem.secondary.tints[4];
    baseTheme.cssVars['--accent-color-base'] = colorSystem.accent.base;
    baseTheme.cssVars['--accent-color-more'] = colorSystem.accent.shades[0];
    baseTheme.cssVars['--accent-color-most'] = colorSystem.accent.shades[4];
    baseTheme.cssVars['--accent-color-less'] = colorSystem.accent.tints[0];
    baseTheme.cssVars['--accent-color-least'] = colorSystem.accent.tints[4];
  } else {
    baseTheme.settings.caret = colorSystem.primary.base;
    baseTheme.settings.selection = colorSystem.primary.tints[3];
    
    baseTheme.styles.find(s => s.tag === tags.string).color = colorSystem.secondary.base;
    baseTheme.styles.find(s => s.tag === tags.keyword).color = colorSystem.accent.base;
    baseTheme.styles.find(s => s.tag === tags.function).color = colorSystem.primary.base;
    
    // Update CSS variables with new terminology
    baseTheme.cssVars['--accent-color'] = colorSystem.primary.base;
    baseTheme.cssVars['--console-bg'] = colorSystem.primary.tints[4];
    baseTheme.cssVars['--primary-color-base'] = colorSystem.primary.base;
    baseTheme.cssVars['--primary-color-more'] = colorSystem.primary.tints[0];
    baseTheme.cssVars['--primary-color-most'] = colorSystem.primary.tints[4];
    baseTheme.cssVars['--primary-color-less'] = colorSystem.primary.shades[0];
    baseTheme.cssVars['--primary-color-least'] = colorSystem.primary.shades[4];
    baseTheme.cssVars['--secondary-color-base'] = colorSystem.secondary.base;
    baseTheme.cssVars['--secondary-color-more'] = colorSystem.secondary.tints[0];
    baseTheme.cssVars['--secondary-color-most'] = colorSystem.secondary.tints[4];
    baseTheme.cssVars['--secondary-color-less'] = colorSystem.secondary.shades[0];
    baseTheme.cssVars['--secondary-color-least'] = colorSystem.secondary.shades[4];
    baseTheme.cssVars['--accent-color-base'] = colorSystem.accent.base;
    baseTheme.cssVars['--accent-color-more'] = colorSystem.accent.tints[0];
    baseTheme.cssVars['--accent-color-most'] = colorSystem.accent.tints[4];
    baseTheme.cssVars['--accent-color-less'] = colorSystem.accent.shades[0];
    baseTheme.cssVars['--accent-color-least'] = colorSystem.accent.shades[4];
  }
  
  return baseTheme;
}

export { baseThemes, createTheme, applyTheme, generateCustomTheme, ColorSystem };