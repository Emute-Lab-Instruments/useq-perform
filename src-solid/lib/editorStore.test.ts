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
    delete window.__useqEditor;
    delete window.__setUseqEditor;
  });

  it("initial value is null when window.__useqEditor is undefined", async () => {
    const { editor } = await loadEditorStore();

    expect(editor()).toBeNull();
  });

  it("initial value comes from window.__useqEditor when already set", async () => {
    const mockEditor = { mock: true };
    window.__useqEditor = mockEditor;

    const { editor } = await loadEditorStore();

    expect(editor()).toBe(mockEditor);
  });

  it("window.__setUseqEditor updates the signal", async () => {
    const { editor } = await loadEditorStore();
    expect(editor()).toBeNull();

    const mockEditor = { test: "editor" };
    window.__setUseqEditor!(mockEditor);

    expect(editor()).toBe(mockEditor);
  });

  it("window.__setUseqEditor also updates window.__useqEditor for legacy access", async () => {
    await loadEditorStore();

    const mockEditor = { legacy: "access" };
    window.__setUseqEditor!(mockEditor);

    expect(window.__useqEditor).toBe(mockEditor);
  });

  it("multiple updates work correctly", async () => {
    const { editor } = await loadEditorStore();

    const editorA = { name: "A" };
    const editorB = { name: "B" };

    window.__setUseqEditor!(editorA);
    expect(editor()).toBe(editorA);
    expect(window.__useqEditor).toBe(editorA);

    window.__setUseqEditor!(editorB);
    expect(editor()).toBe(editorB);
    expect(window.__useqEditor).toBe(editorB);
  });
});
