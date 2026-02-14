import { beforeEach, describe, expect, it, vi } from "vitest";

async function loadEditorStore() {
  vi.resetModules();
  const module = await import("./editorStore");
  return module;
}

describe("editorStore", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("initial value is null", async () => {
    const { editor } = await loadEditorStore();

    expect(editor()).toBeNull();
  });

  it("setEditor updates the signal", async () => {
    const { editor, setEditor } = await loadEditorStore();
    expect(editor()).toBeNull();

    const mockEditor = { test: "editor" };
    setEditor(mockEditor);

    expect(editor()).toBe(mockEditor);
  });

  it("multiple updates work correctly", async () => {
    const { editor, setEditor } = await loadEditorStore();

    const editorA = { name: "A" };
    const editorB = { name: "B" };

    setEditor(editorA);
    expect(editor()).toBe(editorA);

    setEditor(editorB);
    expect(editor()).toBe(editorB);
  });
});
