// src/lib/editorStore.ts
//
// Canonical editor boundary. All modern code should interact with the editor
// through the API exported here rather than reaching into legacy modules.
//
// Editor creation functions (createEditor, createMainEditor, initEditorPanel)
// use dynamic import() to resolve their dependencies because several of those
// modules (themes.ts, editorConfig.ts) import back from this file, and
// appSettingsRepository.ts triggers module-scope evaluation that causes TDZ
// errors when loaded in certain orders. Dynamic import() defers resolution
// until first call, by which time all modules are fully initialized.
import { createSignal } from "solid-js";
import { EditorView } from "@codemirror/view";
import { EditorState, type Extension } from "@codemirror/state";
import { fontSizeCompartment } from "./editorCompartments.ts";
import { saveRaw, PERSISTENCE_KEYS } from "./persistence.ts";

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

// ---------------------------------------------------------------------------
// Editor creation and autosave -- merged from legacy/editors/main.ts
//
// Dependencies are resolved via dynamic import() on first call to break
// circular dependency chains (see module header comment).
// ---------------------------------------------------------------------------

let autosaveTimer: ReturnType<typeof setInterval> | null = null;
let _mainEditor: EditorView | null = null;
let _settingsUnsubscribe: (() => void) | null = null;

// Cached lazy dependencies
let _getAppSettings: (() => any) | null = null;
let _subscribeAppSettings: ((listener: (s: any) => void) => () => void) | null = null;
let _mainEditorExtensions: Extension[] | null = null;
let _exampleEditorExtensions: Extension[] | null = null;
let _setMainEditorTheme: ((theme: string) => void) | null = null;
let _setFontSize: ((editor: EditorView | null, size: number) => void) | null = null;
let _dbg: ((...args: any[]) => void) | null = null;

async function resolveEditorDeps(): Promise<void> {
  if (_getAppSettings) return; // already resolved

  const [repoMod, extsMod, themesMod, editorCfgMod, debugMod] = await Promise.all([
    import("../runtime/appSettingsRepository.ts"),
    import("../editors/extensions.ts"),
    import("../editors/themes.ts"),
    import("../editors/editorConfig.ts"),
    import("./debug.ts"),
  ]);

  _getAppSettings = repoMod.getAppSettings;
  _subscribeAppSettings = repoMod.subscribeAppSettings;
  _mainEditorExtensions = extsMod.mainEditorExtensions;
  _exampleEditorExtensions = extsMod.exampleEditorExtensions;
  _setMainEditorTheme = themesMod.setMainEditorTheme;
  _setFontSize = editorCfgMod.setFontSize;
  _dbg = debugMod.dbg;
}

function setupAutosaveTimer(editorView: EditorView, settings: any): void {
  if (autosaveTimer) {
    clearInterval(autosaveTimer);
    autosaveTimer = null;
  }
  const storage = settings.storage || {};
  if (storage.autoSaveEnabled && storage.saveCodeLocally) {
    const interval = Math.max(1000, parseInt(storage.autoSaveInterval, 10) || 5000);
    autosaveTimer = setInterval(() => {
      if (editorView && editorView.state) {
        saveRaw(PERSISTENCE_KEYS.editorCode, editorView.state.doc.toString());
      }
    }, interval);
  }
}

export function createEditor(startingText: string, extensions: Extension[]): EditorView {
  const state = EditorState.create({
    doc: startingText || "",
    extensions: extensions || [],
  });

  const view = new EditorView({
    state: state,
  });

  _setFontSize!(view, _getAppSettings!().editor.fontSize);

  return view;
}

export function createMainEditor(initialText?: string): EditorView {
  const currentSettings = _getAppSettings!();
  _dbg!(
    "editorStore createMainEditor: Creating main editor with settings:",
    {
      theme: currentSettings.editor?.theme,
      code: initialText ? initialText.length : currentSettings.editor?.code?.length,
    }
  );

  const codeToLoad = currentSettings.editor.code;
  const editorView = createEditor(
    initialText || codeToLoad,
    _mainEditorExtensions!
  );

  _mainEditor = editorView;
  setupAutosaveTimer(editorView, currentSettings);

  // Subscribe to settings changes (lazy: only when main editor exists).
  if (!_settingsUnsubscribe) {
    _settingsUnsubscribe = _subscribeAppSettings!((settings: any) => {
      if (_mainEditor) {
        setupAutosaveTimer(_mainEditor, settings);
      }
    });
  }

  return editorView;
}

export function createExampleEditor(text: string, parent: HTMLElement): void {
  const state = EditorState.create({
    doc: text,
    extensions: _exampleEditorExtensions!,
  });

  new EditorView({
    state: state,
    parent: parent,
    extensions: _exampleEditorExtensions!,
  });
}

/**
 * Initialize the editor panel: resolve dependencies, create the main editor,
 * mount it into the DOM, and apply the current theme.
 */
export async function initEditorPanel(id: string): Promise<EditorView> {
  await resolveEditorDeps();

  const editorView = createMainEditor();
  const editorPanel = document.querySelector(id);
  if (editorPanel) {
    editorPanel.appendChild(editorView.dom);
  }
  _setMainEditorTheme!(_getAppSettings!().editor.theme);
  return editorView;
}
