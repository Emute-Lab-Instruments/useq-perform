import { render, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PERSISTENCE_KEYS } from "../../lib/persistence";
import { PanelChrome } from "./PanelChrome";
import { loadPaneGeometry, savePaneGeometry, saveTileSlot } from "./geometry";

function pointer(type: string, x: number, y: number): PointerEvent {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  return e as unknown as PointerEvent;
}

function chromeEl(panelId: string): HTMLElement {
  return document.querySelector(`[data-panel-id="${panelId}"]`) as HTMLElement;
}

describe("PanelChrome", () => {
  beforeEach(() => {
    window.innerWidth = 1200;
    window.innerHeight = 800;
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    document.body.innerHTML = "";
  });

  it("docks the default pane to the requested side", () => {
    render(() => (
      <>
        <PanelChrome panelId="a" title="A" side="left" onClose={() => {}}>x</PanelChrome>
        <PanelChrome panelId="b" title="B" side="right" onClose={() => {}}>y</PanelChrome>
      </>
    ));
    const a = chromeEl("a");
    const b = chromeEl("b");
    expect(parseFloat(a.style.left)).toBe(16);
    expect(parseFloat(b.style.left) + parseFloat(b.style.width)).toBe(1200 - 16);
    // Default columns leave room for each other (no overlap).
    expect(parseFloat(a.style.left) + parseFloat(a.style.width)).toBeLessThan(parseFloat(b.style.left));
  });

  it("restores a stored pane geometry clamped to the viewport", () => {
    savePaneGeometry("settings", { x: 3000, y: 900, w: 500, h: 400 });
    render(() => <PanelChrome panelId="settings" title="Settings" onClose={() => {}}>x</PanelChrome>);
    const el = chromeEl("settings");
    expect(el.style.left).toBe("700px");
    expect(el.style.top).toBe("400px");
    expect(el.style.width).toBe("500px");
  });

  it("persists pane geometry after a title-bar drag, constrained to the viewport", () => {
    render(() => <PanelChrome panelId="settings" title="Settings" onClose={() => {}}>x</PanelChrome>);
    const titleBar = chromeEl("settings").querySelector(".panel-chrome-title-bar") as HTMLElement;
    titleBar.dispatchEvent(pointer("pointerdown", 100, 100));
    document.dispatchEvent(pointer("pointermove", -5000, -5000));
    document.dispatchEvent(pointer("pointerup", -5000, -5000));

    const saved = loadPaneGeometry("settings");
    expect(saved).not.toBeNull();
    expect(saved!.x).toBe(0);
    expect(saved!.y).toBe(0);
  });

  it("does not drag when the pointer-down starts on a title-bar button", () => {
    render(() => <PanelChrome panelId="settings" title="Settings" onClose={() => {}}>x</PanelChrome>);
    const close = screen.getByRole("button", { name: "Close" });
    close.dispatchEvent(pointer("pointerdown", 100, 100));
    document.dispatchEvent(pointer("pointermove", 0, 0));
    document.dispatchEvent(pointer("pointerup", 0, 0));
    expect(localStorage.getItem(PERSISTENCE_KEYS.panelGeometry)).toBeNull();
  });

  it("exposes the stacking order as a CSS variable", () => {
    render(() => (
      <PanelChrome panelId="settings" title="Settings" stackIndex={2} onClose={() => {}}>x</PanelChrome>
    ));
    expect(chromeEl("settings").style.getPropertyValue("--panel-stack")).toBe("2");
  });

  it("anchors a left-side drawer to the left edge", () => {
    render(() => (
      <PanelChrome design="drawer" panelId="help" title="Help" side="left" onClose={() => {}}>x</PanelChrome>
    ));
    expect(chromeEl("help").classList.contains("panel-chrome--drawer-left")).toBe(true);
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
  });

  it("restores the stored tile slot, else uses the side's default slot", () => {
    saveTileSlot("settings", "bottom-half");
    render(() => (
      <>
        <PanelChrome design="tile" panelId="settings" title="Settings" onClose={() => {}}>x</PanelChrome>
        <PanelChrome design="tile" panelId="help" title="Help" side="left" onClose={() => {}}>y</PanelChrome>
      </>
    ));
    expect(chromeEl("settings").style.top).toBe("52vh");
    expect(chromeEl("help").style.left).toBe("2vw");
    expect(chromeEl("help").style.width).toBe("31vw");
  });
});
