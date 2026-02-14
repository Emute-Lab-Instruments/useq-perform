// src/lib/editorStore.ts
import { createSignal } from "solid-js";

// We use a signal to store the editor instance so that components can react to it being set
const [editor, setEditor] = createSignal<any>(null);

export { editor, setEditor };
