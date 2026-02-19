// src/effects/editor.ts
import { Effect } from "effect";
import { editor } from "../lib/editorStore";
// @ts-ignore - Importing from legacy untyped module
import { saveUserSettings, activeUserSettings } from "../legacy/utils/persistentUserSettings.ts";
// @ts-ignore - Importing from legacy untyped module
import { setFontSize } from "../legacy/editors/editorConfig.ts";

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

export const adjustFontSize = (delta: number) =>
  Effect.sync(() => {
    const currentEditor = editor();
    if (!currentEditor) return;

    activeUserSettings.editor.fontSize += delta;
    setFontSize(currentEditor, activeUserSettings.editor.fontSize);
    saveUserSettings();
  });

export const loadCode = () =>
  Effect.promise(async () => {
    const currentEditor = editor();
    if (!currentEditor) return;

    try {
      const [fileHandle] = await window.showOpenFilePicker();
      const file = await fileHandle.getFile();
      const contents = await file.text();
      const data = JSON.parse(contents) as Record<string, unknown>;

      const transactionSpec = {
        changes: { from: 0, to: currentEditor.state.doc.length, insert: String(data['text'] ?? '') }
      };
      const transaction = currentEditor.state.update(transactionSpec);
      currentEditor.dispatch(transaction);
    } catch (e) {
      console.error("Failed to load file", e instanceof Error ? e.message : String(e));
    }
  });

export const saveCode = () =>
  Effect.promise(async () => {
    const currentEditor = editor();
    if (!currentEditor) return;

    const fileData = {
        "text": currentEditor.state.doc.toString(),
        "format_version": 1
    };

    await saveToFile(JSON.stringify(fileData), ".useq", "uSEQ Code");
  });

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
