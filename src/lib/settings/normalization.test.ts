import { describe, expect, it } from "vitest";
import { normalizeUserSettings } from "./normalization.ts";
import { defaultUserSettings } from "./schema.ts";

describe("ui.panelChrome normalization (settings.md §1.7, §1.8.2)", () => {
  it("defaults to the pane design", () => {
    expect(defaultUserSettings.ui.panelChrome).toBe("pane");
    expect(normalizeUserSettings({}).ui.panelChrome).toBe("pane");
  });

  it("fills the default for stored settings that predate the field", () => {
    const stored = { ui: { consoleLinesLimit: 500, gamepadPickerStyle: "radial" } };
    const normalized = normalizeUserSettings(stored);
    expect(normalized.ui.panelChrome).toBe("pane");
    expect(normalized.ui.consoleLinesLimit).toBe(500);
  });

  it("keeps every valid design", () => {
    for (const design of ["pane", "drawer", "tile"] as const) {
      expect(normalizeUserSettings({ ui: { panelChrome: design } }).ui.panelChrome).toBe(design);
    }
  });

  it("replaces unknown values with the default", () => {
    for (const bad of ["floating", 3, null, {}]) {
      expect(normalizeUserSettings({ ui: { panelChrome: bad } }).ui.panelChrome).toBe("pane");
    }
  });
});
