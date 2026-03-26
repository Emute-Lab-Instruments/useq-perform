import { Tabs } from "../Tabs";
import { GeneralSettings } from "./GeneralSettings";
import { ThemeSettings } from "./ThemeSettings";
import { KeybindingsPanel } from "../keybindings/KeybindingsPanel";

export function SettingsPanel() {
  const tabs = [
    {
      id: "general-settings-tab",
      name: "General",
      content: () => <GeneralSettings />,
    },
    {
      id: "theme-settings-tab",
      name: "Themes",
      content: () => <ThemeSettings />,
    },
    {
      id: "keybindings-settings-tab",
      name: "Keybindings",
      content: () => <KeybindingsPanel />,
    },
  ];

  return (
    <div class="settings-panel-container">
      <Tabs tabs={tabs} />
    </div>
  );
}
