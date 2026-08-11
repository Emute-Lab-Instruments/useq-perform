// src/lib/editorStore.ts
//
// Foundation-level state boundary for the active CodeMirror session. Editor
// construction and lifecycle live in `src/editors/editorLifecycle.ts`, where
// dependencies on settings, themes, and editor extensions belong.
import { createSignal } from "solid-js";
import { EditorView } from "@codemirror/view";
import { fontSizeCompartment } from "./editorCompartments.ts";

/** Narrow session seam needed by foundation-level active-editor consumers. */
export interface ActiveDocument {
  readonly view: EditorView;
  snapshot(): { readonly text: string };
  replaceText(text: string): void;
  insertText(text: string, position?: number): void;
}

/**
 * Typed boundary for the active editor session.
 *
 * Replaces the former window.editor global. Consumers that need the CodeMirror
 * view should access it through this interface rather than DOM lookups or globals.
 */
export interface ActiveEditorSession {
  /** The active CodeMirror EditorView instance, or null when no editor is mounted. */
  readonly view: EditorView | null;
  /** The owning document lifetime, or null when no editor is mounted. */
  readonly document: ActiveDocument | null;
}

// Store the owning lifetime, then derive the historical `editor()` view
// accessor for view-level consumers. No caller owns a raw active view.
const [activeDocumentSession, setEditorSession] =
  createSignal<ActiveDocument | null>(null);

export function editor(): EditorView | null {
  return activeDocumentSession()?.view ?? null;
}

/** Current editor session, exposing the active view through the EditorSession boundary. */
export const editorSession: ActiveEditorSession = {
  get view() {
    return editor();
  },
  get document() {
    return activeDocumentSession();
  },
};

export { activeDocumentSession, setEditorSession };

// ---------------------------------------------------------------------------
// Editor facade -- typed API that modern code uses instead of importing legacy
// editor internals directly.
// ---------------------------------------------------------------------------

/**
 * Return the full text content of the active editor, or `null` when no editor
 * is mounted.
 */
export function getEditorContent(): string | null {
  return activeDocumentSession()?.snapshot().text ?? null;
}

/**
 * Replace the entire document content of the active editor.
 * Returns `true` if the replacement was applied, `false` when no editor is
 * mounted.
 */
export function setEditorContent(text: string): boolean {
  const session = activeDocumentSession();
  if (!session) return false;
  session.replaceText(text);
  return true;
}

/**
 * Insert `text` at position `pos` (defaults to 0).
 * Returns `true` if the insertion was applied.
 */
export function insertEditorText(text: string, pos: number = 0): boolean {
  const session = activeDocumentSession();
  if (!session) return false;
  session.insertText(text, pos);
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
