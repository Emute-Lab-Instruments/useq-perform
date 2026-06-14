/**
 * Boot-time keymap precedence + ?keymap ephemerality (CF5 / SF3, T12).
 *
 * (a) buildInitialResolver layers persisted settings.keybindings.overrides
 *     and ?keymap URL overrides into the live resolver at boot, with the URL
 *     winning on conflicting keys.
 * (b) Applying a ?keymap URL override must NOT write the settings persistence
 *     key — a shareable link is ephemeral until the user explicitly saves.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// keymaps.ts transitively pulls in the transport stack (via the settings
// repository), which has a fragile circular import that throws at module init
// under Vitest. buildInitialResolver() never touches transport, so stub the
// transport entry points out to keep this an isolated unit test. (Same pattern
// as fanOut.test.ts / appLifecycle.test.ts.)
vi.mock("../transport/connector.ts", () => ({
  checkForSavedPortAndMaybeConnect: () => undefined,
}));
vi.mock("../transport/webSerialHostPort", () => ({
  webSerialHostPort: { kind: "web-serial-host" },
}));

function installMockStorage(): Record<string, string> {
  const store: Record<string, string> = {};
  const storage = {
    getItem: (key: string) => (key in store ? store[key] : null),
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      for (const key of Object.keys(store)) delete store[key];
    },
  };
  Object.defineProperty(window, "localStorage", {
    value: storage,
    configurable: true,
    writable: true,
  });
  return store;
}

function setLocation(search = "/"): void {
  window.history.replaceState({}, "", search);
}

describe("keymaps boot precedence (buildInitialResolver)", () => {
  beforeEach(() => {
    installMockStorage();
    setLocation("/");
  });

  afterEach(() => {
    setLocation("/");
  });

  it("layers persisted + ?keymap overrides, with the URL winning on conflicts", async () => {
    const profiles = await import("../lib/keybindings/profiles.ts");
    const repo = await import("../runtime/appSettingsRepository.ts");
    const appSettings = await import("../lib/appSettings.ts");
    const { buildInitialResolver } = await import("./keymaps.ts");

    // Persisted user override: eval.now -> Mod-p (default is Mod-Enter).
    // Also a persisted-only override that the URL does not touch.
    repo.replaceAppSettings(
      {
        ...appSettings.defaultUserSettings,
        keybindings: {
          ...appSettings.defaultUserSettings.keybindings,
          profile: "default",
          overrides: { "eval.now": "Mod-p", "panel.help": "Alt-1" },
        },
      },
      { persist: false },
    );

    // ?keymap URL override conflicting on eval.now -> Mod-u (URL must win).
    const urlProfile = profiles.exportProfile({
      name: "shared",
      profile: "default",
      overrides: { "eval.now": "Mod-u" },
    });
    const url = profiles.profileToUrl(urlProfile, "https://example.com/");
    setLocation(new URL(url).pathname + new URL(url).search);

    const resolved = buildInitialResolver().resolved();

    // URL wins over persisted for the conflicting key.
    expect(resolved.get("eval.now")?.key).toBe("Mod-u");
    // Persisted-only override (untouched by URL) still applies.
    expect(resolved.get("panel.help")?.key).toBe("Alt-1");
  });

  it("applies persisted overrides at boot when no ?keymap is present", async () => {
    const repo = await import("../runtime/appSettingsRepository.ts");
    const appSettings = await import("../lib/appSettings.ts");
    const { buildInitialResolver } = await import("./keymaps.ts");

    repo.replaceAppSettings(
      {
        ...appSettings.defaultUserSettings,
        keybindings: {
          ...appSettings.defaultUserSettings.keybindings,
          profile: "default",
          overrides: { "eval.now": "Mod-p" },
        },
      },
      { persist: false },
    );

    setLocation("/");
    expect(buildInitialResolver().resolved().get("eval.now")?.key).toBe("Mod-p");
  });
});

describe("applyKeymapFromUrl ephemerality (CF5)", () => {
  let store: Record<string, string>;

  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    store = installMockStorage();
    setLocation("/");
  });

  it("does NOT write the settings persistence key when a ?keymap is applied", async () => {
    const appSettings = await import("../lib/appSettings.ts");
    const profiles = await import("../lib/keybindings/profiles.ts");
    const { applyKeymapFromUrl } = await import("../runtime/applyKeymapFromUrl.ts");
    const { getSettings } = await import("../runtime/runtimeSettingsService.ts");

    const setItemSpy = vi.spyOn(window.localStorage, "setItem");

    const urlProfile = profiles.exportProfile({
      name: "shared",
      profile: "vim",
      overrides: { "eval.now": "Mod-u" },
    });
    const url = profiles.profileToUrl(urlProfile, "https://example.com/");

    const applied = applyKeymapFromUrl(url);
    expect(applied).toBe(true);

    // The keymap took effect in live settings...
    expect(getSettings().keybindings?.overrides).toEqual({ "eval.now": "Mod-u" });

    // ...but nothing was persisted to the settings storage key.
    expect(store[appSettings.settingsStorageKey]).toBeUndefined();
    expect(
      setItemSpy.mock.calls.some(([key]) => key === appSettings.settingsStorageKey),
    ).toBe(false);
  });
});
