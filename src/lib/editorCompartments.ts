import { Compartment, Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { saveRaw, PERSISTENCE_KEYS } from './persistence.ts';

// Create compartments for theme and font size
export const themeCompartment = new Compartment();
export const fontSizeCompartment = new Compartment();

export const stateExtensions: Extension[] = [];

interface StorageConfig {
  saveCodeLocally: boolean;
}

function createUpdateListener(storageConfig: StorageConfig) {
    return EditorView.updateListener.of((update) => {
      if (update.docChanged && storageConfig.saveCodeLocally) {
        // Save to local storage when document changes
        saveRaw(PERSISTENCE_KEYS.editorContent, update.state.doc.toString());
      }
    });
  }
