import { For, Show } from "solid-js";
import { Section, FormRow, Checkbox } from "./FormControls";
import type { MidiInputDescriptor, MidiPermissionState } from "../../contracts/midi.ts";

export type { MidiPermissionState };

export interface MidiSettingsProps {
  permission: MidiPermissionState;
  inputs: MidiInputDescriptor[];
  onRequestPermission: () => void;
  onToggleInput: (id: string, enabled: boolean) => void;
}

/**
 * Settings panel section for browser-side Web MIDI input.
 *
 * Spec: docs/specs/live-edit.md §5.6 — input only, browser-side.
 * No MIDI out, no sysex, no firmware-side MIDI.
 *
 * Pure prop-driven: parent supplies device list and permission state, this
 * component just renders + forwards toggles. No runtime/persistence wiring.
 */
export function MidiSettings(props: MidiSettingsProps) {
  return (
    <Section title="MIDI Input" defaultOpen>
      <Show when={props.permission === "unknown"}>
        <p class="panel-info-text">
          Connect MIDI controllers to bind CC and note messages to live-edit
          slots in your code. Bindings work browser-side only — no MIDI output,
          clock, or sysex. Granting access lets the editor enumerate your
          plugged-in MIDI input devices.
        </p>
        <div class="panel-button-group">
          <button class="panel-button" onClick={() => props.onRequestPermission()}>
            Request MIDI access
          </button>
        </div>
      </Show>

      <Show when={props.permission === "denied"}>
        <p class="panel-info-text">
          MIDI access was denied. To enable it, open your browser's site
          settings for this page and allow MIDI, then reload. Some browsers
          surface this under a hidden "MIDI devices" permission and require an
          explicit toggle per site.
        </p>
        <div class="panel-button-group">
          <button class="panel-button" onClick={() => props.onRequestPermission()}>
            Try again
          </button>
        </div>
      </Show>

      <Show when={props.permission === "unsupported"}>
        <p class="panel-info-text">
          Your browser doesn't support Web MIDI. Use a Chromium-based browser
          (Chrome, Edge, Brave, Arc) on desktop to enable MIDI input. Firefox
          and Safari currently lack Web MIDI support.
        </p>
      </Show>

      <Show when={props.permission === "granted"}>
        <Show
          when={props.inputs.length > 0}
          fallback={
            <p class="panel-info-text">
              No MIDI input devices detected. Plug one in and it'll appear
              here.
            </p>
          }
        >
          <p class="panel-info-text">
            Toggle a device off to ignore its messages without unplugging it.
            Disconnected devices stay listed so your enable preference persists
            across reconnects.
          </p>
          <For each={props.inputs}>
            {(input) => (
              <MidiInputRow
                input={input}
                onToggle={(enabled) => props.onToggleInput(input.id, enabled)}
              />
            )}
          </For>
        </Show>
      </Show>
    </Section>
  );
}

function MidiInputRow(props: {
  input: MidiInputDescriptor;
  onToggle: (enabled: boolean) => void;
}) {
  const isDisconnected = () => props.input.state === "disconnected";

  // Use FormRow's structure so the row matches the rest of the settings panel.
  // The label slot carries name + manufacturer + connection-state badge.
  return (
    <FormRow
      label={
        // FormRow expects a string; we render a richer label via the
        // children slot below by passing an empty string and letting the
        // row's label cell hold a fragment.
        // Workaround: FormRow renders <label class="panel-label">{label}</label>,
        // so we keep the device name in the label text and surface the
        // manufacturer + state inline to its right via children.
        props.input.name
      }
    >
      <span
        style={{
          display: "flex",
          "align-items": "center",
          gap: "8px",
          flex: "1",
          "min-width": "0",
          opacity: isDisconnected() ? "0.55" : "1",
        }}
      >
        <Show when={props.input.manufacturer}>
          <span
            style={{
              "font-size": "0.78em",
              color: "var(--text-secondary, rgba(255, 255, 255, 0.65))",
              "white-space": "nowrap",
              overflow: "hidden",
              "text-overflow": "ellipsis",
            }}
          >
            {props.input.manufacturer}
          </span>
        </Show>
        <span
          aria-label={`Connection state: ${props.input.state}`}
          style={{
            "font-family": "var(--code-font)",
            "font-size": "0.7em",
            "text-transform": "uppercase",
            "letter-spacing": "0.06em",
            padding: "2px 6px",
            "border-radius": "var(--item-border-radius)",
            border: "1px solid",
            "border-color": isDisconnected()
              ? "var(--panel-border)"
              : "var(--accent-color)",
            color: isDisconnected()
              ? "var(--text-secondary, rgba(255, 255, 255, 0.65))"
              : "var(--accent-color)",
            "white-space": "nowrap",
          }}
        >
          {props.input.state}
        </span>
        <span style={{ "margin-left": "auto" }}>
          <Checkbox
            checked={props.input.enabled}
            onChange={(val) => props.onToggle(val)}
          />
        </span>
      </span>
    </FormRow>
  );
}
