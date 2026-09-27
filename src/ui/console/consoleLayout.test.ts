import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  CONSOLE_ANCHOR_MARGIN,
  CONSOLE_MIN_H,
  CONSOLE_MIN_W,
  clampConsoleLayout,
  clampPosition,
  defaultConsoleLayout,
  loadConsoleLayout,
  saveConsoleLayout,
} from "./consoleLayout.ts";
import { PERSISTENCE_KEYS } from "../../lib/persistence.ts";

const VW = 1024;
const VH = 768;

describe("consoleLayout", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", window.location.pathname);
  });

  afterEach(() => {
    window.history.replaceState(null, "", window.location.pathname);
  });

  it("defaults anchor the panel bottom-right with all filters on", () => {
    const layout = defaultConsoleLayout();
    expect(layout.x).toBeNull();
    expect(layout.y).toBeNull();
    expect(layout.collapsed).toBe(false);
    expect(layout.filters).toEqual({ log: true, warn: true, error: true, wasm: true });
  });

  it("returns defaults when nothing is stored", () => {
    const layout = loadConsoleLayout();
    expect(layout.x).toBeNull();
    expect(layout.y).toBeNull();
    expect(layout.collapsed).toBe(false);
    expect(layout.filters.log).toBe(true);
  });

  it("returns defaults on corrupt stored JSON", () => {
    window.localStorage.setItem(PERSISTENCE_KEYS.consoleLayout, "{not json");
    const layout = loadConsoleLayout();
    expect(layout.x).toBeNull();
    expect(layout.filters).toEqual({ log: true, warn: true, error: true, wasm: true });
  });

  it("fills missing fields from defaults (implicit schema versioning)", () => {
    window.localStorage.setItem(
      PERSISTENCE_KEYS.consoleLayout,
      JSON.stringify({ w: 400, h: 200 }),
    );
    const layout = loadConsoleLayout();
    expect(layout.w).toBe(400);
    expect(layout.h).toBe(200);
    expect(layout.x).toBeNull();
    expect(layout.collapsed).toBe(false);
    expect(layout.filters.error).toBe(true);
  });

  it("drops non-numeric geometry instead of trusting it", () => {
    window.localStorage.setItem(
      PERSISTENCE_KEYS.consoleLayout,
      JSON.stringify({ w: "huge", h: null, x: "left", collapsed: "yes" }),
    );
    const layout = loadConsoleLayout();
    expect(typeof layout.w).toBe("number");
    expect(typeof layout.h).toBe("number");
    expect(layout.x).toBeNull();
    expect(layout.collapsed).toBe(false);
  });

  it("clamps anchored geometry to the viewport and MIN_W/MIN_H", () => {
    const layout = clampConsoleLayout(
      { ...defaultConsoleLayout(), w: 99999, h: -50 },
      VW,
      VH,
    );
    expect(layout.w).toBe(Math.max(CONSOLE_MIN_W, VW - CONSOLE_ANCHOR_MARGIN));
    expect(layout.h).toBe(CONSOLE_MIN_H);
    expect(layout.x).toBeNull();
    expect(layout.y).toBeNull();
  });

  it("clamps positioned geometry so the panel stays fully on screen", () => {
    const layout = clampConsoleLayout(
      { ...defaultConsoleLayout(), x: -20, y: 99999 },
      VW,
      VH,
    );
    expect(layout.x).toBe(0);
    expect(layout.y).toBe(VH - layout.h);
  });

  it("treats a one-axis position as positioned and clamps both axes", () => {
    const layout = clampConsoleLayout(
      { ...defaultConsoleLayout(), x: 50 },
      VW,
      VH,
    );
    expect(layout.x).toBe(50);
    expect(layout.y).toBe(0);
  });

  it("clampPosition keeps the drag rectangle inside the viewport", () => {
    expect(clampPosition(-10, -10, 300, 200, VW, VH)).toEqual({ x: 0, y: 0 });
    expect(clampPosition(2000, 2000, 300, 200, VW, VH)).toEqual({
      x: VW - 300,
      y: VH - 200,
    });
    expect(clampPosition(10, 20, 300, 200, VW, VH)).toEqual({ x: 10, y: 20 });
  });

  it("save then load round-trips through the persistence service", () => {
    const layout = {
      ...defaultConsoleLayout(),
      w: 400,
      h: 300,
      x: 12,
      y: 34,
      collapsed: true,
      filters: { log: false, warn: true, error: false, wasm: true },
    };
    saveConsoleLayout(layout);
    expect(JSON.parse(window.localStorage.getItem(PERSISTENCE_KEYS.consoleLayout)!)).toEqual(layout);
  });

  it("saveConsoleLayout honours ?nosave (session-scoped write gate)", () => {
    window.history.replaceState(null, "", "?nosave");
    saveConsoleLayout({ ...defaultConsoleLayout(), w: 400 });
    expect(window.localStorage.getItem(PERSISTENCE_KEYS.consoleLayout)).toBeNull();
  });

  it("loadConsoleLayout clamps using the real viewport", () => {
    window.localStorage.setItem(
      PERSISTENCE_KEYS.consoleLayout,
      JSON.stringify({ w: window.innerWidth * 10, h: 5 }),
    );
    const layout = loadConsoleLayout();
    expect(layout.w).toBeLessThanOrEqual(window.innerWidth);
    expect(layout.h).toBe(CONSOLE_MIN_H);
  });
});
