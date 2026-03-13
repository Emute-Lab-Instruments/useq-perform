import { createSignal, For, Show, JSX, onMount, onCleanup } from "solid-js";

export interface Tab {
  id: string;
  name: string;
  /** Render function called lazily when the tab becomes active. */
  content: () => JSX.Element;
}

export interface TabsProps {
  tabs: Tab[];
  initialTabId?: string;
  /** External control of active tab - overrides internal state when set */
  activeTabId?: string;
  /** Called when the active tab changes */
  onTabChange?: (tabId: string) => void;
  /** Event type to listen for external tab switches (e.g., "useq-switch-tab") */
  externalSwitchEvent?: string;
}

export function Tabs(props: TabsProps) {
  const [internalActiveTabId, setInternalActiveTabId] = createSignal(
    props.initialTabId || (props.tabs.length > 0 ? props.tabs[0].id : "")
  );

  // Use external activeTabId if provided, otherwise use internal state
  const activeTabId = () => props.activeTabId ?? internalActiveTabId();
  const setActiveTabId = (id: string) => {
    setInternalActiveTabId(id);
    props.onTabChange?.(id);
  };

  // Handle external tab switch events
  const handleExternalSwitch = (e: Event) => {
    const detail = (e as CustomEvent).detail;
    if (detail?.tabId && props.tabs.some(t => t.id === detail.tabId)) {
      setActiveTabId(detail.tabId);
    }
  };

  onMount(() => {
    if (props.externalSwitchEvent) {
      window.addEventListener(props.externalSwitchEvent, handleExternalSwitch);
    }
  });

  onCleanup(() => {
    if (props.externalSwitchEvent) {
      window.removeEventListener(props.externalSwitchEvent, handleExternalSwitch);
    }
  });

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
              style={{ display: activeTabId() === tab.id ? "" : "none" }}
            >
              {tab.content()}
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
