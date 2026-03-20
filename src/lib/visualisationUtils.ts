import { dbg } from "./debug.ts";
import {
  serialVisPaletteChangedChannel,
} from "../contracts/visualisationChannels";

export const serialVisChannels = ['a1', 'a2', 'a3', 'a4', 'd1', 'd2', 'd3'];

const clampOffset = (rawOffset: number, length: number): number => {
  if (!length) {
    return 0;
  }
  const numeric = Number(rawOffset) || 0;
  const mod = numeric % length;
  return mod < 0 ? mod + length : mod;
};

const normalisePalette = (paletteCandidate: string[] | null): string[] => {
  if (Array.isArray(paletteCandidate) && paletteCandidate.length > 0) {
    return paletteCandidate;
  }
  return getSerialVisPalette();
};

export const getSerialVisChannelColor = (exprType: string | null, circularOffset = 0, paletteOverride: string[] | null = null): string | null => {
  if (!exprType) {
    return null;
  }
  const index = serialVisChannels.indexOf(exprType);
  if (index < 0) {
    return null;
  }
  const palette = normalisePalette(paletteOverride || serialVisPalette);
  if (!Array.isArray(palette) || palette.length === 0) {
    return null;
  }
  const rotationLength = serialVisChannels.length || palette.length;
  const offset = clampOffset(circularOffset, rotationLength);
  const paletteIndex = (index + offset) % palette.length;
  return palette[paletteIndex] || null;
};

export const buildSerialVisColorMap = (circularOffset = 0, paletteOverride: string[] | null = null): Map<string, string> => {
  const palette = normalisePalette(paletteOverride || serialVisPalette);
  return serialVisChannels.reduce((acc, channel) => {
    const color = getSerialVisChannelColor(channel, circularOffset, palette);
    if (color) {
      acc.set(channel, color);
    }
    return acc;
  }, new Map());
};

// Export palette arrays so they can be accessed from the theme manager
export const serialVisPaletteLight = ['#ace397', '#45a5ad', '#fcbf5d', '#ff809f', '#ff005e', '#c9004c', '#93003a', '#00429d'];
// Brighter colors that work better on dark backgrounds
export const serialVisPaletteDark = [
  '#00ff41', 
  '#1adbdb', 
  '#ffaa00',
  '#ff0080',
  '#ff5500',
  '#ffee33',
  '#0088ff',
  '#aa00ff',
];
// Use let instead of const so it can be changed
export let serialVisPalette = serialVisPaletteLight;

// Create a setter function to update the palette
export function setSerialVisPalette(palette: string[]): boolean {
  if (Array.isArray(palette) && palette.length > 0) {
    serialVisPalette = palette;
    // Force redraw of the plot with new colors
    // plotNeedsRedrawing = true;
    dbg("Serial visualization palette updated");
    try {
      serialVisPaletteChangedChannel.publish({ palette });
    } catch (error) {
      dbg(`Serial visualization palette event failed: ${error}`);
    }
    return true;
  }
  return false;
}

// Getter to access the current palette (safe against circular-import TDZ)
export function getSerialVisPalette(): string[] {
  try {
    return serialVisPalette;
  } catch {
    // Fallback when serialVisPalette is in the temporal dead zone due to
    // circular imports during module initialisation.
    return ['#ace397', '#45a5ad', '#fcbf5d', '#ff809f', '#ff005e', '#c9004c', '#93003a', '#00429d'];
  }
}

