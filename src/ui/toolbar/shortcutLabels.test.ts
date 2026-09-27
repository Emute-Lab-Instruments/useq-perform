import { describe, it, expect } from "vitest";
import { formatShortcut, resolveToolbarShortcuts, withShortcut } from "./shortcutLabels";

describe("formatShortcut", () => {
  it("maps Mod to Ctrl off macOS and Cmd on macOS", () => {
    expect(formatShortcut("Mod-Enter", false)).toBe("Ctrl+Enter");
    expect(formatShortcut("Mod-Enter", true)).toBe("Cmd+Enter");
  });

  it("maps Alt to Option on macOS and uppercases single letters", () => {
    expect(formatShortcut("Alt-g", false)).toBe("Alt+G");
    expect(formatShortcut("Alt-g", true)).toBe("Option+G");
    expect(formatShortcut("Mod-Shift-p", false)).toBe("Ctrl+Shift+P");
  });

  it("keeps punctuation keys, a literal minus key, and chord strokes", () => {
    expect(formatShortcut("Alt-/", false)).toBe("Alt+/");
    expect(formatShortcut("Ctrl--", false)).toBe("Ctrl+-");
    expect(formatShortcut("Alt-s ]", false)).toBe("Alt+S ]");
  });
});

describe("resolveToolbarShortcuts", () => {
  it("returns formatted bindings only for mapped, bound actions", () => {
    const lookup = (action: string) => (action === "panel.vis" ? "Alt-g" : undefined);
    const result = resolveToolbarShortcuts(
      { graph: "panel.vis", help: "panel.help" },
      lookup,
      false,
    );
    expect(result).toEqual({ graph: "Alt+G" });
  });
});

describe("withShortcut", () => {
  it("appends the shortcut in parentheses when present", () => {
    expect(withShortcut("Graph", "Alt+G")).toBe("Graph (Alt+G)");
    expect(withShortcut("Graph", undefined)).toBe("Graph");
  });
});
