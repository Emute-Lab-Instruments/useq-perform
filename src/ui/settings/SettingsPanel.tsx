import { Tabs } from "../Tabs";
import { GeneralSettings } from "./GeneralSettings";
import { ThemeSettings } from "./ThemeSettings";

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
  ];

  return (
    <div class="settings-panel-container">
      <Tabs tabs={tabs} />
    </div>
  );
}
