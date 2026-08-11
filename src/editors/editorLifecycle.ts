/**
 * CodeMirror construction and lifecycle ownership.
 *
 * This module is deliberately in the editor layer: creating an editor depends
 * on runtime settings, production extensions, themes, autosave, and keyboard
 * configuration. The foundation-level `editorStore` only owns the active-view
 * signal and small view operations.
 */
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { dbg } from "../lib/debug.ts";
import { saveEditorCode } from "../lib/persistence.ts";
import type { AppSettings } from "../lib/appSettings.ts";
import {
  getAppSettings,
  subscribeAppSettings,
} from "../runtime/appSettingsRepository.ts";
import { exampleEditorExtensions, mainEditorExtensions } from "./extensions.ts";
import { setFontSize } from "./editorKeyboard.ts";
import { setMainEditorTheme } from "./themes.ts";

let autosaveTimer: ReturnType<typeof setInterval> | null = null;
let mainEditor: EditorView | null = null;
let settingsUnsubscribe: (() => void) | null = null;

function stopAutosave(): void {
  if (autosaveTimer !== null) {
    clearInterval(autosaveTimer);
    autosaveTimer = null;
  }
}

function setupAutosaveTimer(
  editorView: EditorView,
  settings: AppSettings,
): void {
  stopAutosave();
  const storage = settings.storage;
  if (!storage.autoSaveEnabled || !storage.saveCodeLocally) return;

  const interval = Math.min(
    60_000,
    Math.max(1_000, Number(storage.autoSaveInterval) || 5_000),
  );
  autosaveTimer = setInterval(() => {
    saveEditorCode(editorView.state.doc.toString());
  }, interval);
}

export function createEditor(
  startingText: string,
  extensions: Extension[],
): EditorView {
  const view = new EditorView({
    state: EditorState.create({
      doc: startingText,
      extensions,
    }),
  });
  setFontSize(view, getAppSettings().editor.fontSize);
  return view;
}

export function createMainEditor(initialText?: string): EditorView {
  const settings = getAppSettings();
  dbg("editorLifecycle: creating main editor", {
    theme: settings.editor.theme,
    codeLength: initialText?.length ?? settings.editor.code.length,
  });

  mainEditor = createEditor(
    initialText ?? settings.editor.code,
    mainEditorExtensions,
  );
  setupAutosaveTimer(mainEditor, settings);

  settingsUnsubscribe ??= subscribeAppSettings((nextSettings) => {
    if (mainEditor) setupAutosaveTimer(mainEditor, nextSettings);
  });

  return mainEditor;
}

export function createExampleEditor(
  text: string,
  parent: HTMLElement,
): EditorView {
  return new EditorView({
    state: EditorState.create({
      doc: text,
      extensions: exampleEditorExtensions,
    }),
    parent,
  });
}

export function initEditorPanel(selector: string): EditorView {
  const editorView = createMainEditor();
  document.querySelector(selector)?.appendChild(editorView.dom);
  setMainEditorTheme(getAppSettings().editor.theme);
  return editorView;
}

export function disposeEditorLifecycle(): void {
  stopAutosave();
  settingsUnsubscribe?.();
  settingsUnsubscribe = null;
  mainEditor?.destroy();
  mainEditor = null;
}
