import { Tabs, Tab } from "../Tabs";
import { CodeSnippetsTab } from "./CodeSnippetsTab";
import { GuideTab } from "./guide/GuideTab";
import { ReferencePanel } from "./ReferencePanel";
import { helpTabSwitchChannel } from "./helpChannels";

export interface HelpPanelProps {
  /** Override the default tabs. When omitted, renders the full app tabs. */
  tabs?: Tab[];
}

function defaultTabs(): Tab[] {
  return [
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
}

export function HelpPanel(props: HelpPanelProps = {}) {
  const tabs = props.tabs ?? defaultTabs();

  return (
    <div class="panel help-panel">
      <Tabs tabs={tabs} switchChannel={helpTabSwitchChannel} />
    </div>
  );
}
