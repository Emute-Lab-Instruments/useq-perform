import { afterEach, describe, expect, it } from "vitest";
import { applyKeymapFromUrl } from "./applyKeymapFromUrl.ts";
import { getSettings, resetSettings } from "./runtimeSettingsService.ts";
import { exportProfile, profileToUrl } from "../lib/keybindings/profiles.ts";

afterEach(() => {
  resetSettings();
});

describe("applyKeymapFromUrl (?keymap URL param)", () => {
  it("returns false and changes nothing when no ?keymap param is present", () => {
    const before = JSON.stringify(getSettings().keybindings ?? null);
    const applied = applyKeymapFromUrl("https://example.com/?foo=bar");
    expect(applied).toBe(false);
    expect(JSON.stringify(getSettings().keybindings ?? null)).toBe(before);
  });

  it("decodes a ?keymap profile and applies it to keybindings settings", () => {
    const profile = exportProfile({
      name: "test",
      profile: "vim",
      overrides: { "eval.now": "Mod-Enter" },
      gamepadOverrides: { "eval.now": ["A"] },
    });
    const url = profileToUrl(profile, "https://example.com/");

    const applied = applyKeymapFromUrl(url);
    expect(applied).toBe(true);

    const kb = getSettings().keybindings;
    expect(kb?.profile).toBe("vim");
    expect(kb?.overrides).toEqual({ "eval.now": "Mod-Enter" });
    expect(kb?.gamepadOverrides).toEqual({ "eval.now": ["A"] });
  });

  it("returns false on an undecodable ?keymap value without throwing", () => {
    const applied = applyKeymapFromUrl("https://example.com/?keymap=%%%not-base64%%%");
    expect(applied).toBe(false);
  });
});
