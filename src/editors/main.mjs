import { dbg } from "../utils.mjs";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import {
  activeUserSettings,
  loadUserSettings,
} from "../utils/persistentUserSettings.mjs";
import {
  exampleEditorExtensions,
  mainEditorExtensions,
} from "./extensions.mjs";
import { setMainEditorTheme } from "./themes/themeManager.mjs";
import { setFontSize } from "./editorConfig.mjs";
import { codeStorageKey, updateUserSettings } from "../utils/persistentUserSettings.mjs";

// Autosave timer reference (module scoped)
let autosaveTimer = null;

/**
 * Start or update the autosave timer based on user settings
 * @param {EditorView} editor - The editor instance
 * @param {Object} settings - The user settings object
 */
function setupAutosaveTimer(editor, settings) {
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
// import { debugSExprTracking } from "./extensions/sexprTest.mjs";

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

export function createMainEditor(initialText) {
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
    window.updateUserSettings = function (values) {
      const result = origUpdateUserSettings(values);
      // Use latest settings
      setupAutosaveTimer(window.editor, activeUserSettings);
      return result;
    };
  }

  // Add debug function for S-Expression tracking
  // window.debugSExprTracking = () => debugSExprTracking(editor);

  return editor;
}

export function createExampleEditor(text, parent) {
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

export function initEditorPanel(id) {
  const editor = createMainEditor();
  const editorPanel = $(id);
  editorPanel.append(editor.dom);
  setMainEditorTheme(activeUserSettings.editor.theme);
  return editor;
}

/**
 * Set up drag and drop functionality for the editor
 * @param {HTMLElement} container - The editor container element
 * @param {EditorView} editor - The CodeMirror editor instance
 */
function setupDragAndDropForEditor(container, editor) {
  // Add event listeners for drag and drop events
  container.addEventListener("dragover", (e) => {
    // Prevent default to allow drop
    e.preventDefault();
    e.stopPropagation();

    // Change the cursor style as a visual cue
    e.dataTransfer.dropEffect = "copy";

    // Add a highlight effect to indicate droppable area
    container.classList.add("drag-over");
  });

  container.addEventListener("dragleave", () => {
    // Remove highlight effect
    container.classList.remove("drag-over");
  });

  container.addEventListener("drop", (e) => {
    // Prevent default drop action
    e.preventDefault();
    e.stopPropagation();

    // Remove highlight effect
    container.classList.remove("drag-over");

    // Get the dropped text
    const text = e.dataTransfer.getData("text/plain");
    if (text) {
      // Insert the text at the current cursor position
      const cursor = editor.state.selection.main.head;

      // Create a transaction to insert the text
      const transaction = editor.state.update({
        changes: {
          from: cursor,
          insert: text,
        },
      });

      // Apply the transaction
      editor.dispatch(transaction);

      // Focus the editor
      editor.focus();
    }
  });
}
