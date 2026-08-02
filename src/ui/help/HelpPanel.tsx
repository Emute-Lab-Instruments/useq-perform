import { Tabs, Tab } from "../Tabs";
import { CodeSnippetsTab } from "./CodeSnippetsTab";
import { GuideTab } from "./guide/GuideTab";
import { ReferencePanel } from "./ReferencePanel";
import { LedgerTab } from "./ledger/LedgerTab";
import { helpTabSwitchChannel } from "./helpChannels";
import { isDevmode } from "../settings/devmodeContext";

export interface HelpPanelProps {
  /** Override the default tabs. When omitted, renders the full app tabs. */
  tabs?: Tab[];
}

export const LEDGER_TAB_ID = "panel-help-tab-ledger";

function defaultTabs(): Tab[] {
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

  // engine-ledger.md §1.3 / §5.1 — the Ledger tab exists only in devmode.
  // Devmode off must leave no trace of it: the tab is not appended at all,
  // so there is no hidden button and `LedgerTab` is never constructed.
  if (isDevmode()) {
    tabs.push({
      id: LEDGER_TAB_ID,
      name: "Engine Ledger",
      content: () => <LedgerTab />,
    });
  }

  return tabs;
}

export function HelpPanel(props: HelpPanelProps = {}) {
  const tabs = props.tabs ?? defaultTabs();

  return (
    <div class="panel help-panel">
      <Tabs tabs={tabs} switchChannel={helpTabSwitchChannel} />
    </div>
  );
}
