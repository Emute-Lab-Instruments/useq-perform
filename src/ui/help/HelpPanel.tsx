import { Tabs, Tab } from "../Tabs";
import { KeybindingsTab } from "./KeybindingsTab";
import { CodeSnippetsTab } from "./CodeSnippetsTab";
import { ModuLispReferenceTab } from "./ModuLispReferenceTab";
import { UserGuideTab } from "./UserGuideTab";
import { helpTabSwitchChannel } from "./helpChannels";

export function HelpPanel() {
  const tabs: Tab[] = [
    {
      id: "panel-help-tab-guide",
      name: "User Guide",
      content: () => <UserGuideTab />,
    },
    {
      id: "panel-help-tab-reference",
      name: "ModuLisp Reference",
      content: () => <ModuLispReferenceTab />,
    },
    {
      id: "panel-help-tab-snippets",
      name: "Code Snippets",
      content: () => <CodeSnippetsTab />,
    },
    {
      id: "panel-help-tab-keybindings",
      name: "Keybindings",
      content: () => <KeybindingsTab />,
    },
  ];

  return (
    <div class="panel help-panel">
      <Tabs tabs={tabs} switchChannel={helpTabSwitchChannel} />
    </div>
  );
}
