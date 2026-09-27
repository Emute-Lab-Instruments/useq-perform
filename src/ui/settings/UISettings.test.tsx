import { fireEvent, render } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../utils/settingsStore", () => ({
  settings: { ui: {} },
  requestSettingsUpdate: vi.fn(),
}));

import { UISettings } from "./UISettings";
import { createDefaultUserSettings } from "../../lib/appSettings.ts";

function expandAll() {
  for (let i = 0; i < 3; i++) {
    for (const btn of document.querySelectorAll<HTMLElement>(".panel-section-toggle")) {
      const parent = btn.closest(".panel-section");
      if (parent && !parent.querySelector(".panel-section-body")) btn.click();
    }
  }
}

function panelStyleSelect(): HTMLSelectElement {
  const row = [...document.querySelectorAll(".panel-row")].find(
    (r) => r.querySelector(".panel-label")?.textContent === "Panel style",
  );
  const select = row?.querySelector("select");
  if (!select) throw new Error("Panel style select not rendered");
  return select;
}

describe("UISettings panel style", () => {
  it("shows the persisted panel chrome design and routes changes through the update callback", () => {
    const settings = createDefaultUserSettings();
    settings.ui.panelChrome = "tile";
    const onUpdateSettings = vi.fn();
    const mounted = render(() => (
      <UISettings settings={settings} onUpdateSettings={onUpdateSettings} />
    ));
    expandAll();

    const select = panelStyleSelect();
    expect(select.value).toBe("tile");

    select.value = "drawer";
    fireEvent.change(select);
    expect(onUpdateSettings).toHaveBeenCalledWith({
      ui: expect.objectContaining({ panelChrome: "drawer" }),
    });
    mounted.unmount();
  });
});
