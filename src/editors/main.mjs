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

export function createMainEditor() {
  dbg(
    "main.mjs createMainEditor: Creating main editor with settings:",
    {
      theme: activeUserSettings.editor?.theme,
      code: activeUserSettings.editor?.code?.length,
    }
  );

  let editor = createEditor(
    activeUserSettings.editor.code,
    mainEditorExtensions
  );
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
