import { Tabs, Tab } from "../Tabs";
import { CodeSnippetsTab } from "./CodeSnippetsTab";
import { GuideTab } from "./guide/GuideTab";
import { ReferencePanel } from "./ReferencePanel";
import { helpTabSwitchChannel } from "./helpChannels";

export function HelpPanel() {
  const tabs: Tab[] = [
    {
      id: "panel-help-tab-guide-v2",
      name: "Guide",
      content: () => <GuideTab />,
    },
    {
      id: "panel-help-tab-reference",
      name: "Reference",
      content: () => <ReferencePanel />,
    },
    {
      id: "panel-help-tab-snippets",
      name: "Code Snippets",
      content: () => <CodeSnippetsTab />,
    },
  ];

  return (
    <div class="panel help-panel">
      <Tabs tabs={tabs} switchChannel={helpTabSwitchChannel} />
    </div>
  );
}
