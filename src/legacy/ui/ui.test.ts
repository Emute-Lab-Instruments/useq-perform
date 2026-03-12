import { beforeEach, describe, expect, it, vi } from "vitest";

const initEditorPanel = vi.fn(() => ({ id: "editor" }));
const initGamepadControl = vi.fn();
const setEditor = vi.fn();
const mountTransportToolbar = vi.fn();
const mountMainToolbar = vi.fn();
const mountSettingsPanel = vi.fn();
const mountHelpPanel = vi.fn();
const mountDesignSelector = vi.fn();
const mountModal = vi.fn();
const mountPickerMenu = vi.fn();
const mountDoubleRadialMenu = vi.fn();

vi.mock("../editors/main.ts", () => ({
  initEditorPanel,
}));

vi.mock("../editors/gamepadControl.ts", () => ({
  initGamepadControl,
}));

vi.mock("../../lib/editorStore.ts", () => ({
  setEditor,
}));

vi.mock("../../ui/adapters/toolbars.tsx", () => ({
  mountTransportToolbar,
  mountMainToolbar,
}));

vi.mock("../../ui/adapters/panels.tsx", () => ({
  mountSettingsPanel,
  mountHelpPanel,
  mountDesignSelector,
  hideAllPanels: vi.fn(),
}));

vi.mock("../../ui/adapters/modal.tsx", () => ({
  mountModal,
}));

vi.mock("../../ui/adapters/picker-menu.tsx", () => ({
  mountPickerMenu,
}));

vi.mock("../../ui/adapters/double-radial-menu.tsx", () => ({
  mountDoubleRadialMenu,
}));

vi.mock("../../runtime/runtimeDiagnostics.ts", () => ({
  reportBootstrapFailure: vi.fn(),
}));

describe("createAppUI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = `
      <div id="panel-main-editor"></div>
      <div id="panel-top-toolbar"></div>
      <div id="panel-toolbar"></div>
      <div id="panel-vis"></div>
      <div id="status-bar"></div>
    `;
  });

  it("mounts the live adapter roots that the app still uses", async () => {
    const { createAppUI } = await import("./ui.ts");

    const ui = await createAppUI({});

    expect(initEditorPanel).toHaveBeenCalledWith("#panel-main-editor");
    expect(setEditor).toHaveBeenCalledWith({ id: "editor" });
    expect(mountTransportToolbar).toHaveBeenCalledTimes(1);
    expect(mountMainToolbar).toHaveBeenCalledTimes(1);
    expect(mountSettingsPanel).toHaveBeenCalledTimes(1);
    expect(mountHelpPanel).toHaveBeenCalledTimes(1);
    expect(mountDesignSelector).toHaveBeenCalledTimes(1);
    expect(mountModal).toHaveBeenCalledTimes(1);
    expect(mountPickerMenu).toHaveBeenCalledTimes(1);
    expect(mountDoubleRadialMenu).toHaveBeenCalledTimes(1);
    expect(initGamepadControl).toHaveBeenCalledWith({ id: "editor" });
    expect(ui.logConsole).toBeNull();
  });
});
