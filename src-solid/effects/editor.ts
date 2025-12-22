// src-solid/effects/editor.ts
import { Effect } from "effect";
import { editor } from "../lib/editorStore";
// @ts-ignore
import { saveUserSettings, activeUserSettings } from "../../src/utils/persistentUserSettings.mjs";
// @ts-ignore
import { setFontSize } from "../../src/editors/editorConfig.mjs";

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
      // @ts-ignore
      let [fileHandle] = await window.showOpenFilePicker();
      const file = await fileHandle.getFile();
      const contents = await file.text();
      const data = JSON.parse(contents);
      
      const transactionSpec = { 
        changes: { from: 0, to: currentEditor.state.doc.length, insert: data['text'] } 
      };
      const transaction = currentEditor.state.update(transactionSpec);
      currentEditor.dispatch(transaction);
    } catch (e) {
      console.error("Failed to load file", e);
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
    
    // @ts-ignore
    await saveToFile(JSON.stringify(fileData), ".useq", "uSEQ Code");
  });

// Re-implementing saveToFile since it's not exported from toolbar.mjs
async function saveToFile(fileContents: string, ext: string, desc: string) {
    async function getNewFileHandle(ext: string, desc: string) {
        const options = {
            suggestedName: "untitled" + ext,
            types: [{
                description: desc,
                accept: {
                    'text/plain': ['.txt', ext],
                },
            }],
        };
        // @ts-ignore
        const handle = await window.showSaveFilePicker(options);
        return handle;
    }
    
    async function writeFile(fileHandle: any, contents: string) {
        const writable = await fileHandle.createWritable();
        await writable.write(contents);
        await writable.close();
    }
    
    try {
      const filehandle = await getNewFileHandle(ext, desc);
      await writeFile(filehandle, fileContents);
    } catch (e) {
      console.error("Failed to save file", e);
    }
}
