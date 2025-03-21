import { Compartment } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

export const themeCompartment = new Compartment();
export const fontSizeCompartment = new Compartment();



export const stateExtensions = [];

function createUpdateListener(storageConfig) {
    return EditorView.updateListener.of((update) => {
      if (update.docChanged && storageConfig.saveCodeLocally) {
        // Save to local storage when document changes
        localStorage.setItem('editorContent', update.state.doc.toString());
      }
    });
  }