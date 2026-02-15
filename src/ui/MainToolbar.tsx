import { createSignal, onMount, onCleanup, Show } from "solid-js";
import { Effect } from "effect";
import { toggleConnection, toggleGraph, togglePanel } from "../effects/ui";
import { adjustFontSize, loadCode, saveCode } from "../effects/editor";
// @ts-ignore
import { devmode } from "../legacy/urlParams.ts";
// @ts-ignore
import { isConnectedToModule } from "../legacy/io/serialComms.ts";

declare const lucide: any;

export function MainToolbar() {
  const [isConnected, setIsConnected] = createSignal(isConnectedToModule());
  let connectButtonRef: HTMLButtonElement | undefined;

  const handleConnectionChange = (e: Event) => {
    const detail = (e as CustomEvent).detail;
    if (detail && typeof detail.connected === "boolean") {
      setIsConnected(detail.connected);
    }
  };

  const handleAnimateConnect = () => {
    if (connectButtonRef) {
      connectButtonRef.animate([
        { transform: 'scale(1)' },
        { transform: 'scale(1.2)' },
        { transform: 'scale(1)' },
        { transform: 'rotate(-3deg)' },
        { transform: 'rotate(3deg)' },
        { transform: 'rotate(0deg)' }
      ], {
        duration: 700,
        easing: 'ease-in-out'
      });
    }
  };

  onMount(() => {
    window.addEventListener("useq-connection-changed", handleConnectionChange);
    window.addEventListener("useq-animate-connect", handleAnimateConnect);
    if (typeof lucide !== "undefined") {
      lucide.createIcons();
    }
  });

  onCleanup(() => {
    window.removeEventListener("useq-connection-changed", handleConnectionChange);
    window.removeEventListener("useq-animate-connect", handleAnimateConnect);
  });

  const run = (effect: Effect.Effect<any, any, any>) => Effect.runPromise(effect);

  return (
    <div id="panel-toolbar">
      <div class="toolbar-row">
        <button
          ref={connectButtonRef}
          class={`toolbar-button ${isConnected() ? 'connected' : 'disconnected'}`}
          title="Connect"
          aria-label="Connect"
          onClick={() => run(toggleConnection())}
        >
          <i data-lucide="cable"></i>
        </button>
        <button
          class="toolbar-button"
          title="Graph"
          aria-label="Graph"
          onClick={() => run(toggleGraph())}
        >
          <i data-lucide="chart-spline"></i>
        </button>
      </div>

      <div class="toolbar-row">
        <button
          class="toolbar-button"
          title="Load Code"
          aria-label="Load Code"
          onClick={() => run(loadCode())}
        >
          <i data-lucide="file"></i>
        </button>
        <button
          class="toolbar-button"
          title="Save Code"
          aria-label="Save Code"
          onClick={() => run(saveCode())}
        >
          <i data-lucide="save"></i>
        </button>
      </div>

      <div class="toolbar-row">
        <button
          class="toolbar-button"
          title="Font size--"
          aria-label="Font size--"
          onClick={() => run(adjustFontSize(-1))}
        >
          <i data-lucide="a-arrow-down"></i>
        </button>
        <button
          class="toolbar-button"
          title="Font size++"
          aria-label="Font size++"
          onClick={() => run(adjustFontSize(1))}
        >
          <i data-lucide="a-arrow-up"></i>
        </button>
      </div>

      <div class="toolbar-row">
        <button
          class="toolbar-button"
          title="Help!"
          aria-label="Help!"
          onClick={() => run(togglePanel("#panel-help"))}
        >
          <i data-lucide="circle-help"></i>
        </button>
        <button
          class="toolbar-button"
          title="Settings"
          aria-label="Settings"
          onClick={() => run(togglePanel("#panel-settings"))}
        >
          <i data-lucide="settings"></i>
        </button>
        <Show when={devmode}>
          <button
            class="toolbar-button"
            title="Dev Mode Tools"
            aria-label="Dev Mode Tools"
            onClick={() => run(togglePanel("#panel-devmode"))}
          >
            <i data-lucide="wrench"></i>
          </button>
        </Show>
      </div>
    </div>
  );
}
