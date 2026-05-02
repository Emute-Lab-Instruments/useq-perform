// src/ui/liveEdit/MidiLearnAffordance.tsx
//
// MIDI learn icon button that lives in a panel card's action-affordance row.
// Spec: docs/specs/live-edit.md §5.8 (learn flow), §5.9 (binding indicator).
//
// Pure visual layer: the parent owns the learn-state machine and binding store
// and pipes the resulting state in via props.

import { Show } from "solid-js";
import type { MidiBinding, MidiSource } from "../../contracts/midi";
import "./MidiLearn.css";

export interface MidiLearnAffordanceProps {
  slotId: string;
  /** Present iff the slot already has a MIDI binding. */
  binding?: MidiBinding;
  /** True iff this slot is the current learn target (single or batch index). */
  learning: boolean;
  onStart: () => void;
  onCancel: () => void;
  /** Clear the existing binding (only meaningful when `binding` is present). */
  onClear: () => void;
}

/**
 * Format a {@link MidiSource} into a compact label per §5.9.1.
 *
 * Examples:
 *   - `CC74`            (CC, channel: any)
 *   - `Ch2 CC74`        (CC, specific channel)
 *   - `C3`              (note, any channel, toggle implied default off)
 *   - `Ch2 C3 vel`      (note, velocity mode)
 */
export function formatMidiSourceLabel(source: MidiSource): string {
  const channelPrefix =
    source.channel === "any" ? "" : `Ch${source.channel} `;

  if (source.kind === "cc") {
    return `${channelPrefix}CC${source.controller}`;
  }

  // note
  const noteName = formatNoteName(source.note);
  const modeSuffix = source.mode === "velocity" ? " vel" : "";
  return `${channelPrefix}${noteName}${modeSuffix}`;
}

/** Standard MIDI note number → scientific pitch name. C3 = 60 (uSEQ convention). */
function formatNoteName(note: number): string {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const octave = Math.floor(note / 12) - 2;
  const name = names[((note % 12) + 12) % 12];
  return `${name}${octave}`;
}

export function MidiLearnAffordance(props: MidiLearnAffordanceProps) {
  const variant = (): "idle" | "bound" | "listening" => {
    if (props.learning) return "listening";
    if (props.binding) return "bound";
    return "idle";
  };

  const handleClick = () => {
    if (props.learning) props.onCancel();
    else props.onStart();
  };

  const ariaLabel = () => {
    if (props.learning) return `Cancel MIDI learn for ${props.slotId}`;
    if (props.binding) {
      return `Re-learn MIDI for ${props.slotId} (currently ${formatMidiSourceLabel(
        props.binding.source
      )})`;
    }
    return `Start MIDI learn for ${props.slotId}`;
  };

  return (
    <span
      class="midi-learn-affordance"
      data-slot-id={props.slotId}
      data-variant={variant()}
    >
      <button
        type="button"
        class={`midi-learn-affordance__button midi-learn-affordance__button--${variant()}`}
        onClick={handleClick}
        aria-pressed={props.learning}
        aria-label={ariaLabel()}
        title={ariaLabel()}
      >
        <span class="midi-learn-affordance__icon" aria-hidden="true">
          {/* §5.8 — `◉ LRN` glyph. The icon stays the same across states; the
            * surrounding pulse/colour communicates the variant. */}
          {"◉"}
        </span>
        <Show
          when={props.binding}
          fallback={<span class="midi-learn-affordance__label">LRN</span>}
        >
          {(binding) => (
            <span class="midi-learn-affordance__label">
              {formatMidiSourceLabel(binding().source)}
            </span>
          )}
        </Show>
      </button>
      <Show when={props.binding && !props.learning}>
        <button
          type="button"
          class="midi-learn-affordance__clear"
          onClick={props.onClear}
          aria-label={`Clear MIDI binding for ${props.slotId}`}
          title="Clear binding"
        >
          {"×"}
        </button>
      </Show>
    </span>
  );
}
