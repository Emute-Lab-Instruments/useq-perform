import { EditorView } from "@codemirror/view";
import type { ActiveDocument } from "./editorStore";
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

    const mockEditor = new EditorView();
    const mockSession = session(mockEditor);
    setEditorSession(mockSession);

    expect(editor()).toBe(mockEditor);
    expect(editorSession.document).toBe(mockSession);
    mockEditor.destroy();
  });

  it("multiple updates work correctly", async () => {
    const { editor, setEditorSession } = await loadEditorStore();

    const editorA = new EditorView();
    const editorB = new EditorView();

    setEditorSession(session(editorA));
    expect(editor()).toBe(editorA);

    setEditorSession(session(editorB));
    expect(editor()).toBe(editorB);
    editorA.destroy();
    editorB.destroy();
  });
});

function session(view: EditorView): ActiveDocument {
  return { view, snapshot: () => ({ text: view.state.doc.toString() }), replaceText: vi.fn(), insertText: vi.fn() };
}
