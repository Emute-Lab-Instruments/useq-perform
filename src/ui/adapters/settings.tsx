/**
 * Settings adapters - Wired wrappers that read from the global settings store
 * and pass data + callbacks as props to pure settings sub-panel components.
 *
 * Each WiredXxx component connects the corresponding sub-panel to the real
 * application globals (settings store, runtimeService, editor themes, etc.)
 * so the sub-panels themselves remain renderable in isolation.
 */
import { settings, requestSettingsUpdate } from "../../utils/settingsStore";
import {
  resetSettings,
} from "../../runtime/runtimeService";
import { themes, setMainEditorTheme } from "../../editors/themes";
import { editor, applyEditorFontSize } from "../../lib/editorStore";
import { hideChromePanel } from "./panels";

import { GeneralSettings } from "../settings/GeneralSettings";
import { PersonalSettings } from "../settings/PersonalSettings";
import { EditorSettings } from "../settings/EditorSettings";
import { EvalResultsSettings } from "../settings/EvalResultsSettings";
import { StorageSettings } from "../settings/StorageSettings";
import { UISettings } from "../settings/UISettings";
import { ThemeSettings } from "../settings/ThemeSettings";

// ── Wired sub-panel components ─────────────────────────────────────

export function WiredPersonalSettings() {
  return (
    <PersonalSettings
      settings={settings}
      onUpdateSettings={requestSettingsUpdate}
    />
  );
}

export function WiredEditorSettings() {
  return (
    <EditorSettings
      settings={settings}
      onUpdateSettings={requestSettingsUpdate}
      themeNames={Object.keys(themes)}
      onApplyTheme={setMainEditorTheme}
      onApplyFontSize={(fontSize) => {
        const currentEditor = editor();
        if (currentEditor) {
          applyEditorFontSize(currentEditor, fontSize);
        }
      }}
    />
  );
}

export function WiredEvalResultsSettings() {
  return (
    <EvalResultsSettings
      settings={settings}
      onUpdateSettings={requestSettingsUpdate}
    />
  );
}

export function WiredStorageSettings() {
  return (
    <StorageSettings
      settings={settings}
      onUpdateSettings={requestSettingsUpdate}
    />
  );
}

export function WiredUISettings() {
  return (
    <UISettings
      settings={settings}
      onUpdateSettings={requestSettingsUpdate}
    />
  );
}

export function WiredThemeSettings() {
  return (
    <ThemeSettings
      settings={settings}
      onUpdateSettings={requestSettingsUpdate}
      onApplyTheme={setMainEditorTheme}
      onClosePanel={() => hideChromePanel("settings")}
    />
  );
}

export function WiredGeneralSettings() {
  return (
    <GeneralSettings
      settings={settings}
      onUpdateSettings={requestSettingsUpdate}
      onResetSettings={resetSettings}
      onReload={() => window.location.reload()}
    />
  );
}
