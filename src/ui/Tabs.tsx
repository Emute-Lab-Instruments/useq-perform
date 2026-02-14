import { createSignal, For, JSX } from "solid-js";

export interface Tab {
  id: string;
  name: string;
  content: JSX.Element;
}

export interface TabsProps {
  tabs: Tab[];
  initialTabId?: string;
}

export function Tabs(props: TabsProps) {
  const [activeTabId, setActiveTabId] = createSignal(
    props.initialTabId || (props.tabs.length > 0 ? props.tabs[0].id : "")
  );

  return (
    <div class="panel-tab-container">
      <div class="panel-nav-bar">
        <For each={props.tabs}>
          {(tab) => (
            <button
              class="panel-tab-button"
              classList={{ active: activeTabId() === tab.id }}
              id={`${tab.id}-button`}
              onClick={() => setActiveTabId(tab.id)}
            >
              {tab.name}
            </button>
          )}
        </For>
      </div>
      <div class="panel-tab-window">
        <For each={props.tabs}>
          {(tab) => (
            <div
              class="panel-tab"
              classList={{ active: activeTabId() === tab.id }}
              id={tab.id}
            >
              {tab.content}
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
