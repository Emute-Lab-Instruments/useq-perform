import { onMount } from "solid-js";
import { Cable, ChartSpline, CircleDot, File, Save, AArrowDown, AArrowUp, CircleHelp, Settings, AudioLines, SlidersHorizontal } from "lucide-solid";
import { withShortcut } from "./toolbar/shortcutLabels";
import type { RuntimeProtocolMode } from "../contracts/runtimeTypes.ts";

export type ConnectionState = 'none' | 'wasm' | 'hardware' | 'both';

export type MainToolbarAction =
  | 'connect'
  | 'graph'
  | 'load'
  | 'save'
  | 'fontDown'
  | 'fontUp'
  | 'liveEdit'
  | 'learnAll'
  | 'help'
  | 'settings'
  | 'calibrate';

export interface MainToolbarProps {
  connectionState: ConnectionState;
  protocolMode?: RuntimeProtocolMode;
  onConnect: () => void;
  onToggleGraph: () => void;
  onLoadCode: () => void;
  onSaveCode: () => void;
  onFontSizeUp: () => void;
  onFontSizeDown: () => void;
  /** live-edit.md §5.1.5 — open/close the dockable live-edit panel. */
  onToggleLiveEditPanel?: () => void;
  /** live-edit.md §5.8.2 — batch MIDI-learn across every live-edit. */
  onStartLearnAll?: () => void;
  onSettings: () => void;
  onBeginCalibration?: () => void;
  onHelp: () => void;
  /** Display shortcuts for toolbar actions, already formatted by the adapter. */
  shortcuts?: Partial<Record<MainToolbarAction, string>>;
  /** Optional: register a callback for connect-button animation pulses. */
  onAnimateConnect?: (callback: () => void) => void;
}

/**
 * Connection status chip text (runtime-modes.md §1.6, transport.md §1.8).
 * Plain-language names for the four runtime modes; the tooltip carries the
 * precise meaning and what a click will do.
 */
export const CONNECTION_LABELS: Record<ConnectionState, string> = {
  none: 'Offline',
  wasm: 'Virtual uSEQ',
  hardware: 'uSEQ hardware',
  both: 'Hardware + virtual',
};

export const CONNECTION_DESCRIPTIONS: Record<ConnectionState, string> = {
  none: 'Offline: no runtime is available, so code will not run. Click to connect a uSEQ module over USB.',
  wasm: 'Virtual uSEQ: code runs in the browser-local interpreter; no module is connected. Click to connect a uSEQ module over USB.',
  hardware: 'uSEQ hardware: code runs on the connected module; the browser-local interpreter is off. Click to disconnect the module.',
  both: 'Hardware + virtual: the connected module drives the outputs; the browser-local interpreter mirrors it for visualisation. Click to disconnect the module.',
};

const CONNECTION_CLASSES: Record<ConnectionState, string> = {
  none: 'transport-none',
  wasm: 'transport-wasm',
  hardware: 'transport-hardware',
  both: 'transport-both',
};

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function MainToolbar(props: MainToolbarProps) {
  let connectButtonRef: HTMLButtonElement | undefined;

  const handleAnimateConnect = () => {
    if (!connectButtonRef || typeof connectButtonRef.animate !== 'function') return;
    if (prefersReducedMotion()) {
      // No movement: a short brightness flash still draws the eye.
      connectButtonRef.animate([
        { filter: 'brightness(1)' },
        { filter: 'brightness(1.6)' },
        { filter: 'brightness(1)' },
      ], { duration: 600, easing: 'ease-in-out' });
      return;
    }
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
  };

  onMount(() => {
    props.onAnimateConnect?.(handleAnimateConnect);
  });

  const title = (label: string, action: MainToolbarAction) =>
    withShortcut(label, props.shortcuts?.[action]);

  const connectionClass = () => CONNECTION_CLASSES[props.connectionState];
  const connectionLabel = () => props.protocolMode === "negotiating"
    ? "Connecting to uSEQ…"
    : CONNECTION_LABELS[props.connectionState];
  const connectionDescription = () => props.protocolMode === "negotiating"
    ? "Connecting to uSEQ: the protocol handshake is in progress. Browser-local WASM remains available; hardware evals are not delivered while the protocol is unresolved."
    : CONNECTION_DESCRIPTIONS[props.connectionState];

  return (
    <div id="panel-toolbar">
      <div class="toolbar-row toolbar-group toolbar-group-runtime" role="group" aria-label="Runtime">
        <button
          ref={connectButtonRef}
          type="button"
          class={`toolbar-button connection-chip ${connectionClass()}`}
          data-connection-state={props.connectionState}
          title={title(connectionDescription(), 'connect')}
          aria-label={connectionDescription()}
          onClick={() => props.onConnect()}
        >
          <Cable />
          <span class="connection-chip-dot" aria-hidden="true" />
          <span
            class={`connect-badge connection-chip-label ${connectionClass()}`}
            aria-live="polite"
          >
            {connectionLabel()}
          </span>
        </button>
        <button type="button" class="toolbar-button" title="Calibrate CV outputs" aria-label="Calibrate CV outputs" onClick={() => props.onBeginCalibration?.()} disabled={props.connectionState !== 'hardware' && props.connectionState !== 'both'}>
          <AudioLines />
        </button>
      </div>

      <div class="toolbar-row toolbar-group toolbar-group-file" role="group" aria-label="File">
        <button
          type="button"
          class="toolbar-button"
          title={title("Load Code", 'load')}
          aria-label="Load Code"
          onClick={() => props.onLoadCode()}
        >
          <File />
        </button>
        <button
          type="button"
          class="toolbar-button"
          title={title("Save Code", 'save')}
          aria-label="Save Code"
          onClick={() => props.onSaveCode()}
        >
          <Save />
        </button>
      </div>

      <div class="toolbar-row toolbar-group toolbar-group-view" role="group" aria-label="View">
        <button
          type="button"
          class="toolbar-button"
          title={title("Graph", 'graph')}
          aria-label="Graph"
          onClick={() => props.onToggleGraph()}
        >
          <ChartSpline />
        </button>
        <button
          type="button"
          class="toolbar-button"
          title={title("Live-edit panel", 'liveEdit')}
          aria-label="Live-edit panel"
          onClick={() => props.onToggleLiveEditPanel?.()}
        >
          <SlidersHorizontal />
        </button>
        {/* live-edit.md §5.8.2: LEARN ALL sits next to the panel toggle. */}
        <button
          type="button"
          class="toolbar-button"
          title={title("LEARN ALL — MIDI-learn every live-edit", 'learnAll')}
          aria-label="LEARN ALL"
          onClick={() => props.onStartLearnAll?.()}
        >
          <CircleDot />
        </button>
        <div class="toolbar-button-pair" role="group" aria-label="Font size">
          <button
            type="button"
            class="toolbar-button"
            title={title("Font size--", 'fontDown')}
            aria-label="Font size--"
            onClick={() => props.onFontSizeDown()}
          >
            <AArrowDown />
          </button>
          <button
            type="button"
            class="toolbar-button"
            title={title("Font size++", 'fontUp')}
            aria-label="Font size++"
            onClick={() => props.onFontSizeUp()}
          >
            <AArrowUp />
          </button>
        </div>
      </div>

      <div class="toolbar-row toolbar-group toolbar-group-app" role="group" aria-label="App">
        <button
          type="button"
          class="toolbar-button"
          title={title("Help!", 'help')}
          aria-label="Help!"
          onClick={() => props.onHelp()}
        >
          <CircleHelp />
        </button>
        <button
          type="button"
          class="toolbar-button"
          title={title("Settings", 'settings')}
          aria-label="Settings"
          onClick={() => props.onSettings()}
        >
          <Settings />
        </button>
      </div>
    </div>
  );
}
