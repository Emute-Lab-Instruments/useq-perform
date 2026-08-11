import { onMount, onCleanup, For } from "solid-js";
import { EditorView, drawSelection } from "@codemirror/view";
import { EditorState, type Extension } from "@codemirror/state";
import { bracketMatching } from "@codemirror/language";
import { default_extensions as clojureExtensions } from "@nextjournal/clojure-mode";
import { themes, setMainEditorTheme } from "../../editors/themes.ts";
import { defaultThemeEditorStartingCode } from "../../lib/editorDefaults.ts";
import { settings as globalSettings, requestSettingsUpdate } from "../../utils/settingsStore";
import { hideChromePanel } from "../adapters/panels";
import type { AppSettings } from "../../lib/appSettings.ts";
import {
  createDocumentSession,
  type DocumentSession,
} from "../../editors/documentSession.ts";

export interface ThemeSettingsProps {
  settings?: AppSettings;
  onUpdateSettings?: (patch: Record<string, unknown>) => void;
  /** Side-effect: apply theme to the main editor. Defaults to setMainEditorTheme. */
  onApplyTheme?: (theme: string) => void;
  /** Side-effect: close the settings panel after selection. Defaults to hideChromePanel("settings"). */
  onClosePanel?: () => void;
}

/** Lightweight read-only extensions for theme preview cards. */
const previewBaseExtensions: Extension[] = [
  EditorView.theme({
    "&": { height: "auto" },
    ".cm-content": { fontSize: "13px", padding: "4px 0" },
    ".cm-scroller": { overflow: "hidden" },
    ".cm-gutters": { display: "none" },
    "&.cm-focused": { outline: "0 !important" },
    ".cm-line": { padding: "0 6px", lineHeight: "1.5" },
    ".cm-cursor": { display: "none" },
    ".cm-activeLine": { backgroundColor: "transparent" },
  }),
  bracketMatching(),
  drawSelection(),
  ...clojureExtensions,
  EditorState.readOnly.of(true),
];

function ThemePreview(props: {
  themeName: string;
  themeExtension: Extension;
  settings: () => AppSettings;
  onSelect: (theme: string) => void;
}) {
  let editorParent: HTMLDivElement | undefined;
  let documentSession: DocumentSession | undefined;

  onMount(() => {
    if (editorParent) {
      documentSession = createDocumentSession({
        initialText: defaultThemeEditorStartingCode,
        settings: props.settings(),
        repository: null,
        parent: editorParent,
        buildExtensions: ({ identityExtensions, sessionExtensions }) => [
          ...previewBaseExtensions,
          props.themeExtension,
          ...identityExtensions,
          ...sessionExtensions,
        ],
      });
    }
  });

  onCleanup(() => {
    documentSession?.dispose();
  });

  const isActive = () => props.settings().editor?.theme === props.themeName;

  return (
    <div class="theme-preview panel-section" classList={{ active: isActive() }} onClick={() => props.onSelect(props.themeName)}>
      <div class="theme-name">{props.themeName}</div>
      <div ref={editorParent} style={{ "max-height": "180px", overflow: "hidden", "border-radius": "4px" }} />
    </div>
  );
}

export function ThemeSettings(props: ThemeSettingsProps = {}) {
  const s = () => props.settings ?? globalSettings;
  const update = (patch: Record<string, unknown>) =>
    (props.onUpdateSettings ?? requestSettingsUpdate)(patch);
  const applyTheme = props.onApplyTheme ?? setMainEditorTheme;
  const closePanel = props.onClosePanel ?? (() => hideChromePanel("settings"));

  const handleSelect = (themeName: string) => {
    update({
      editor: {
        ...s().editor,
        theme: themeName,
      },
    });
    applyTheme(themeName);
    closePanel();
  };

  return (
    <div class="panel-tab-content themes-container" id="panel-settings-themes">
      <h2 class="panel-section-title">Select a Theme</h2>
      <For each={Object.entries(themes)}>
        {([themeName, themeExtension]) => (
          <ThemePreview
            themeName={themeName}
            themeExtension={themeExtension}
            settings={s}
            onSelect={handleSelect}
          />
        )}
      </For>
    </div>
  );
}
