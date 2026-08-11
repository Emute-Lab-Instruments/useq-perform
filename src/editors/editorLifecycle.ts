/**
 * CodeMirror construction and lifecycle ownership.
 *
 * This module is deliberately in the editor layer: creating an editor depends
 * on runtime settings, production extensions, themes, autosave, and keyboard
 * configuration. The foundation-level `editorStore` only owns the active-view
 * signal and small view operations.
 */
import { dbg } from "../lib/debug.ts";
import {
  getAppSettings,
  subscribeAppSettings,
} from "../runtime/appSettingsRepository.ts";
import { createMainEditorExtensions } from "./extensions.ts";
import {
  createPersistentDocumentSession,
  type DocumentSession,
} from "./documentSession.ts";
import { setFontSize } from "./editorKeyboard.ts";
import { setMainEditorTheme } from "./themes.ts";

let mainDocumentSession: DocumentSession | null = null;
let settingsUnsubscribe: (() => void) | null = null;

export function createMainEditor(initialText?: string): DocumentSession {
  const settings = getAppSettings();
  dbg("editorLifecycle: creating main editor", {
    theme: settings.editor.theme,
    codeLength: initialText?.length ?? settings.editor.code.length,
  });

  mainDocumentSession = createPersistentDocumentSession({
    initialText: initialText ?? settings.editor.code,
    settings,
    buildExtensions: createMainEditorExtensions,
  });
  setFontSize(mainDocumentSession.view, settings.editor.fontSize);

  settingsUnsubscribe ??= subscribeAppSettings((nextSettings) => {
    mainDocumentSession?.setPersistenceSettings(nextSettings);
  });

  return mainDocumentSession;
}

export function initEditorPanel(selector: string): DocumentSession {
  const session = createMainEditor();
  document.querySelector(selector)?.appendChild(session.view.dom);
  setMainEditorTheme(getAppSettings().editor.theme);
  return session;
}

export function disposeEditorLifecycle(): void {
  settingsUnsubscribe?.();
  settingsUnsubscribe = null;
  mainDocumentSession?.dispose();
  mainDocumentSession = null;
}
