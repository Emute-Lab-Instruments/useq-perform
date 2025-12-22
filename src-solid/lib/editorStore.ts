// src-solid/lib/editorStore.ts
import { createSignal } from "solid-js";

declare global {
  interface Window {
    __useqEditor?: any;
    __setUseqEditor?: (editor: any) => void;
  }
}

// We use a signal to store the editor instance so that components can react to it being set
const [editor, setEditor] = createSignal<any>(window.__useqEditor || null);

window.__setUseqEditor = (newEditor: any) => {
  window.__useqEditor = newEditor;
  setEditor(newEditor);
};

export { editor, setEditor };
