import { onMount, onCleanup, For } from "solid-js";
import { EditorView, drawSelection } from "@codemirror/view";
import { EditorState, type Extension } from "@codemirror/state";
import { bracketMatching } from "@codemirror/language";
import { default_extensions as clojureExtensions } from "@nextjournal/clojure-mode";
import { themes, setMainEditorTheme } from "../../editors/themes.ts";
import { defaultThemeEditorStartingCode } from "../../lib/editorDefaults.ts";
import { settings, updateSettingsStore } from "../../utils/settingsStore";
import { hideChromePanel } from "../adapters/panelControls";

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

function ThemePreview(props: { themeName: string; themeExtension: Extension }) {
  let editorParent: HTMLDivElement | undefined;
  let view: EditorView | undefined;

  onMount(() => {
    if (editorParent) {
      const state = EditorState.create({
        doc: defaultThemeEditorStartingCode,
        extensions: [...previewBaseExtensions, props.themeExtension],
      });

      view = new EditorView({
        state,
        parent: editorParent,
      });
    }
  });

  onCleanup(() => {
    view?.destroy();
  });

  const isActive = () => settings.editor?.theme === props.themeName;

  const handleClick = () => {
    updateSettingsStore({
      editor: {
        ...settings.editor,
        theme: props.themeName,
      },
    });
    setMainEditorTheme(props.themeName);

    // Close the settings panel using adapter API
    hideChromePanel("settings");
  };

  return (
    <div class="theme-preview panel-section" classList={{ active: isActive() }} onClick={handleClick}>
      <div class="theme-name">{props.themeName}</div>
      <div ref={editorParent} style={{ "max-height": "180px", overflow: "hidden", "border-radius": "4px" }} />
    </div>
  );
}

export function ThemeSettings() {
  return (
    <div class="panel-tab-content themes-container" id="panel-settings-themes">
      <h2 class="panel-section-title">Select a Theme</h2>
      <For each={Object.entries(themes)}>
        {([themeName, themeExtension]) => (
          <ThemePreview themeName={themeName} themeExtension={themeExtension} />
        )}
      </For>
    </div>
  );
}
