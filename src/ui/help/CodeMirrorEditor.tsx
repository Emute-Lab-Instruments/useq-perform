import { Component, onMount, onCleanup } from "solid-js";
import { EditorView } from "@codemirror/view";
import { Extension } from "@codemirror/state";
import {
  baseExtensions,
  readOnlyExtensions,
  snippetReadOnlyExtensions,
  guideEditorExtensions,
} from "../../editors/extensions.ts";
import { themes } from "../../editors/themes.ts";
import { defaultTheme } from "../../lib/editorDefaults.ts";
import { settings } from "../../utils/settingsStore";
import {
  createDocumentSession,
  type DocumentSession,
} from "../../editors/documentSession.ts";
import { getAppSettings } from "../../runtime/appSettingsRepository.ts";

interface CodeMirrorEditorProps {
  code: string;
  readOnly?: boolean;
  /** Use lightweight extensions (no probes/eval tracking). For guide playgrounds. */
  lightweight?: boolean;
  /**
   * In read-only mode, include the probe extension so indexed-form snippets
   * (from-list / seq / gates / trigs) get the same live active-element
   * highlight as the main editor. Ignored when `readOnly` is false.
   */
  enableProbes?: boolean;
  onCodeChange?: (code: string) => void;
  maxHeight?: string;
  minHeight?: string;
  fontSize?: string;
}

export const CodeMirrorEditor: Component<CodeMirrorEditorProps> = (props) => {
  let editorContainer: HTMLDivElement | undefined;
  let documentSession: DocumentSession | undefined;

  onMount(() => {
    if (!editorContainer) return;

    const currentTheme = settings.editor?.theme || defaultTheme;
    // themes is imported from a legacy @ts-nocheck module with no exported type.
    // Treat it as a name-keyed record of CodeMirror Extension values.
    const themesRecord = themes as Record<string, Extension>;
    const themeExtension =
      themesRecord[currentTheme] ?? themesRecord[defaultTheme];

    const base = props.readOnly
      ? props.enableProbes
        ? snippetReadOnlyExtensions
        : readOnlyExtensions
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

    documentSession = createDocumentSession({
      initialText: props.code,
      settings: getAppSettings(),
      repository: null,
      parent: editorContainer,
      buildExtensions: ({ identityExtensions, sessionExtensions }) => [
        ...extensions,
        ...identityExtensions,
        ...sessionExtensions,
      ],
    });
  });

  onCleanup(() => {
    documentSession?.dispose();
  });

  return <div ref={editorContainer} class="cm-editor-wrapper" />;
};
