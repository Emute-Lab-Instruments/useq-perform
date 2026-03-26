import { Component, onMount, onCleanup } from "solid-js";
import { EditorView } from "@codemirror/view";
import { EditorState, Extension } from "@codemirror/state";
import { baseExtensions, readOnlyExtensions, guideEditorExtensions } from "../../editors/extensions.ts";
import { themes } from "../../editors/themes.ts";
import { settings } from "../../utils/settingsStore";

interface CodeMirrorEditorProps {
  code: string;
  readOnly?: boolean;
  /** Use lightweight extensions (no probes/eval tracking). For guide playgrounds. */
  lightweight?: boolean;
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
    // themes is imported from a legacy @ts-nocheck module with no exported type.
    // Treat it as a name-keyed record of CodeMirror Extension values.
    const themesRecord = themes as Record<string, Extension>;
    const themeExtension = themesRecord[currentTheme] ?? themesRecord["oneDark"];

    const base = props.readOnly
      ? readOnlyExtensions
      : props.lightweight
        ? guideEditorExtensions
        : baseExtensions;
    const extensions: Extension[] = [
      ...base,
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
