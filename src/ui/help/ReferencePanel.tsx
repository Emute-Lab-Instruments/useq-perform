import { Tabs, Tab } from "../Tabs";
import { ModuLispReferenceTab } from "./ModuLispReferenceTab";
import { KeybindingsTab } from "./KeybindingsTab";

export function ReferencePanel() {
  const tabs: Tab[] = [
    {
      id: "ref-sub-tab-language",
      name: "Language",
      content: () => <ModuLispReferenceTab />,
    },
    {
      id: "ref-sub-tab-editor",
      name: "Editor",
      content: () => <KeybindingsTab />,
    },
  ];

  return <Tabs tabs={tabs} />;
}
