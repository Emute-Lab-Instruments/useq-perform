import { settings, updateSettingsStore } from "../../utils/settingsStore";
import { Section, FormRow, Select, NumberInput, Checkbox } from "./shared";
import { themes, setMainEditorTheme } from "../../../src/editors/themes/themeManager.mjs";
import { setFontSize } from "../../../src/editors/editorConfig.mjs";
import { EditorView } from "@codemirror/view";

export function EditorSettings() {
  const themeOptions = () =>
    Object.keys(themes).map((themeName) => ({
      value: themeName,
      label: themeName,
    }));

  const handleThemeChange = (theme: string) => {
    updateSettingsStore({
      editor: {
        ...settings.editor,
        theme,
      },
    });
    setMainEditorTheme(theme);
  };

  const handleFontSizeChange = (fontSize: number) => {
    if (fontSize >= 8 && fontSize <= 32) {
      updateSettingsStore({
        editor: {
          ...settings.editor,
          fontSize,
        },
      });
      const editorEl = document.querySelector("#panel-main-editor .cm-editor");
      if (editorEl) {
        try {
          const editor = EditorView.findFromDOM(editorEl);
          if (editor) {
            setFontSize(editor, fontSize);
          }
        } catch (e) {
          console.error("Failed to find EditorView from DOM", e);
        }
      }
    }
  };

  const handleBracketUnbalancingChange = (preventBracketUnbalancing: boolean) => {
    updateSettingsStore({
      editor: {
        ...settings.editor,
        preventBracketUnbalancing,
      },
    });
  };

  return (
    <Section title="Editor Settings">
      <FormRow label="Editor Theme">
        <Select
          value={settings.editor?.theme || "default"}
          options={themeOptions()}
          onChange={handleThemeChange}
        />
      </FormRow>
      <FormRow label="Font Size">
        <NumberInput
          value={settings.editor?.fontSize || 16}
          min={8}
          max={32}
          onChange={handleFontSizeChange}
        />
      </FormRow>
      <FormRow label="Prevent bracket unbalancing">
        <Checkbox
          checked={settings.editor?.preventBracketUnbalancing ?? true}
          onChange={handleBracketUnbalancingChange}
        />
      </FormRow>
    </Section>
  );
}
