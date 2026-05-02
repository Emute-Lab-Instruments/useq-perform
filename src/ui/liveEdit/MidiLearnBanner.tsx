// src/ui/liveEdit/MidiLearnBanner.tsx
//
// Top-of-panel status banner shown during MIDI learn.
// Spec: docs/specs/live-edit.md §5.8.1 (single), §5.8.2 (batch).
//
// Single mode:  `Listening for MIDI on <name>...   Esc ✗`
// Batch mode:   `Listening for MIDI on <name> (3/8)...   N skip   Esc ✗`
// Idle:         renders nothing.

import { Show, Switch, Match } from "solid-js";
import type { MidiLearnState } from "../../contracts/midi";
import "./MidiLearn.css";

export interface MidiLearnBannerProps {
  state: MidiLearnState;
  /** Display name of the slot in single mode. Falls back to slot id. */
  slotName?: string;
  /**
   * Display names for every slot in the batch, indexed parallel to
   * `state.slotIds` when `state.mode === "batch"`. Used to render the
   * currently-armed name and the (i/N) progress.
   */
  batchSlotNames?: string[];
  /** Skip the currently-armed batch slot. No-op outside batch mode. */
  onSkip: () => void;
  onCancel: () => void;
}

export function MidiLearnBanner(props: MidiLearnBannerProps) {
  const currentBatchName = (): string => {
    if (props.state.mode !== "batch") return "";
    const names = props.batchSlotNames ?? [];
    const id = props.state.slotIds[props.state.index];
    return names[props.state.index] ?? id ?? "?";
  };

  const batchProgress = (): string => {
    if (props.state.mode !== "batch") return "";
    return `(${props.state.index + 1}/${props.state.slotIds.length})`;
  };

  return (
    <Show when={props.state.mode !== "idle"}>
      <div class="midi-learn-banner" role="status" aria-live="polite">
        <span class="midi-learn-banner__message">
          <Switch>
            <Match when={props.state.mode === "single"}>
              <>
                {"Listening for MIDI on "}
                <span class="midi-learn-banner__slot">
                  {props.slotName ??
                    (props.state.mode === "single"
                      ? props.state.slotId
                      : "?")}
                </span>
                {"..."}
              </>
            </Match>
            <Match when={props.state.mode === "batch"}>
              <>
                {"Listening for MIDI on "}
                <span class="midi-learn-banner__slot">
                  {currentBatchName()}
                </span>{" "}
                <span class="midi-learn-banner__progress">
                  {batchProgress()}
                </span>
                {"..."}
              </>
            </Match>
          </Switch>
        </span>
        <span class="midi-learn-banner__actions">
          <Show when={props.state.mode === "batch"}>
            <button
              type="button"
              class="midi-learn-banner__action"
              onClick={props.onSkip}
              aria-label="Skip current slot"
              title="Skip current slot (N)"
            >
              <kbd class="midi-learn-banner__key">N</kbd>
              <span>skip</span>
            </button>
          </Show>
          <button
            type="button"
            class="midi-learn-banner__action"
            onClick={props.onCancel}
            aria-label="Cancel MIDI learn"
            title="Cancel (Esc)"
          >
            <kbd class="midi-learn-banner__key">Esc</kbd>
            <span aria-hidden="true">{"✗"}</span>
          </button>
        </span>
      </div>
    </Show>
  );
}
