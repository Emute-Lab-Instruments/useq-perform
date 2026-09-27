import { afterEach, describe, expect, it } from "vitest";
import { PERSISTENCE_KEYS } from "../../lib/persistence";
import {
  clampGeometry,
  loadDrawerWidthPct,
  loadPaneGeometry,
  loadTileSlot,
  saveDrawerWidthPct,
  savePaneGeometry,
  saveTileSlot,
} from "./geometry";

describe("panel chrome geometry", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("clamps a geometry fully inside the viewport", () => {
    expect(clampGeometry({ x: 1500, y: -40, w: 400, h: 300 }, { width: 1000, height: 800 }, 240, 180))
      .toEqual({ x: 600, y: 0, w: 400, h: 300 });
  });

  it("shrinks oversized geometry to the viewport, including below minimums", () => {
    expect(clampGeometry({ x: 50, y: 50, w: 2000, h: 2000 }, { width: 200, height: 150 }, 240, 180))
      .toEqual({ x: 0, y: 0, w: 200, h: 150 });
  });

  it("round-trips per-design, per-panel geometry through one key", () => {
    savePaneGeometry("settings", { x: 1, y: 2, w: 300, h: 400 });
    saveDrawerWidthPct("help", 42);
    saveTileSlot("help", "left-half");

    expect(loadPaneGeometry("settings")).toEqual({ x: 1, y: 2, w: 300, h: 400 });
    expect(loadPaneGeometry("help")).toBeNull();
    expect(loadDrawerWidthPct("help")).toBe(42);
    expect(loadTileSlot("help", ["left-half", "right-third"])).toBe("left-half");

    const stored = JSON.parse(localStorage.getItem(PERSISTENCE_KEYS.panelGeometry)!);
    expect(Object.keys(stored).sort()).toEqual(["drawer", "pane", "tile"]);
  });

  it("ignores corrupt or invalid stored values", () => {
    localStorage.setItem(PERSISTENCE_KEYS.panelGeometry, "{not json");
    expect(loadPaneGeometry("settings")).toBeNull();

    localStorage.setItem(
      PERSISTENCE_KEYS.panelGeometry,
      JSON.stringify({
        pane: { settings: { x: "a", y: 0, w: 10, h: 10 }, help: { x: 0, y: 0, w: -1, h: 10 } },
        drawer: { settings: { widthPct: null } },
        tile: { settings: { slot: "nowhere" } },
      }),
    );
    expect(loadPaneGeometry("settings")).toBeNull();
    expect(loadPaneGeometry("help")).toBeNull();
    expect(loadDrawerWidthPct("settings")).toBeNull();
    expect(loadTileSlot("settings", ["right-third"])).toBeNull();
  });
});
