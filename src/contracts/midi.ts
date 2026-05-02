// src/contracts/midi.ts
//
// Shared types for browser-side Web MIDI input.
// Spec: docs/specs/live-edit.md §5.6+ (MIDI binding model and learn flow).
// Frame: MAIN.md §4.2 — input only, browser-side, no MIDI out, no sysex,
// no firmware-side MIDI.

// ── Device enumeration ─────────────────────────────────────────────────────

export type MidiPortState = "connected" | "disconnected";

/**
 * A Web MIDI input device the editor knows about. Mirrors the relevant
 * fields of `MIDIInput` plus the user's enable/disable preference.
 */
export interface MidiInputDescriptor {
  /** Browser-stable port id from `navigator.requestMIDIAccess()`. */
  id: string;
  name: string;
  manufacturer: string;
  state: MidiPortState;
  /** User toggle in the settings panel. */
  enabled: boolean;
}

// ── Incoming messages ──────────────────────────────────────────────────────

/**
 * Parsed MIDI event. Channel is 1..16 (MIDI 1.0 channel + 1).
 * `time` is the browser's `event.timeStamp` (DOMHighResTimeStamp, ms).
 */
export type MidiMessage =
  | {
      kind: "cc";
      channel: number;
      controller: number;
      value: number;
      portId: string;
      time: number;
    }
  | {
      kind: "note-on";
      channel: number;
      note: number;
      velocity: number;
      portId: string;
      time: number;
    }
  | {
      kind: "note-off";
      channel: number;
      note: number;
      velocity: number;
      portId: string;
      time: number;
    };

// ── Bindings (§5.7) ────────────────────────────────────────────────────────

/**
 * MIDI source descriptor — the key half of a binding. One slot ↔ at most one
 * binding in v1.
 */
export type MidiSource =
  | {
      kind: "cc";
      /** 1..16 or "any" to match any channel. */
      channel: number | "any";
      /** 0..127. */
      controller: number;
    }
  | {
      kind: "note";
      channel: number | "any";
      /** 0..127. */
      note: number;
      /** "velocity" maps velocity into the slot range; "toggle" flips a boolean on each note-on. */
      mode: "velocity" | "toggle";
    };

/**
 * Pairing of a live-edit slot id with a MIDI source.
 */
export interface MidiBinding {
  slotId: string;
  source: MidiSource;
}

// ── Learn flow (§5.8) ──────────────────────────────────────────────────────

/**
 * Editor-wide learn state. At any moment the editor is either idle, listening
 * for a single card's binding, or batch-learning across cards in panel order.
 */
export type MidiLearnState =
  | { mode: "idle" }
  | { mode: "single"; slotId: string }
  | {
      mode: "batch";
      slotIds: string[];
      /** Index of the currently-armed card. */
      index: number;
    };
