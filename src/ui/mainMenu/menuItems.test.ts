// src/ui/mainMenu/menuItems.test.ts
//
// Verifies the main-menu root item structure matches main-menu.md §3.1 / §3.2,
// including the four items that used to be missing (Practice Zone, Save,
// Restore, Transport) and the Audio/Transport settings category (§3.4).

import { describe, expect, it } from "vitest";
import { ROOT_MENU_ITEMS, resolveItems, currentSubmenuLabel } from "./menuItems";

describe("ROOT_MENU_ITEMS — spec §3.1 / §3.2", () => {
  it("lists all eight top-level items in spec order", () => {
    expect(ROOT_MENU_ITEMS.map((i) => i.id)).toEqual([
      "resume",
      "practiceZone",
      "save",
      "restore",
      "settings",
      "help",
      "connection",
      "transport",
    ]);
  });

  it("Practice Zone is an action (enters zen mode)", () => {
    const item = ROOT_MENU_ITEMS.find((i) => i.id === "practiceZone");
    expect(item?.type).toBe("action");
    expect(item?.label).toBe("Practice Zone");
  });

  it("Save / Restore / Transport are submenus", () => {
    for (const id of ["save", "restore", "transport"]) {
      const item = ROOT_MENU_ITEMS.find((i) => i.id === id);
      expect(item?.type, id).toBe("submenu");
      expect(item?.children?.length, id).toBeGreaterThan(0);
    }
  });

  it("Settings submenu includes the Audio/Transport category (§3.4)", () => {
    const settings = ROOT_MENU_ITEMS.find((i) => i.id === "settings");
    const ids = (settings?.children ?? []).map((c) => c.id);
    expect(ids).toContain("settings.audioTransport");
    // The four pre-existing categories must still be present.
    expect(ids).toEqual(
      expect.arrayContaining([
        "settings.general",
        "settings.editor",
        "settings.gamepad",
        "settings.vis",
      ]),
    );
  });
});

describe("resolveItems — submenu navigation", () => {
  it("resolves Transport submenu children", () => {
    const items = resolveItems(["transport"]);
    expect(items.map((i) => i.id)).toEqual([
      "transport.play",
      "transport.pause",
      "transport.stop",
      "transport.rewind",
      "transport.bpm",
      "transport.timeSig",
    ]);
  });

  it("currentSubmenuLabel reports the open submenu", () => {
    expect(currentSubmenuLabel(["restore"])).toBe("Restore");
    expect(currentSubmenuLabel([])).toBeNull();
  });
});
