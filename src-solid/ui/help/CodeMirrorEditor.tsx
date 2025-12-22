import { Component, onMount, onCleanup } from "solid-js";
import { EditorView } from "@codemirror/view";
import { EditorState, Extension } from "@codemirror/state";
import { baseExtensions } from "../../../src/editors/extensions.mjs";
import { themes } from "../../../src/editors/themes/themeManager.mjs";
import { settings } from "../../utils/settingsStore";

interface CodeMirrorEditorProps {
  code: string;
  readOnly?: boolean;
  onCodeChange?: (code: string) => void;
  maxHeight?: string;
  minHeight?: string;
  fontSize?: string;
}

export const CodeMirrorEditor: Component<CodeMirrorEditorProps> = (props) => {
  let editorContainer: HTMLDivElement | undefined;
  let view: EditorView | undefined;

  onMount(() => {
    if (!editorContainer) return;

    const currentTheme = settings.editor?.theme || "oneDark";
    const themeExtension = (themes as any)[currentTheme] || (themes as any).oneDark;

    const extensions: Extension[] = [
      ...baseExtensions,
      themeExtension,
      EditorView.theme({
        ".cm-content": {
          fontSize: props.fontSize || "12px",
          minHeight: props.minHeight || "60px",
          maxHeight: props.maxHeight || "200px",
        },
        ".cm-scroller": {
          overflow: "auto",
        },
      }),
    ];

    if (props.readOnly) {
      extensions.push(EditorView.editable.of(false));
    }

    if (props.onCodeChange) {
      extensions.push(
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            props.onCodeChange!(update.state.doc.toString());
          }
        })
      );
    }

    const state = EditorState.create({
      doc: props.code,
      extensions,
    });

    view = new EditorView({
      state,
      parent: editorContainer,
    });
  });

  onCleanup(() => {
    if (view) {
      view.destroy();
    }
  });

  return <div ref={editorContainer} class="cm-editor-wrapper" />;
};
