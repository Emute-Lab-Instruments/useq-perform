// src/effects/editor.ts
import type { EditorView } from "@codemirror/view";
import { applyEditorFontSize } from "../lib/editorStore";
import { getAppSettings } from "../runtime/appSettingsRepository.ts";
import { updateSettings } from "../runtime/runtimeService.ts";

// Re-export applyEditorFontSize so existing consumers that import it from
// here continue to work without changes.
export { applyEditorFontSize } from "../lib/editorStore";

/**
 * FileSystemFileHandle is part of the File System Access API (not in all TS lib targets).
 * We declare a minimal interface for what we actually use.
 */
interface FileSystemWritableFileStream {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}

interface FileSystemFileHandle {
  getFile(): Promise<File>;
  createWritable(): Promise<FileSystemWritableFileStream>;
}

// Extend Window to declare the File System Access API pickers we use.
declare global {
  interface Window {
    showOpenFilePicker(): Promise<FileSystemFileHandle[]>;
    showSaveFilePicker(options?: {
      suggestedName?: string;
      types?: Array<{
        description: string;
        accept: Record<string, string[]>;
      }>;
    }): Promise<FileSystemFileHandle>;
  }
}

export function adjustFontSize(currentEditor: EditorView | null, delta: number) {
  if (!currentEditor) return;

  const currentSettings = getAppSettings();
  const newFontSize = currentSettings.editor.fontSize + delta;
  applyEditorFontSize(currentEditor, newFontSize);
  updateSettings({ editor: { fontSize: newFontSize } });
}

export async function loadCode(currentEditor: EditorView | null) {
  if (!currentEditor) return;

  try {
    const [fileHandle] = await window.showOpenFilePicker();
    const file = await fileHandle.getFile();
    const contents = await file.text();
    const data: unknown = JSON.parse(contents);
    if (typeof data !== "object" || data === null || Array.isArray(data) ||
        !("text" in data) || typeof data.text !== "string" ||
        ("format_version" in data && data.format_version !== 1)) {
      throw new Error("Invalid uSEQ file: expected text and format_version 1 (or a legacy file without a version).");
    }

    const transactionSpec = {
      changes: { from: 0, to: currentEditor.state.doc.length, insert: data.text }
    };
    const transaction = currentEditor.state.update(transactionSpec);
    currentEditor.dispatch(transaction);
  } catch (e) {
    console.error("Failed to load file", e instanceof Error ? e.message : String(e));
  }
}

export async function saveCode(currentEditor: EditorView | null) {
  if (!currentEditor) return;

  const fileData = {
      "text": currentEditor.state.doc.toString(),
      "format_version": 1
  };

  await saveToFile(JSON.stringify(fileData), ".useq", "uSEQ Code");
}

// Local implementation of saveToFile using the File System Access API.
// toolbar.mjs no longer exists; this is the canonical save helper for this module.
async function saveToFile(fileContents: string, ext: string, desc: string) {
    async function getNewFileHandle(ext: string, desc: string): Promise<FileSystemFileHandle> {
        const options = {
            suggestedName: "untitled" + ext,
            types: [{
                description: desc,
                accept: {
                    'text/plain': ['.txt', ext],
                },
            }],
        };
        return window.showSaveFilePicker(options);
    }

    async function writeFile(fileHandle: FileSystemFileHandle, contents: string) {
        const writable = await fileHandle.createWritable();
        await writable.write(contents);
        await writable.close();
    }

    try {
      const filehandle = await getNewFileHandle(ext, desc);
      await writeFile(filehandle, fileContents);
    } catch (e) {
      console.error("Failed to save file", e instanceof Error ? e.message : String(e));
    }
}
