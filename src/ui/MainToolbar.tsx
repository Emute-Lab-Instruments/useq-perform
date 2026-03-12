import { createSignal, onMount, onCleanup } from "solid-js";
import { Effect } from "effect";
import { toggleConnection, toggleGraph, togglePanel } from "../effects/ui";
import { adjustFontSize, loadCode, saveCode } from "../effects/editor";
// @ts-ignore - Importing from legacy untyped module
import { isConnectedToModule } from "../legacy/io/serialComms.ts";
import { getRuntimeSessionSnapshot } from "../effects/transport";
import { Cable, ChartSpline, File, Save, AArrowDown, AArrowUp, CircleHelp, Settings } from "lucide-solid";

export function MainToolbar() {
  const initialSession = getRuntimeSessionSnapshot();
  const [isConnected, setIsConnected] = createSignal(isConnectedToModule());
  const [connectionMode, setConnectionMode] = createSignal(initialSession.connectionMode);
  const [transportMode, setTransportMode] = createSignal(initialSession.transportMode);
  let connectButtonRef: HTMLButtonElement | undefined;

  const handleConnectionChange = (e: Event) => {
    const detail = (e as CustomEvent).detail;
    if (detail && typeof detail.connected === "boolean") {
      setIsConnected(detail.connected);
    }
    if (detail?.connectionMode) {
      setConnectionMode(detail.connectionMode);
    }
    if (detail?.transportMode) {
      setTransportMode(detail.transportMode);
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
  });

  onCleanup(() => {
    window.removeEventListener("useq-connection-changed", handleConnectionChange);
    window.removeEventListener("useq-animate-connect", handleAnimateConnect);
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const run = <A, E>(effect: Effect.Effect<A, E, never>) => Effect.runPromise(effect);
  const runtimeStatus = () => {
    if (connectionMode() === "hardware") {
      return transportMode() === "both" ? "Hardware + WASM" : "Hardware";
    }

    if (connectionMode() === "browser") {
      return "Browser-local";
    }

    return "Disconnected";
  };

  const connectButtonClass = () =>
    `toolbar-button ${isConnected() ? "connected" : "disconnected"} runtime-${connectionMode()}`;

  return (
    <div id="panel-toolbar">
      <div class="toolbar-row">
        <button
          ref={connectButtonRef}
          class={connectButtonClass()}
          title={`Connect (${runtimeStatus()})`}
          aria-label={`Connect (${runtimeStatus()})`}
          onClick={() => run(toggleConnection())}
        >
          <Cable />
        </button>
        <span class={`toolbar-runtime-pill runtime-${connectionMode()}`}>
          {runtimeStatus()}
        </span>
        <button
          class="toolbar-button"
          title="Graph"
          aria-label="Graph"
          onClick={() => run(toggleGraph())}
        >
          <ChartSpline />
        </button>
      </div>

      <div class="toolbar-row">
        <button
          class="toolbar-button"
          title="Load Code"
          aria-label="Load Code"
          onClick={() => run(loadCode())}
        >
          <File />
        </button>
        <button
          class="toolbar-button"
          title="Save Code"
          aria-label="Save Code"
          onClick={() => run(saveCode())}
        >
          <Save />
        </button>
      </div>

      <div class="toolbar-row">
        <button
          class="toolbar-button"
          title="Font size--"
          aria-label="Font size--"
          onClick={() => run(adjustFontSize(-1))}
        >
          <AArrowDown />
        </button>
        <button
          class="toolbar-button"
          title="Font size++"
          aria-label="Font size++"
          onClick={() => run(adjustFontSize(1))}
        >
          <AArrowUp />
        </button>
      </div>

      <div class="toolbar-row">
        <button
          class="toolbar-button"
          title="Help!"
          aria-label="Help!"
          onClick={() => run(togglePanel("#panel-help"))}
        >
          <CircleHelp />
        </button>
        <button
          class="toolbar-button"
          title="Settings"
          aria-label="Settings"
          onClick={() => run(togglePanel("#panel-settings"))}
        >
          <Settings />
        </button>
      </div>
    </div>
  );
}
