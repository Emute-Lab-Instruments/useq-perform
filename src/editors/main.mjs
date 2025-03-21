import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { activeUserSettings, loadUserSettings } from '../utils/persistentUserSettings.mjs';
import { mainEditorExtensions } from './extensions.mjs';
import { setMainEditorTheme } from './themes/themeManager.mjs';
import { setFontSize } from './editorConfig.mjs';

/**
 * Creates and configures the editor instance
 * @param {string} startingText - Initial text content for the editor
 * @param {Array} extensions - Array of CodeMirror extensions to use
 */
export function createEditor(startingText, extensions) {
  // Load configuration
  const appConfig = loadUserSettings();
  const config = {
    saveCodeLocally: appConfig.storage.saveCodeLocally,
    evalScope: "top"
  };
  
  // Create editor state with provided extensions
  const state = EditorState.create({
    doc: startingText || '',
    extensions: extensions || []
  });
  
  // Create editor view
  const view = new EditorView({
    state: state
  });

  // Make sure it's initialised with the current font size
  setFontSize(view, activeUserSettings.editor.fontSize);

  return view;
}

export function createMainEditor() {
  console.log('main.mjs createMainEditor: Creating main editor with settings:', {
    theme: activeUserSettings.editor?.theme,
    code: activeUserSettings.editor?.code?.length
  });

  let editor = createEditor(activeUserSettings.editor.code, mainEditorExtensions);
  return editor;
}

export function initEditorPanel() {
  const editor = createMainEditor();
  $('#panel-main-editor').append(editor.dom);
  setMainEditorTheme(activeUserSettings.editor.theme);
  return editor;
}