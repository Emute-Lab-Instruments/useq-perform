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

  it("setEditorSession exposes the session-owned view", async () => {
    const { editor, editorSession, setEditorSession } = await loadEditorStore();
    expect(editor()).toBeNull();

    const mockEditor = { test: "editor" };
    const mockSession = { view: mockEditor };
    setEditorSession(mockSession);

    expect(editor()).toBe(mockEditor);
    expect(editorSession.document).toBe(mockSession);
  });

  it("multiple updates work correctly", async () => {
    const { editor, setEditorSession } = await loadEditorStore();

    const editorA = { name: "A" };
    const editorB = { name: "B" };

    setEditorSession({ view: editorA });
    expect(editor()).toBe(editorA);

    setEditorSession({ view: editorB });
    expect(editor()).toBe(editorB);
  });
});
