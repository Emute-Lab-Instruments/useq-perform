// src/lib/editorStore.ts
import { createSignal } from "solid-js";
import type { EditorView } from "@codemirror/view";

// We use a signal to store the editor instance so that components can react to it being set
const [editor, setEditor] = createSignal<EditorView | null>(null);

export { editor, setEditor };
