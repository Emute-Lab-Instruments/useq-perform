// src/effects/midiRouter.ts
//
// MIDI CC/note → live-edit slot routing.
//
// Spec: docs/specs/live-edit.md §5.7 (MIDI binding model and value mapping).
// Pure module — no DOM, no CodeMirror, no SolidJS.

import type { MidiBinding, MidiMessage, MidiSource } from "../contracts/midi.ts";
import type { SlotValue } from "../contracts/liveEdit.ts";

// ── Config interface ──────────────────────────────────────────────────────────

export interface SlotInfo {
  min: number;
  max: number;
  kind: "numeric" | "boolean" | "keyword";
  options?: string[];
}

export interface MidiRouterConfig {
  /** Lookup a binding by source descriptor. */
  findBinding(source: MidiSource): MidiBinding | undefined;
  /** Get slot info needed for value mapping. */
  getSlotInfo(slotId: string): SlotInfo | undefined;
}

// ── Router interface ──────────────────────────────────────────────────────────

export type SlotUpdate = { slotId: string; value: SlotValue };

export interface MidiRouter {
  /**
   * Process an incoming MIDI message. Buffers resulting slot updates.
   * Returns the slot updates produced by this message (may be empty).
   */
  route(msg: MidiMessage): SlotUpdate[];
  /**
   * Coalesce buffered updates: returns the latest value per slot and clears
   * the internal buffer. Call once per UI tick (rAF).
   */
  flush(): SlotUpdate[];
}

// ── Value mapping (§5.7) ──────────────────────────────────────────────────────

/**
 * Map a 0..127 value linearly into [min, max].
 * Formula: min + (value / 127) * (max - min)
 */
function mapLinear(value: number, min: number, max: number): number {
  return min + (value / 127) * (max - min);
}

/**
 * Map a 0..127 value to a keyword option index.
 * floor(value / 128 * options.length), clamped to valid range.
 */
function mapToOptionIndex(value: number, optionCount: number): number {
  const raw = Math.floor((value / 128) * optionCount);
  return Math.min(raw, optionCount - 1);
}

function mapCcValue(ccValue: number, slot: SlotInfo): SlotValue | null {
  switch (slot.kind) {
    case "numeric":
      return mapLinear(ccValue, slot.min, slot.max);
    case "boolean":
      return ccValue >= 64;
    case "keyword": {
      const options = slot.options;
      if (!options || options.length === 0) return null;
      return options[mapToOptionIndex(ccValue, options.length)];
    }
  }
}

function mapVelocityValue(
  velocity: number,
  slot: SlotInfo,
  isNoteOff: boolean
): SlotValue | null {
  switch (slot.kind) {
    case "numeric":
      // Note-off sets to min per §5.7
      return isNoteOff ? slot.min : mapLinear(velocity, slot.min, slot.max);
    case "boolean":
      return isNoteOff ? false : velocity >= 64;
    case "keyword": {
      const options = slot.options;
      if (!options || options.length === 0) return null;
      if (isNoteOff) return options[0];
      return options[mapToOptionIndex(velocity, options.length)];
    }
  }
}

// ── Source matching ───────────────────────────────────────────────────────────

function channelMatches(
  binding: number | "any",
  messageChannel: number
): boolean {
  return binding === "any" || binding === messageChannel;
}

/**
 * Find the binding that matches an incoming message. Returns undefined if none.
 * Walks all bindings via the config's findBinding; we extract the search key
 * from the message itself and call findBinding once.
 */
function findMatchingBinding(
  msg: MidiMessage,
  findBinding: MidiRouterConfig["findBinding"]
): MidiBinding | undefined {
  if (msg.kind === "cc") {
    // Try specific channel first, then "any"
    const exactSource: MidiSource = {
      kind: "cc",
      channel: msg.channel,
      controller: msg.controller,
    };
    const anySource: MidiSource = {
      kind: "cc",
      channel: "any",
      controller: msg.controller,
    };
    return findBinding(exactSource) ?? findBinding(anySource);
  }

  if (msg.kind === "note-on" || msg.kind === "note-off") {
    // Note bindings are keyed by note number; mode doesn't affect matching.
    // Try each mode variant and both channel forms.
    for (const mode of ["velocity", "toggle"] as const) {
      const exactSource: MidiSource = {
        kind: "note",
        channel: msg.channel,
        note: msg.note,
        mode,
      };
      const anySource: MidiSource = {
        kind: "note",
        channel: "any",
        note: msg.note,
        mode,
      };
      const binding = findBinding(exactSource) ?? findBinding(anySource);
      if (binding) return binding;
    }
  }

  return undefined;
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createMidiRouter(config: MidiRouterConfig): MidiRouter {
  // Toggle state per slotId — tracks current boolean value for toggle-mode notes.
  const _toggleState = new Map<string, boolean>();

  // Pending updates buffer: slotId → latest value. Last write wins per slot.
  const _pending = new Map<string, SlotValue>();

  function bufferUpdate(slotId: string, value: SlotValue): SlotUpdate {
    _pending.set(slotId, value);
    return { slotId, value };
  }

  return {
    route(msg: MidiMessage): SlotUpdate[] {
      const binding = findMatchingBinding(msg, (src) =>
        config.findBinding(src)
      );
      if (!binding) return [];

      // Validate channel match using the binding's source (the config lookup
      // may have found it via "any" — confirm the binding's channel matches).
      const src = binding.source;
      if (msg.kind === "cc") {
        if (src.kind !== "cc") return [];
        if (!channelMatches(src.channel, msg.channel)) return [];

        const slot = config.getSlotInfo(binding.slotId);
        if (!slot) return [];

        const value = mapCcValue(msg.value, slot);
        if (value === null) return [];

        return [bufferUpdate(binding.slotId, value)];
      }

      if (msg.kind === "note-on") {
        if (src.kind !== "note") return [];
        if (!channelMatches(src.channel, msg.channel)) return [];

        const slot = config.getSlotInfo(binding.slotId);
        if (!slot) return [];

        if (src.mode === "toggle") {
          // Toggle mode only meaningful for booleans
          if (slot.kind !== "boolean") return [];
          const current = _toggleState.get(binding.slotId) ?? false;
          const next = !current;
          _toggleState.set(binding.slotId, next);
          return [bufferUpdate(binding.slotId, next)];
        }

        // velocity mode
        const value = mapVelocityValue(msg.velocity, slot, false);
        if (value === null) return [];
        return [bufferUpdate(binding.slotId, value)];
      }

      if (msg.kind === "note-off") {
        if (src.kind !== "note") return [];
        if (!channelMatches(src.channel, msg.channel)) return [];

        // Toggle mode ignores note-off
        if (src.mode === "toggle") return [];

        const slot = config.getSlotInfo(binding.slotId);
        if (!slot) return [];

        const value = mapVelocityValue(msg.velocity, slot, true);
        if (value === null) return [];
        return [bufferUpdate(binding.slotId, value)];
      }

      return [];
    },

    flush(): SlotUpdate[] {
      if (_pending.size === 0) return [];
      const updates: SlotUpdate[] = [];
      for (const [slotId, value] of _pending) {
        updates.push({ slotId, value });
      }
      _pending.clear();
      return updates;
    },
  };
}
