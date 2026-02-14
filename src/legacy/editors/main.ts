import { dbg } from "../utils.ts";
import { EditorView } from "@codemirror/view";
import { EditorState, Extension } from "@codemirror/state";
import {
  activeUserSettings,
  loadUserSettings,
} from "../utils/persistentUserSettings.ts";
import {
  exampleEditorExtensions,
  mainEditorExtensions,
} from "./extensions.ts";
import { setMainEditorTheme } from "./themes/themeManager.ts";
import { setFontSize } from "./editorConfig.ts";
import { codeStorageKey, updateUserSettings } from "../utils/persistentUserSettings.ts";

// Window extensions for debugging/legacy bridges
declare global {
  interface Window {
    editor: EditorView;
    __useq_autosave_settings_listener?: boolean;
    updateUserSettings?: (values: any) => any;
  }
}

// Autosave timer reference (module scoped)
let autosaveTimer: ReturnType<typeof setInterval> | null = null;

function setupAutosaveTimer(editor: EditorView, settings: any): void {
    if (autosaveTimer) {
        clearInterval(autosaveTimer);
        autosaveTimer = null;
    }
    const storage = settings.storage || {};
    if (storage.autoSaveEnabled && storage.saveCodeLocally) {
        const interval = Math.max(1000, parseInt(storage.autoSaveInterval, 10) || 5000);
        autosaveTimer = setInterval(() => {
            if (editor && editor.state) {
                window.localStorage.setItem(codeStorageKey, editor.state.doc.toString());
            }
        }, interval);
    }
}

export function createEditor(startingText: string, extensions: Extension[]): EditorView {
  // Load configuration
  const appConfig = loadUserSettings();
  const config = {
    saveCodeLocally: appConfig.storage.saveCodeLocally,
    evalScope: "top",
  };

  // Create editor state with provided extensions
  const state = EditorState.create({
    doc: startingText || "",
    extensions: extensions || [],
  });

  // Create editor view
  const view = new EditorView({
    state: state,
  });

  // Make sure it's initialised with the current font size
  setFontSize(view, activeUserSettings.editor.fontSize);

  return view;
}

export function createMainEditor(initialText?: string): EditorView {
  dbg(
    "main.mjs createMainEditor: Creating main editor with settings:",
    {
      theme: activeUserSettings.editor?.theme,
      code: initialText ? initialText.length : activeUserSettings.editor?.code?.length,
    }
  );

  // Always prefer the latest saved code if available and settings allow
  let codeToLoad = activeUserSettings.editor.code;
  const storage = activeUserSettings.storage || {};
  if (storage.saveCodeLocally) {
    try {
      const saved = window.localStorage.getItem(codeStorageKey);
      if (typeof saved === 'string' && saved.length > 0) {
        codeToLoad = saved;
      }
    } catch (e) {
      dbg('main.mjs: Error loading saved code from localStorage:', e);
    }
  }
  let editor = createEditor(
    initialText || codeToLoad,
    mainEditorExtensions
  );

  // Add the editor to window for debugging
  window.editor = editor;

  // Set up autosave timer
  setupAutosaveTimer(editor, activeUserSettings);

  // Listen for settings changes to update autosave timer
  if (!window.__useq_autosave_settings_listener) {
    window.__useq_autosave_settings_listener = true;
    const origUpdateUserSettings = updateUserSettings;
    window.updateUserSettings = function (values: any) {
      const result = origUpdateUserSettings(values);
      // Use latest settings
      setupAutosaveTimer(window.editor, activeUserSettings);
      return result;
    };
  }

  return editor;
}

export function createExampleEditor(text: string, parent: HTMLElement): void {
   let state = EditorState.create({
    doc: text,
    extensions: exampleEditorExtensions,
  });

  let view = new EditorView({
    state: state,
    parent: parent,
    extensions: exampleEditorExtensions,
  });
}

export function initEditorPanel(id: string): EditorView {
  const editor = createMainEditor();
  const editorPanel = document.querySelector(id);
  if (editorPanel) {
    editorPanel.appendChild(editor.dom);
  }
  setMainEditorTheme(activeUserSettings.editor.theme);
  return editor;
}

function setupDragAndDropForEditor(container: HTMLElement, editor: EditorView): void {
  container.addEventListener("dragover", (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "copy";
    }

    container.classList.add("drag-over");
  });

  container.addEventListener("dragleave", () => {
    container.classList.remove("drag-over");
  });

  container.addEventListener("drop", (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    container.classList.remove("drag-over");

    const text = e.dataTransfer?.getData("text/plain");
    if (text) {
      const cursor = editor.state.selection.main.head;

      const transaction = editor.state.update({
        changes: {
          from: cursor,
          insert: text,
        },
      });

      editor.dispatch(transaction);
      editor.focus();
    }
  });
}
