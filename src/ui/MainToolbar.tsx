import { onMount } from "solid-js";
import { Cable, ChartSpline, File, Save, AArrowDown, AArrowUp, CircleHelp, Settings } from "lucide-solid";

export type ConnectionState = 'none' | 'wasm' | 'hardware' | 'both';

export interface MainToolbarProps {
  connectionState: ConnectionState;
  onConnect: () => void;
  onToggleGraph: () => void;
  onLoadCode: () => void;
  onSaveCode: () => void;
  onFontSizeUp: () => void;
  onFontSizeDown: () => void;
  onSettings: () => void;
  onHelp: () => void;
  /** Optional: register a callback for connect-button animation pulses. */
  onAnimateConnect?: (callback: () => void) => void;
}

const CONNECTION_LABELS: Record<ConnectionState, string> = {
  none: 'Offline',
  wasm: 'WASM',
  hardware: 'Hardware',
  both: 'HW+WASM',
};

const CONNECTION_CLASSES: Record<ConnectionState, string> = {
  none: 'transport-none',
  wasm: 'transport-wasm',
  hardware: 'transport-hardware',
  both: 'transport-both',
};

export function MainToolbar(props: MainToolbarProps) {
  let connectButtonRef: HTMLButtonElement | undefined;

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
    props.onAnimateConnect?.(handleAnimateConnect);
  });

  const runtimeStatus = () => CONNECTION_LABELS[props.connectionState];

  const connectButtonClass = () =>
    `toolbar-button ${CONNECTION_CLASSES[props.connectionState]}`;

  return (
    <div id="panel-toolbar">
      <div class="toolbar-row">
        <button
          ref={connectButtonRef}
          class={connectButtonClass()}
          title={`Connect (${runtimeStatus()})`}
          aria-label={`Connect (${runtimeStatus()})`}
          onClick={() => props.onConnect()}
        >
          <Cable />
        </button>
        <span
          class={`runtime-mode-label ${CONNECTION_CLASSES[props.connectionState]}`}
          aria-live="polite"
        >
          {runtimeStatus()}
        </span>
        <button
          class="toolbar-button"
          title="Graph"
          aria-label="Graph"
          onClick={() => props.onToggleGraph()}
        >
          <ChartSpline />
        </button>
      </div>

      <div class="toolbar-row">
        <button
          class="toolbar-button"
          title="Load Code"
          aria-label="Load Code"
          onClick={() => props.onLoadCode()}
        >
          <File />
        </button>
        <button
          class="toolbar-button"
          title="Save Code"
          aria-label="Save Code"
          onClick={() => props.onSaveCode()}
        >
          <Save />
        </button>
      </div>

      <div class="toolbar-row">
        <button
          class="toolbar-button"
          title="Font size--"
          aria-label="Font size--"
          onClick={() => props.onFontSizeDown()}
        >
          <AArrowDown />
        </button>
        <button
          class="toolbar-button"
          title="Font size++"
          aria-label="Font size++"
          onClick={() => props.onFontSizeUp()}
        >
          <AArrowUp />
        </button>
      </div>

      <div class="toolbar-row">
        <button
          class="toolbar-button"
          title="Help!"
          aria-label="Help!"
          onClick={() => props.onHelp()}
        >
          <CircleHelp />
        </button>
        <button
          class="toolbar-button"
          title="Settings"
          aria-label="Settings"
          onClick={() => props.onSettings()}
        >
          <Settings />
        </button>
      </div>
    </div>
  );
}
