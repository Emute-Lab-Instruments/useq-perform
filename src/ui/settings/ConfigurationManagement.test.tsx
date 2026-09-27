import { render, screen, waitFor } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it, vi } from "vitest";

const configManager = vi.hoisted(() => ({
  saveConfiguration: vi.fn(),
  exportConfiguration: vi.fn(),
  importConfiguration: vi.fn(),
  loadConfigurationFromFile: vi.fn(),
  previewConfiguration: vi.fn(),
}));
vi.mock("../../runtime/configManager.ts", () => configManager);

import { ConfigurationManagement, handleSettingsImport } from "./ConfigurationManagement";

beforeEach(() => {
  Object.values(configManager).forEach((fn) => fn.mockReset());
});

describe("ConfigurationManagement", () => {
  it("does not render outside devmode", () => {
    const { container } = render(() => <ConfigurationManagement devmode={false} />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText("Developer Tools")).toBeNull();
  });

  it("renders the dev-only promote-to-defaults control in devmode", () => {
    render(() => <ConfigurationManagement devmode />);

    // Title is always visible even when section is collapsed
    expect(screen.getByText("Developer Tools")).toBeTruthy();

    // Expand the section to reveal content
    screen.getByText("Developer Tools").closest("button")?.click();

    expect(screen.getByRole("button", { name: "Promote to Defaults" })).toBeTruthy();
  });

  it("confirms promotion with a destructive in-app dialog and reports success as a toast", async () => {
    const confirm = vi.fn().mockResolvedValue(true);
    const notify = vi.fn();
    configManager.saveConfiguration.mockResolvedValue({ method: "websocket", path: "src/runtime/default-config.json" });

    render(() => <ConfigurationManagement devmode confirm={confirm} notify={notify} />);
    screen.getByText("Developer Tools").closest("button")?.click();
    screen.getByRole("button", { name: "Promote to Defaults" }).click();

    await waitFor(() => expect(notify).toHaveBeenCalled());
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ destructive: true }));
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ kind: "success" }));
  });

  it("does not promote when the confirm is declined", async () => {
    const confirm = vi.fn().mockResolvedValue(false);
    const notify = vi.fn();

    render(() => <ConfigurationManagement devmode confirm={confirm} notify={notify} />);
    screen.getByText("Developer Tools").closest("button")?.click();
    screen.getByRole("button", { name: "Promote to Defaults" }).click();

    await waitFor(() => expect(confirm).toHaveBeenCalled());
    await Promise.resolve();
    expect(configManager.saveConfiguration).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("reports promotion failures as error toasts", async () => {
    const notify = vi.fn();
    configManager.saveConfiguration.mockRejectedValue(new Error("no server"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(() => <ConfigurationManagement devmode confirm={async () => true} notify={notify} />);
    screen.getByText("Developer Tools").closest("button")?.click();
    screen.getByRole("button", { name: "Promote to Defaults" }).click();

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(expect.objectContaining({ kind: "error", message: expect.stringContaining("no server") })),
    );
  });
});

describe("handleSettingsImport", () => {
  it("imports and reloads only after the in-app confirm resolves true", async () => {
    const config = { settings: {} };
    configManager.loadConfigurationFromFile.mockResolvedValue(config);
    configManager.previewConfiguration.mockReturnValue({ hasChanges: true, diffs: ["theme: a → b"] });
    const confirm = vi.fn().mockResolvedValue(true);
    const onReload = vi.fn();

    await handleSettingsImport(onReload, { confirm, notify: vi.fn() })();

    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("theme: a → b") }));
    expect(configManager.importConfiguration).toHaveBeenCalledWith(config);
    expect(onReload).toHaveBeenCalledOnce();
  });

  it("does nothing when the confirm is declined", async () => {
    configManager.loadConfigurationFromFile.mockResolvedValue({});
    configManager.previewConfiguration.mockReturnValue({ hasChanges: false, diffs: [] });
    const onReload = vi.fn();

    await handleSettingsImport(onReload, { confirm: async () => false, notify: vi.fn() })();

    expect(configManager.importConfiguration).not.toHaveBeenCalled();
    expect(onReload).not.toHaveBeenCalled();
  });

  it("reports import failures as error toasts", async () => {
    configManager.loadConfigurationFromFile.mockRejectedValue(new Error("bad json"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const notify = vi.fn();

    await handleSettingsImport(vi.fn(), { confirm: vi.fn(), notify })();

    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ kind: "error", message: expect.stringContaining("bad json") }));
  });
});
