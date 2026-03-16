import { createSignal, For, Show, JSX, onMount, onCleanup } from "solid-js";
import type { TypedChannel } from "../lib/typedChannel";

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
  /** Typed channel for external tab switches (replaces window event coupling). */
  switchChannel?: TypedChannel<{ tabId: string }>;
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

  onMount(() => {
    if (props.switchChannel) {
      const unsub = props.switchChannel.subscribe(({ tabId }) => {
        if (tabId && props.tabs.some(t => t.id === tabId)) {
          setActiveTabId(tabId);
        }
      });
      onCleanup(unsub);
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
