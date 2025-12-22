import { Tabs, Tab } from "../Tabs";
import { KeybindingsTab } from "./KeybindingsTab";
import { CodeSnippetsTab } from "./CodeSnippetsTab";
import { ModuLispReferenceTab } from "./ModuLispReferenceTab";
import { UserGuideTab } from "./UserGuideTab";

export function HelpPanel() {
  const tabs: Tab[] = [
    {
      id: "panel-help-tab-guide",
      name: "User Guide",
      content: <UserGuideTab />,
    },
    {
      id: "panel-help-tab-reference",
      name: "ModuLisp Reference",
      content: <ModuLispReferenceTab />,
    },
    {
      id: "panel-help-tab-snippets",
      name: "Code Snippets",
      content: <CodeSnippetsTab />,
    },
    {
      id: "panel-settings-tab-keybindings",
      name: "Keybindings",
      content: <KeybindingsTab />,
    },
  ];

  return (
    <div id="panel-help" class="panel help-panel">
      <Tabs tabs={tabs} />
    </div>
  );
}
