// src/effects/midiLearnController.ts
//
// State machine for the MIDI learn flow.
//
// Spec: docs/specs/live-edit.md §5.7–§5.11
// Pure module — no DOM, no CodeMirror, no SolidJS.

import type {
  MidiBinding,
  MidiLearnState,
  MidiMessage,
  MidiSource,
} from "../contracts/midi.ts";

// ── Config ────────────────────────────────────────────────────────────────────

export interface MidiLearnConfig {
  /** Get the current bindings table. */
  getBindings(): Map<string, MidiBinding>;
  /** Apply a binding (save it). */
  applyBinding(binding: MidiBinding): void;
  /** Remove a binding by slot id. */
  removeBinding(slotId: string): void;
  /** Default channel scope from settings (§5.11, §10.13). */
  channelScopeDefault: "specific" | "any";
}

// ── Public types ──────────────────────────────────────────────────────────────

export interface ConflictInfo {
  /** The slot that lost its binding. */
  previousSlotId: string;
  /** The source that was moved. */
  source: MidiSource;
}

export interface MidiLearnController {
  /** Current learn state. */
  readonly state: MidiLearnState;

  /** Start learning for a single slot. */
  startSingle(slotId: string): void;

  /** Start batch learning across all slots in order. */
  startBatch(slotIds: string[]): void;

  /** Cancel the current learn operation. Returns to idle without binding. */
  cancel(): void;

  /**
   * Skip the current slot in batch mode (advance without binding).
   * No-op in single or idle mode.
   */
  skip(): void;

  /**
   * Feed a MIDI message to the learn controller.
   * If we're in a learn state and the message is bindable (CC or note-on),
   * creates a binding and advances/completes the learn.
   * Returns conflict info if a binding was moved from another slot, null otherwise.
   */
  handleMessage(msg: MidiMessage): ConflictInfo | null;

  /** Subscribe to state changes. Returns an unsubscribe function. */
  onStateChanged(handler: (state: MidiLearnState) => void): () => void;
}

// ── Source overlap check (§5.10) ──────────────────────────────────────────────

/**
 * Returns true if two MidiSources refer to the same physical control with
 * overlapping channel scope.
 *
 * Channel overlap rules (§5.11):
 *  - "any" overlaps with everything (specific or "any").
 *  - Two specific channels overlap only if they are equal.
 */
function sourcesOverlap(a: MidiSource, b: MidiSource): boolean {
  if (a.kind !== b.kind) return false;

  const channelsOverlap = (
    ca: number | "any",
    cb: number | "any",
  ): boolean => {
    if (ca === "any" || cb === "any") return true;
    return ca === cb;
  };

  if (a.kind === "cc" && b.kind === "cc") {
    return (
      a.controller === b.controller && channelsOverlap(a.channel, b.channel)
    );
  }
  if (a.kind === "note" && b.kind === "note") {
    return a.note === b.note && channelsOverlap(a.channel, b.channel);
  }
  return false;
}

// ── Source construction from message (§5.7, §5.11) ────────────────────────────

function sourceFromMessage(
  msg: MidiMessage & { kind: "cc" | "note-on" },
  channelScope: "specific" | "any",
): MidiSource {
  const channel: number | "any" =
    channelScope === "any" ? "any" : msg.channel;

  if (msg.kind === "cc") {
    return { kind: "cc", channel, controller: msg.controller };
  }
  // note-on
  return { kind: "note", channel, note: msg.note, mode: "velocity" };
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createMidiLearnController(
  config: MidiLearnConfig,
): MidiLearnController {
  let _state: MidiLearnState = { mode: "idle" };
  const _listeners = new Set<(state: MidiLearnState) => void>();

  function setState(next: MidiLearnState): void {
    _state = next;
    for (const handler of _listeners) {
      handler(next);
    }
  }

  /**
   * Find an existing binding whose source overlaps with `source` on a
   * *different* slot than `targetSlotId`. Returns the conflicting binding
   * if found, undefined otherwise.
   */
  function findConflict(
    source: MidiSource,
    targetSlotId: string,
  ): MidiBinding | undefined {
    const bindings = config.getBindings();
    for (const [slotId, binding] of bindings) {
      if (slotId === targetSlotId) continue;
      if (sourcesOverlap(binding.source, source)) {
        return binding;
      }
    }
    return undefined;
  }

  /**
   * Create a binding for `slotId` from `source`, resolving any conflict.
   * Returns ConflictInfo if an existing binding was displaced, null otherwise.
   */
  function applyLearnedBinding(
    slotId: string,
    source: MidiSource,
  ): ConflictInfo | null {
    let conflict: ConflictInfo | null = null;

    const existing = findConflict(source, slotId);
    if (existing) {
      config.removeBinding(existing.slotId);
      conflict = { previousSlotId: existing.slotId, source };
    }

    config.applyBinding({ slotId, source });
    return conflict;
  }

  return {
    get state(): MidiLearnState {
      return _state;
    },

    startSingle(slotId: string): void {
      setState({ mode: "single", slotId });
    },

    startBatch(slotIds: string[]): void {
      if (slotIds.length === 0) {
        setState({ mode: "idle" });
        return;
      }
      setState({ mode: "batch", slotIds, index: 0 });
    },

    cancel(): void {
      setState({ mode: "idle" });
    },

    skip(): void {
      if (_state.mode !== "batch") return;
      const next = _state.index + 1;
      if (next >= _state.slotIds.length) {
        setState({ mode: "idle" });
      } else {
        setState({ mode: "batch", slotIds: _state.slotIds, index: next });
      }
    },

    handleMessage(msg: MidiMessage): ConflictInfo | null {
      // Only respond to bindable messages
      if (msg.kind !== "cc" && msg.kind !== "note-on") return null;

      if (_state.mode === "idle") return null;

      const source = sourceFromMessage(msg, config.channelScopeDefault);

      if (_state.mode === "single") {
        const { slotId } = _state;
        const conflict = applyLearnedBinding(slotId, source);
        setState({ mode: "idle" });
        return conflict;
      }

      if (_state.mode === "batch") {
        const { slotIds, index } = _state;
        const slotId = slotIds[index];
        const next = index + 1;
        const conflict = applyLearnedBinding(slotId, source);
        if (next >= slotIds.length) {
          setState({ mode: "idle" });
        } else {
          setState({ mode: "batch", slotIds, index: next });
        }
        return conflict;
      }

      return null;
    },

    onStateChanged(handler: (state: MidiLearnState) => void): () => void {
      _listeners.add(handler);
      return () => {
        _listeners.delete(handler);
      };
    },
  };
}
