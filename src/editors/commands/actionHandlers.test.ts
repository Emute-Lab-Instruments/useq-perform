import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../../effects/editorEvaluation.ts", () => ({ evaluate: vi.fn(() => true) }));
vi.mock("../editorKeyboard.ts", () => ({ toggleHelp: vi.fn(), toggleSerialVis: vi.fn(), showDocumentationForSymbol: vi.fn() }));
vi.mock("../extensions/probes.ts", () => ({ toggleCurrentProbe: vi.fn(), expandCurrentProbeContext: vi.fn(), contractCurrentProbeContext: vi.fn() }));
vi.mock("../../ui/keybindings/ActionPalette.tsx", () => ({ openPalette: vi.fn() }));
vi.mock("../../ui/visualisation/serialVisGL.ts", () => ({ requestVisScreenshot: vi.fn() }));
vi.mock("./editorCommandRouter.ts", () => ({ executeEditorCommand: vi.fn(() => true) }));
import { closeMainMenu, dispatchMainMenu, isMainMenuOpen, openMainMenu } from "../../lib/mainMenu/store";
import { executeAction, getHandler } from "./actionHandlers";

afterEach(() => {
  closeMainMenu();
  vi.unstubAllGlobals();
});

describe("global action handlers", () => {
  it("opens the main menu without an editor view", () => {
    expect(executeAction("mainMenu.open", "keyboard")).toBe(true);
    expect(isMainMenuOpen()).toBe(true);
  });

  it("declines manual-control toggles when no editor is available", () => {
    expect(executeAction("control.toggleManualLeft", "gamepad")).toBe(false);
    expect(executeAction("control.toggleManualRight", "gamepad")).toBe(false);
  });

  it("declines main-menu adjustment while no adjustable menu items exist", () => {
    expect(executeAction("mainMenu.adjustUp", "gamepad")).toBe(false);
    expect(executeAction("mainMenu.adjustDown", "gamepad")).toBe(false);
  });

  it("exposes the implemented structural and formatting operations to action dispatch", () => {
    const ids = [
      "format.topLevel", "format.document", "format.indentToFixedPoint",
      "edit.moveRight", "edit.moveLeft", "edit.moveUp", "edit.moveDown",
      "edit.cut", "edit.copy", "edit.paste", "edit.pasteBefore", "edit.duplicate",
      "actOn.cut", "actOn.copy", "actOn.paste", "actOn.duplicate",
      "actOn.wrapList", "actOn.cancel",
    ] as const;
    for (const id of ids) expect(getHandler(id, "gamepad")).toBeDefined();
  });

  it("routes controller selection of Practice Zone through shared menu behavior", () => {
    const browser = { location: { hash: "", reload: vi.fn() } };
    vi.stubGlobal("window", browser);
    openMainMenu();
    dispatchMainMenu({ type: "next", itemCount: 8 });
    expect(executeAction("mainMenu.select", "gamepad")).toBe(true);
    expect(browser.location.hash).toBe("#/zen");
    expect(browser.location.reload).toHaveBeenCalledOnce();
  });
});
