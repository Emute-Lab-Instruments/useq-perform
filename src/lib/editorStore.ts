// src/lib/editorStore.ts
//
// Canonical editor boundary. All modern code should interact with the editor
// through the API exported here rather than reaching into legacy modules.
import { createSignal } from "solid-js";
import { EditorView } from "@codemirror/view";
import { fontSizeCompartment } from "./editorCompartments.ts";

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

// ---------------------------------------------------------------------------
// Editor facade -- typed API that modern code uses instead of importing legacy
// editor internals directly.
// ---------------------------------------------------------------------------

/**
 * Return the full text content of the active editor, or `null` when no editor
 * is mounted.
 */
export function getEditorContent(): string | null {
  const view = editor();
  return view ? view.state.doc.toString() : null;
}

/**
 * Replace the entire document content of the active editor.
 * Returns `true` if the replacement was applied, `false` when no editor is
 * mounted.
 */
export function setEditorContent(text: string): boolean {
  const view = editor();
  if (!view) return false;
  const transaction = view.state.update({
    changes: { from: 0, to: view.state.doc.length, insert: text },
  });
  view.dispatch(transaction);
  return true;
}

/**
 * Insert `text` at position `pos` (defaults to 0).
 * Returns `true` if the insertion was applied.
 */
export function insertEditorText(text: string, pos: number = 0): boolean {
  const view = editor();
  if (!view) return false;
  const transaction = view.state.update({
    changes: { from: pos, to: pos, insert: text },
  });
  view.dispatch(transaction);
  return true;
}

// ---------------------------------------------------------------------------
// Font-size application -- single source of truth for dispatching font-size
// reconfiguration through the CodeMirror compartment.
// ---------------------------------------------------------------------------

/**
 * Apply a font-size reconfiguration to an editor view. This is the single
 * canonical place where the fontSizeCompartment is reconfigured -- callers
 * should never import the compartment directly.
 *
 * Accepts a `Pick<EditorView, "dispatch">` so it can also be used in tests
 * with a minimal mock.
 */
export function applyEditorFontSize(
  target: Pick<EditorView, "dispatch">,
  fontSize: number,
): void {
  target.dispatch({
    effects: fontSizeCompartment.reconfigure(
      EditorView.theme({
        ".cm-content, .cm-cursor, .cm-gutters, .cm-lineNumbers": {
          fontSize: `${fontSize}px`,
          lineHeight: `${Math.ceil(fontSize * 1.5)}px`,
        },
        ".cm-gutters .cm-lineNumber": {
          display: "flex",
          alignItems: "center",
          height: "100%",
        },
      }),
    ),
  });
}
