import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorView } from "@codemirror/view";

const { executeEditorCommand } = vi.hoisted(() => ({ executeEditorCommand: vi.fn(() => true) }));
vi.mock("../editors/commands/editorCommandRouter.ts", () => ({ executeEditorCommand }));

import { bindZenGamepadNavigation } from "./zenNavigation";

describe("zen editor actions", () => {
  beforeEach(() => executeEditorCommand.mockClear());

  it("routes delete through the structural command router", () => {
    const dom = {
      classList: { add: vi.fn(), remove: vi.fn(), contains: vi.fn(() => true) },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLElement;
    const view = { dom } as EditorView;
    const navigation = bindZenGamepadNavigation(view, () => "allow");

    expect(navigation.onAction("edit.delete")).toBe(true);
    expect(executeEditorCommand).toHaveBeenCalledWith(view, {
      kind: "structural",
      action: "edit.delete",
      source: "gamepad",
    });
    expect(dom.classList.add).toHaveBeenCalledWith("hide-cursor");
    navigation.dispose();
  });
});
