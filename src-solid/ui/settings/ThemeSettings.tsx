import { onMount, onCleanup, For } from "solid-js";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { themes, setTheme, setMainEditorTheme } from "../../../src/editors/themes/themeManager.mjs";
import { baseExtensions } from "../../../src/editors/extensions.mjs";
import { defaultThemeEditorStartingCode } from "../../../src/editors/defaults.mjs";
import { settings, updateSettingsStore } from "../../utils/settingsStore";

function ThemePreview(props: { themeName: string; themeExtension: any }) {
  let editorParent: HTMLDivElement | undefined;
  let view: EditorView | undefined;

  onMount(() => {
    if (editorParent) {
      const state = EditorState.create({
        doc: defaultThemeEditorStartingCode,
        extensions: [...baseExtensions, props.themeExtension, EditorState.readOnly.of(true)],
      });

      view = new EditorView({
        state,
        parent: editorParent,
      });

      setTheme(view, props.themeName);
    }
  });

  onCleanup(() => {
    view?.destroy();
  });

  const handleClick = () => {
    updateSettingsStore({
      editor: {
        ...settings.editor,
        theme: props.themeName,
      },
    });
    setMainEditorTheme(props.themeName);
    
    // Close the settings panel if it's open (legacy compatibility)
    const settingsPanel = document.getElementById('panel-settings');
    if (settingsPanel && settingsPanel.style.display !== 'none') {
        $(settingsPanel).toggle();
    }
  };

  return (
    <div class="theme-preview panel-section" onClick={handleClick}>
      <div class="theme-name">{props.themeName}</div>
      <div ref={editorParent} />
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
