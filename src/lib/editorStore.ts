// src/lib/editorStore.ts
import { createSignal } from "solid-js";
import type { EditorView } from "@codemirror/view";

/**
 * Typed boundary for the active editor session.
 *
 * Replaces the former window.editor global. Consumers that need the CodeMirror
 * view should access it through this interface rather than DOM lookups or globals.
 */
export interface EditorSession {
  /** The active CodeMirror EditorView instance, or null when no editor is mounted. */
  readonly view: EditorView | null;
}

// We use a signal to store the editor instance so that components can react to it being set
const [editor, setEditor] = createSignal<EditorView | null>(null);

/** Current editor session, exposing the active view through the EditorSession boundary. */
export const editorSession: EditorSession = {
  get view() {
    return editor();
  },
};

export { editor, setEditor };
