/**
 * Panel chrome geometry: viewport clamping and per-design persistence.
 *
 * One persistence key (`PERSISTENCE_KEYS.panelGeometry`) holds the last
 * user-chosen geometry of each panel, per chrome design:
 *
 *   { pane:   { [panelId]: { x, y, w, h } },     // pixels
 *     drawer: { [panelId]: { widthPct } },       // % of viewport width
 *     tile:   { [panelId]: { slot } } }          // TileSlot name
 *
 * Restored values are validated and clamped to the current viewport, so a
 * geometry saved on a large monitor can never place a panel off-screen.
 */
import { PERSISTENCE_KEYS, load, save } from "../../lib/persistence";
import type { ChromeDesign, Geometry, TileSlot } from "./types";

/** Viewport width at or below which panels go full width (one panel at a time). */
export const NARROW_VIEWPORT_PX = 700;

export function isNarrowViewport(): boolean {
  return typeof window !== "undefined" && window.innerWidth <= NARROW_VIEWPORT_PX;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export function viewportSize(): ViewportSize {
  return { width: window.innerWidth, height: window.innerHeight };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/**
 * Clamp a pane geometry so the whole panel fits in the viewport.
 * Minimum sizes shrink to the viewport when the viewport is smaller.
 */
export function clampGeometry(
  geo: Geometry,
  viewport: ViewportSize,
  minW: number,
  minH: number,
): Geometry {
  const w = clamp(geo.w, Math.min(minW, viewport.width), viewport.width);
  const h = clamp(geo.h, Math.min(minH, viewport.height), viewport.height);
  const x = clamp(geo.x, 0, viewport.width - w);
  const y = clamp(geo.y, 0, viewport.height - h);
  return { x, y, w, h };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

interface StoredPanelGeometry {
  pane?: Record<string, unknown>;
  drawer?: Record<string, unknown>;
  tile?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function loadAll(): StoredPanelGeometry {
  const raw = load<unknown>(PERSISTENCE_KEYS.panelGeometry, null);
  return isRecord(raw) ? (raw as StoredPanelGeometry) : {};
}

function loadEntry(design: ChromeDesign, panelId: string): Record<string, unknown> | null {
  const byPanel = loadAll()[design];
  if (!isRecord(byPanel)) return null;
  const entry = byPanel[panelId];
  return isRecord(entry) ? entry : null;
}

function saveEntry(design: ChromeDesign, panelId: string, value: Record<string, unknown>): void {
  const all = loadAll();
  const byPanel = isRecord(all[design]) ? { ...all[design] } : {};
  byPanel[panelId] = value;
  save(PERSISTENCE_KEYS.panelGeometry, { ...all, [design]: byPanel });
}

/** Stored pane geometry (unclamped), or null when absent/invalid. */
export function loadPaneGeometry(panelId: string): Geometry | null {
  const entry = loadEntry("pane", panelId);
  if (!entry) return null;
  const { x, y, w, h } = entry;
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(w) || !isFiniteNumber(h)) {
    return null;
  }
  if (w <= 0 || h <= 0) return null;
  return { x, y, w, h };
}

export function savePaneGeometry(panelId: string, geo: Geometry): void {
  saveEntry("pane", panelId, { x: geo.x, y: geo.y, w: geo.w, h: geo.h });
}

/** Stored drawer width in viewport percent, or null when absent/invalid. */
export function loadDrawerWidthPct(panelId: string): number | null {
  const entry = loadEntry("drawer", panelId);
  const pct = entry?.widthPct;
  return isFiniteNumber(pct) && pct > 0 ? pct : null;
}

export function saveDrawerWidthPct(panelId: string, widthPct: number): void {
  saveEntry("drawer", panelId, { widthPct });
}

/** Stored tile slot, or null when absent/unknown. */
export function loadTileSlot(panelId: string, known: readonly TileSlot[]): TileSlot | null {
  const slot = loadEntry("tile", panelId)?.slot;
  return typeof slot === "string" && (known as readonly string[]).includes(slot)
    ? (slot as TileSlot)
    : null;
}

export function saveTileSlot(panelId: string, slot: TileSlot): void {
  saveEntry("tile", panelId, { slot });
}
