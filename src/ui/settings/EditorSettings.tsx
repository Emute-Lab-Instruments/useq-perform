import { settings, updateSettingsStore } from "../../utils/settingsStore";
import { Section, FormRow, Select, NumberInput, Checkbox } from "./FormControls";
import { themes, setMainEditorTheme } from "../../legacy/editors/themes/themeManager.ts";
import { editor, applyEditorFontSize } from "../../lib/editorStore";

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

      const currentEditor = editor();
      if (currentEditor) {
        applyEditorFontSize(currentEditor, fontSize);
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
          value={settings.editor?.theme || "uSEQ Dark"}
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
