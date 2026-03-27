import { settings as globalSettings, updateSettingsStore } from "../../utils/settingsStore";
import { Section, FormRow, Select, NumberInput, Checkbox } from "./FormControls";
import { themes, setMainEditorTheme } from "../../editors/themes.ts";
import { editor, applyEditorFontSize } from "../../lib/editorStore";
import type { AppSettings } from "../../lib/appSettings.ts";

export interface EditorSettingsProps {
  settings?: AppSettings;
  onUpdateSettings?: (patch: Record<string, unknown>) => void;
  /** Theme names to populate the dropdown. Defaults to the app's built-in themes. */
  themeNames?: string[];
  /** Side-effect: apply theme to the main editor. Defaults to setMainEditorTheme. */
  onApplyTheme?: (theme: string) => void;
  /** Side-effect: apply font size to the main editor. Defaults to applyEditorFontSize. */
  onApplyFontSize?: (fontSize: number) => void;
}

export function EditorSettings(props: EditorSettingsProps = {}) {
  const s = () => props.settings ?? globalSettings;
  const update = (patch: Record<string, unknown>) =>
    (props.onUpdateSettings ?? updateSettingsStore)(patch);

  const themeOptions = () =>
    (props.themeNames ?? Object.keys(themes)).map((themeName) => ({
      value: themeName,
      label: themeName,
    }));

  const handleThemeChange = (theme: string) => {
    update({
      editor: {
        ...s().editor,
        theme,
      },
    });
    (props.onApplyTheme ?? setMainEditorTheme)(theme);
  };

  const handleFontSizeChange = (fontSize: number) => {
    if (fontSize >= 8 && fontSize <= 32) {
      update({
        editor: {
          ...s().editor,
          fontSize,
        },
      });

      if (props.onApplyFontSize) {
        props.onApplyFontSize(fontSize);
      } else {
        const currentEditor = editor();
        if (currentEditor) {
          applyEditorFontSize(currentEditor, fontSize);
        }
      }
    }
  };

  const handleBracketUnbalancingChange = (preventBracketUnbalancing: boolean) => {
    update({
      editor: {
        ...s().editor,
        preventBracketUnbalancing,
      },
    });
  };

  return (
    <Section title="Editor Settings">
      <FormRow label="Editor Theme">
        <Select
          value={s().editor?.theme || "uSEQ Dark"}
          options={themeOptions()}
          onChange={handleThemeChange}
        />
      </FormRow>
      <FormRow label="Font Size">
        <NumberInput
          value={s().editor?.fontSize || 16}
          min={8}
          max={32}
          onChange={handleFontSizeChange}
        />
      </FormRow>
      <FormRow label="Prevent bracket unbalancing">
        <Checkbox
          checked={s().editor?.preventBracketUnbalancing ?? true}
          onChange={handleBracketUnbalancingChange}
        />
      </FormRow>
    </Section>
  );
}
