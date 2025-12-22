import { createSignal, onMount, onCleanup, Show } from "solid-js";
import { Effect } from "effect";
import { toggleConnection, toggleGraph, togglePanel } from "../effects/ui";
import { adjustFontSize, loadCode, saveCode } from "../effects/editor";
// @ts-ignore
import { devmode } from "../../src/urlParams.mjs";
// @ts-ignore
import { isConnectedToModule } from "../../src/io/serialComms.mjs";

declare const lucide: any;

export function MainToolbar() {
  const [isConnected, setIsConnected] = createSignal(isConnectedToModule());

  const handleConnectionChange = (e: Event) => {
    const detail = (e as CustomEvent).detail;
    if (detail && typeof detail.connected === "boolean") {
      setIsConnected(detail.connected);
    }
  };

  onMount(() => {
    window.addEventListener("useq-connection-changed", handleConnectionChange);
    if (typeof lucide !== "undefined") {
      lucide.createIcons();
    }
  });

  onCleanup(() => {
    window.removeEventListener("useq-connection-changed", handleConnectionChange);
  });

  const run = (effect: Effect.Effect<any, any, any>) => Effect.runPromise(effect);

  return (
    <div id="panel-toolbar">
      <div class="toolbar-row">
        <a 
          class={`toolbar-button ${isConnected() ? 'connected' : 'disconnected'}`} 
          id="button-connect" 
          title="Connect"
          onClick={() => run(toggleConnection())}
        >
          <i data-lucide="cable"></i>
        </a>
        <a 
          class="toolbar-button" 
          id="button-graph" 
          title="Graph"
          onClick={() => run(toggleGraph())}
        >
          <i data-lucide="chart-spline"></i>
        </a>
      </div>
      
      <div class="toolbar-row">
        <a 
          class="toolbar-button" 
          id="button-load" 
          title="Load Code"
          onClick={() => run(loadCode())}
        >
          <i data-lucide="file"></i>
        </a>
        <a 
          class="toolbar-button" 
          id="button-save" 
          title="Save Code"
          onClick={() => run(saveCode())}
        >
          <i data-lucide="save"></i>
        </a>
      </div>
      
      <div class="toolbar-row">
        <a 
          class="toolbar-button" 
          id="button-decrease-font" 
          title="Font size--"
          onClick={() => run(adjustFontSize(-1))}
        >
          <i data-lucide="a-arrow-down"></i>
        </a>
        <a 
          class="toolbar-button" 
          id="button-increase-font" 
          title="Font size++"
          onClick={() => run(adjustFontSize(1))}
        >
          <i data-lucide="a-arrow-up"></i>
        </a>
      </div>
      
      <div class="toolbar-row">
        <a 
          class="toolbar-button" 
          id="button-help" 
          title="Help!"
          onClick={() => run(togglePanel("#panel-help"))}
        >
          <i data-lucide="circle-help"></i>
        </a>
        <a 
          class="toolbar-button" 
          id="button-settings" 
          title="Settings"
          onClick={() => run(togglePanel("#panel-settings"))}
        >
          <i data-lucide="settings"></i>
        </a>
        <Show when={devmode}>
          <a 
            class="toolbar-button" 
            id="button-devmode" 
            title="Dev Mode Tools"
            onClick={() => run(togglePanel("#panel-devmode"))}
          >
            <i data-lucide="wrench"></i>
          </a>
        </Show>
      </div>
    </div>
  );
}
