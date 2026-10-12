/**
 * Console panel layout persistence (console.md §1.10).
 *
 * Persists size, position, collapsed state, and filter toggles under a single
 * `consoleLayout` key through the persistence service (so `?nosave` is
 * honoured). Restored geometry is clamped to the current viewport and to
 * MIN_W/MIN_H. This module is DOM-light and unit-testable; only the load/save
 * entry points touch `window`.
 */

import { load, save, PERSISTENCE_KEYS } from "../../lib/persistence.ts";
import type { ConsoleMessageType } from "../../utils/consoleStore.ts";
import {
  allFiltersOn,
  type ConsoleFilters,
} from "./consoleFilter.ts";

export const CONSOLE_MIN_W = 280;
export const CONSOLE_MIN_H = 120;

/** Fixed inset (px) of the bottom-right anchor position. */
export const CONSOLE_ANCHOR_MARGIN = 16;

export interface ConsolePosition {
  x: number;
  y: number;
}

/**
 * Persisted console panel layout. `x`/`y` are viewport coordinates for the
 * panel's top-left corner; `null` keeps the default bottom-right anchor.
 */
export interface ConsoleLayout {
  w: number;
  h: number;
  x: number | null;
  y: number | null;
  collapsed: boolean;
  filters: ConsoleFilters;
}

const clampNum = (v: number, lo: number, hi: number) =>
  Math.min(Math.max(v, lo), hi);

export function defaultConsoleLayout(): ConsoleLayout {
  return {
    w: Math.min(520, window.innerWidth * 0.4),
    h: Math.min(340, window.innerHeight * 0.35),
    x: null,
    y: null,
    collapsed: false,
    filters: allFiltersOn(),
  };
}

/**
 * Keep a dragged position inside the viewport for a panel of the given size.
 */
export function clampPosition(
  x: number,
  y: number,
  w: number,
  h: number,
  viewportW: number,
  viewportH: number,
): ConsolePosition {
  return {
    x: clampNum(x, 0, Math.max(0, viewportW - w)),
    y: clampNum(y, 0, Math.max(0, viewportH - h)),
  };
}

/** Clamp restored geometry to the current viewport and MIN_W/MIN_H. */
export function clampConsoleLayout(
  layout: ConsoleLayout,
  viewportW: number,
  viewportH: number,
): ConsoleLayout {
  const positioned = layout.x !== null || layout.y !== null;
  let w: number;
  let h: number;
  if (positioned) {
    w = clampNum(layout.w, CONSOLE_MIN_W, Math.max(CONSOLE_MIN_W, viewportW));
    h = clampNum(layout.h, CONSOLE_MIN_H, Math.max(CONSOLE_MIN_H, viewportH));
  } else {
    // Anchored bottom-right: keep the panel fully on screen with its margin.
    w = clampNum(
      layout.w,
      CONSOLE_MIN_W,
      Math.max(CONSOLE_MIN_W, viewportW - CONSOLE_ANCHOR_MARGIN),
    );
    h = clampNum(
      layout.h,
      CONSOLE_MIN_H,
      Math.max(CONSOLE_MIN_H, viewportH - CONSOLE_ANCHOR_MARGIN),
    );
  }
  const pos = positioned
    ? clampPosition(layout.x ?? 0, layout.y ?? 0, w, h, viewportW, viewportH)
    : null;
  return { ...layout, w, h, x: pos?.x ?? null, y: pos?.y ?? null };
}

function normaliseFilters(raw: unknown): ConsoleFilters {
  const filters = allFiltersOn();
  if (raw && typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    for (const t of Object.keys(filters) as ConsoleMessageType[]) {
      if (typeof record[t] === "boolean") filters[t] = record[t] as boolean;
    }
  }
  return filters;
}

/**
 * Read the persisted layout, filling missing/corrupt fields from defaults
 * (persistence.md §1.6 implicit schema versioning) and clamping to the
 * current viewport.
 */
export function loadConsoleLayout(): ConsoleLayout {
  const base = defaultConsoleLayout();
  const stored = load<Partial<ConsoleLayout> | null>(
    PERSISTENCE_KEYS.consoleLayout,
    null,
  );
  if (!stored || typeof stored !== "object") return base;

  const num = (v: unknown, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? v : fallback;
  const merged: ConsoleLayout = {
    w: num(stored.w, base.w),
    h: num(stored.h, base.h),
    x: typeof stored.x === "number" && Number.isFinite(stored.x) ? stored.x : null,
    y: typeof stored.y === "number" && Number.isFinite(stored.y) ? stored.y : null,
    collapsed: stored.collapsed === true,
    filters: normaliseFilters(stored.filters),
  };
  return clampConsoleLayout(merged, window.innerWidth, window.innerHeight);
}

/** Write the layout through the persistence service (no-op under ?nosave). */
export function saveConsoleLayout(layout: ConsoleLayout): void {
  save(PERSISTENCE_KEYS.consoleLayout, layout);
}
