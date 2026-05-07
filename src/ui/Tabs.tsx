import { createSignal, createEffect, For, Show, JSX, onMount, onCleanup } from "solid-js";
import type { TypedChannel } from "../lib/typedChannel";

export interface Tab {
  id: string;
  name: string;
  /** Render function called lazily the first time the tab becomes active. */
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

  // Track which tabs have ever been activated. Inactive tabs render nothing
  // until first viewed; once mounted they stay in the DOM (hidden via display)
  // so tab switches preserve scroll/search/expand state cheaply.
  const initialId =
    props.activeTabId ?? props.initialTabId ?? (props.tabs.length > 0 ? props.tabs[0].id : "");
  const [activatedTabs, setActivatedTabs] = createSignal<Set<string>>(
    new Set(initialId ? [initialId] : []),
  );

  createEffect(() => {
    const id = activeTabId();
    if (!id) return;
    const current = activatedTabs();
    if (current.has(id)) return;
    const next = new Set(current);
    next.add(id);
    setActivatedTabs(next);
  });

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
              <Show when={activatedTabs().has(tab.id)}>
                {tab.content()}
              </Show>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
