// src/effects/__tests__/midiLearnController.test.ts
//
// Unit tests for the MIDI learn state machine.
// Spec: docs/specs/live-edit.md §5.7–§5.11

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createMidiLearnController,
  type MidiLearnConfig,
  type MidiLearnController,
  type ConflictInfo,
} from "../midiLearnController.ts";
import type { MidiBinding, MidiMessage, MidiSource } from "../../contracts/midi.ts";

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeConfig(
  opts: Partial<MidiLearnConfig> & {
    initialBindings?: MidiBinding[];
  } = {},
): { config: MidiLearnConfig; bindings: Map<string, MidiBinding> } {
  const bindings = new Map<string, MidiBinding>(
    (opts.initialBindings ?? []).map((b) => [b.slotId, b]),
  );

  const config: MidiLearnConfig = {
    getBindings: opts.getBindings ?? (() => bindings),
    applyBinding:
      opts.applyBinding ??
      ((b: MidiBinding) => {
        bindings.set(b.slotId, b);
      }),
    removeBinding:
      opts.removeBinding ??
      ((slotId: string) => {
        bindings.delete(slotId);
      }),
    channelScopeDefault: opts.channelScopeDefault ?? "specific",
  };

  return { config, bindings };
}

function cc(
  controller: number,
  value = 64,
  channel = 1,
): MidiMessage {
  return { kind: "cc", channel, controller, value, portId: "p1", time: 0 };
}

function noteOn(note: number, velocity = 64, channel = 1): MidiMessage {
  return { kind: "note-on", channel, note, velocity, portId: "p1", time: 0 };
}

function noteOff(note: number, velocity = 0, channel = 1): MidiMessage {
  return { kind: "note-off", channel, note, velocity, portId: "p1", time: 0 };
}

// ── Single-slot learn ─────────────────────────────────────────────────────────

describe("single-slot learn", () => {
  let ctrl: MidiLearnController;
  let bindings: Map<string, MidiBinding>;

  beforeEach(() => {
    const { config, bindings: b } = makeConfig();
    bindings = b;
    ctrl = createMidiLearnController(config);
  });

  it("starts idle", () => {
    expect(ctrl.state).toEqual({ mode: "idle" });
  });

  it("transitions to single mode on startSingle", () => {
    ctrl.startSingle("s1");
    expect(ctrl.state).toEqual({ mode: "single", slotId: "s1" });
  });

  it("binding created and state returns to idle on CC message", () => {
    ctrl.startSingle("s1");
    const conflict = ctrl.handleMessage(cc(74));
    expect(ctrl.state).toEqual({ mode: "idle" });
    expect(bindings.get("s1")).toEqual({
      slotId: "s1",
      source: { kind: "cc", channel: 1, controller: 74 },
    });
    expect(conflict).toBeNull();
  });

  it("binding created on note-on message with velocity mode", () => {
    ctrl.startSingle("s1");
    const conflict = ctrl.handleMessage(noteOn(60));
    expect(ctrl.state).toEqual({ mode: "idle" });
    expect(bindings.get("s1")).toEqual({
      slotId: "s1",
      source: { kind: "note", channel: 1, note: 60, mode: "velocity" },
    });
    expect(conflict).toBeNull();
  });

  it("cancel returns to idle with no binding", () => {
    ctrl.startSingle("s1");
    ctrl.cancel();
    expect(ctrl.state).toEqual({ mode: "idle" });
    expect(bindings.size).toBe(0);
  });

  it("clicking learn again (startSingle) on same slot cancels and re-arms", () => {
    ctrl.startSingle("s1");
    ctrl.startSingle("s1");
    expect(ctrl.state).toEqual({ mode: "single", slotId: "s1" });
    expect(bindings.size).toBe(0);
  });

  it("note-off message is ignored in single mode", () => {
    ctrl.startSingle("s1");
    const conflict = ctrl.handleMessage(noteOff(60));
    // Should remain in single mode — note-off is not bindable
    expect(ctrl.state).toEqual({ mode: "single", slotId: "s1" });
    expect(bindings.size).toBe(0);
    expect(conflict).toBeNull();
  });
});

// ── Batch learn ───────────────────────────────────────────────────────────────

describe("batch learn", () => {
  let ctrl: MidiLearnController;
  let bindings: Map<string, MidiBinding>;

  beforeEach(() => {
    const { config, bindings: b } = makeConfig();
    bindings = b;
    ctrl = createMidiLearnController(config);
  });

  it("transitions to batch mode with index 0", () => {
    ctrl.startBatch(["a", "b", "c"]);
    expect(ctrl.state).toEqual({ mode: "batch", slotIds: ["a", "b", "c"], index: 0 });
  });

  it("startBatch with empty array goes directly to idle", () => {
    ctrl.startBatch([]);
    expect(ctrl.state).toEqual({ mode: "idle" });
  });

  it("walks all 3 slots and returns to idle", () => {
    ctrl.startBatch(["a", "b", "c"]);

    ctrl.handleMessage(cc(1));
    expect(ctrl.state).toEqual({ mode: "batch", slotIds: ["a", "b", "c"], index: 1 });
    expect(bindings.has("a")).toBe(true);

    ctrl.handleMessage(cc(2));
    expect(ctrl.state).toEqual({ mode: "batch", slotIds: ["a", "b", "c"], index: 2 });
    expect(bindings.has("b")).toBe(true);

    ctrl.handleMessage(cc(3));
    expect(ctrl.state).toEqual({ mode: "idle" });
    expect(bindings.has("c")).toBe(true);
  });

  it("each binding captures the correct source", () => {
    ctrl.startBatch(["a", "b"]);
    ctrl.handleMessage(cc(74, 64, 2));
    ctrl.handleMessage(noteOn(60, 100, 3));

    expect(bindings.get("a")?.source).toEqual({
      kind: "cc", channel: 2, controller: 74,
    });
    expect(bindings.get("b")?.source).toEqual({
      kind: "note", channel: 3, note: 60, mode: "velocity",
    });
  });

  it("skip advances without binding", () => {
    ctrl.startBatch(["a", "b", "c"]);
    ctrl.skip(); // skip "a"
    expect(ctrl.state).toEqual({ mode: "batch", slotIds: ["a", "b", "c"], index: 1 });
    expect(bindings.has("a")).toBe(false);

    ctrl.handleMessage(cc(2)); // bind "b"
    expect(ctrl.state).toEqual({ mode: "batch", slotIds: ["a", "b", "c"], index: 2 });
    expect(bindings.has("b")).toBe(true);

    ctrl.handleMessage(cc(3)); // bind "c" → idle
    expect(ctrl.state).toEqual({ mode: "idle" });
    expect(bindings.has("a")).toBe(false); // was skipped
    expect(bindings.has("c")).toBe(true);
  });

  it("skip on last slot returns to idle", () => {
    ctrl.startBatch(["a"]);
    ctrl.skip();
    expect(ctrl.state).toEqual({ mode: "idle" });
    expect(bindings.size).toBe(0);
  });

  it("cancel returns to idle mid-batch without binding", () => {
    ctrl.startBatch(["a", "b", "c"]);
    ctrl.handleMessage(cc(1)); // binds "a"
    ctrl.cancel();
    expect(ctrl.state).toEqual({ mode: "idle" });
    // "a" was already bound before cancel
    expect(bindings.has("a")).toBe(true);
    // "b" was never bound
    expect(bindings.has("b")).toBe(false);
  });

  it("skip is no-op in single mode", () => {
    ctrl.startSingle("s1");
    ctrl.skip();
    expect(ctrl.state).toEqual({ mode: "single", slotId: "s1" });
  });

  it("skip is no-op in idle mode", () => {
    ctrl.skip();
    expect(ctrl.state).toEqual({ mode: "idle" });
  });
});

// ── Conflict resolution (§5.10) ───────────────────────────────────────────────

describe("conflict resolution", () => {
  it("displaces an existing binding from another slot", () => {
    const { config, bindings } = makeConfig({
      initialBindings: [
        { slotId: "slotA", source: { kind: "cc", channel: 1, controller: 74 } },
      ],
    });
    const ctrl = createMidiLearnController(config);

    ctrl.startSingle("slotB");
    const conflict = ctrl.handleMessage(cc(74, 64, 1));

    // Old binding removed from slotA
    expect(bindings.has("slotA")).toBe(false);
    // New binding applied to slotB
    expect(bindings.get("slotB")?.source).toEqual({
      kind: "cc", channel: 1, controller: 74,
    });
    // Conflict info returned
    expect(conflict).toEqual<ConflictInfo>({
      previousSlotId: "slotA",
      source: { kind: "cc", channel: 1, controller: 74 },
    });
  });

  it("no conflict when re-learning the same slot", () => {
    const { config, bindings } = makeConfig({
      initialBindings: [
        { slotId: "slotA", source: { kind: "cc", channel: 1, controller: 74 } },
      ],
    });
    const ctrl = createMidiLearnController(config);

    ctrl.startSingle("slotA");
    const conflict = ctrl.handleMessage(cc(74, 64, 1));

    expect(conflict).toBeNull();
    // Binding re-applied to same slot
    expect(bindings.get("slotA")?.source).toEqual({
      kind: "cc", channel: 1, controller: 74,
    });
  });

  it("any-channel binding conflicts with specific-channel on same controller", () => {
    const { config, bindings } = makeConfig({
      initialBindings: [
        { slotId: "slotA", source: { kind: "cc", channel: "any", controller: 74 } },
      ],
    });
    const ctrl = createMidiLearnController(config);

    ctrl.startSingle("slotB");
    // specific ch1, CC74 — overlaps with "any" ch CC74
    const conflict = ctrl.handleMessage(cc(74, 64, 1));

    expect(bindings.has("slotA")).toBe(false);
    expect(conflict?.previousSlotId).toBe("slotA");
  });

  it("no conflict when controller numbers differ", () => {
    const { config, bindings } = makeConfig({
      initialBindings: [
        { slotId: "slotA", source: { kind: "cc", channel: 1, controller: 75 } },
      ],
    });
    const ctrl = createMidiLearnController(config);

    ctrl.startSingle("slotB");
    const conflict = ctrl.handleMessage(cc(74, 64, 1)); // CC74 ≠ CC75

    expect(conflict).toBeNull();
    expect(bindings.has("slotA")).toBe(true); // untouched
    expect(bindings.has("slotB")).toBe(true); // new binding added
  });

  it("note binding conflict: same note number, overlapping channel", () => {
    const { config, bindings } = makeConfig({
      initialBindings: [
        { slotId: "slotA", source: { kind: "note", channel: "any", note: 60, mode: "velocity" } },
      ],
    });
    const ctrl = createMidiLearnController(config);

    ctrl.startSingle("slotB");
    const conflict = ctrl.handleMessage(noteOn(60, 64, 1));

    expect(bindings.has("slotA")).toBe(false);
    expect(bindings.has("slotB")).toBe(true);
    expect(conflict?.previousSlotId).toBe("slotA");
  });

  it("note binding does not conflict with CC binding", () => {
    const { config } = makeConfig({
      initialBindings: [
        { slotId: "slotA", source: { kind: "cc", channel: 1, controller: 60 } },
      ],
    });
    const ctrl = createMidiLearnController(config);

    ctrl.startSingle("slotB");
    const conflict = ctrl.handleMessage(noteOn(60, 64, 1)); // note 60 ≠ CC 60

    expect(conflict).toBeNull();
  });

  it("conflict resolution works in batch mode", () => {
    const { config, bindings } = makeConfig({
      initialBindings: [
        { slotId: "slotA", source: { kind: "cc", channel: 1, controller: 74 } },
      ],
    });
    const ctrl = createMidiLearnController(config);

    ctrl.startBatch(["slotB"]);
    const conflict = ctrl.handleMessage(cc(74, 64, 1));

    expect(bindings.has("slotA")).toBe(false);
    expect(bindings.has("slotB")).toBe(true);
    expect(conflict?.previousSlotId).toBe("slotA");
    expect(ctrl.state).toEqual({ mode: "idle" });
  });
});

// ── Channel scope (§5.11) ─────────────────────────────────────────────────────

describe("channel scope", () => {
  it('"specific" captures the channel from the message (default)', () => {
    const { config, bindings } = makeConfig({ channelScopeDefault: "specific" });
    const ctrl = createMidiLearnController(config);

    ctrl.startSingle("s1");
    ctrl.handleMessage(cc(74, 64, 5));

    expect(bindings.get("s1")?.source).toEqual({
      kind: "cc", channel: 5, controller: 74,
    });
  });

  it('"any" ignores the channel from the message', () => {
    const { config, bindings } = makeConfig({ channelScopeDefault: "any" });
    const ctrl = createMidiLearnController(config);

    ctrl.startSingle("s1");
    ctrl.handleMessage(cc(74, 64, 5));

    expect(bindings.get("s1")?.source).toEqual({
      kind: "cc", channel: "any", controller: 74,
    });
  });

  it('"any" scope on note-on produces any-channel note binding', () => {
    const { config, bindings } = makeConfig({ channelScopeDefault: "any" });
    const ctrl = createMidiLearnController(config);

    ctrl.startSingle("s1");
    ctrl.handleMessage(noteOn(60, 100, 3));

    expect(bindings.get("s1")?.source).toEqual({
      kind: "note", channel: "any", note: 60, mode: "velocity",
    });
  });
});

// ── Note-on binding (§5.7) ────────────────────────────────────────────────────

describe("note-on binding", () => {
  it("creates a note binding with velocity mode", () => {
    const { config, bindings } = makeConfig();
    const ctrl = createMidiLearnController(config);

    ctrl.startSingle("s1");
    ctrl.handleMessage(noteOn(48, 100, 2));

    expect(bindings.get("s1")?.source).toEqual({
      kind: "note", channel: 2, note: 48, mode: "velocity",
    });
  });
});

// ── Ignored message kinds ─────────────────────────────────────────────────────

describe("ignored message kinds", () => {
  let ctrl: MidiLearnController;
  let bindings: Map<string, MidiBinding>;

  beforeEach(() => {
    const { config, bindings: b } = makeConfig();
    bindings = b;
    ctrl = createMidiLearnController(config);
  });

  it("note-off is ignored in single mode", () => {
    ctrl.startSingle("s1");
    ctrl.handleMessage(noteOff(60));
    expect(ctrl.state).toEqual({ mode: "single", slotId: "s1" });
    expect(bindings.size).toBe(0);
  });

  it("note-off is ignored in batch mode", () => {
    ctrl.startBatch(["a", "b"]);
    ctrl.handleMessage(noteOff(60));
    expect(ctrl.state).toEqual({ mode: "batch", slotIds: ["a", "b"], index: 0 });
    expect(bindings.size).toBe(0);
  });

  it("messages are ignored in idle mode", () => {
    const result = ctrl.handleMessage(cc(74));
    expect(result).toBeNull();
    expect(bindings.size).toBe(0);
  });
});

// ── State change callbacks ────────────────────────────────────────────────────

describe("state change callbacks", () => {
  it("fires callback on startSingle", () => {
    const { config } = makeConfig();
    const ctrl = createMidiLearnController(config);
    const handler = vi.fn();
    ctrl.onStateChanged(handler);

    ctrl.startSingle("s1");
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ mode: "single", slotId: "s1" });
  });

  it("fires callback on startBatch", () => {
    const { config } = makeConfig();
    const ctrl = createMidiLearnController(config);
    const handler = vi.fn();
    ctrl.onStateChanged(handler);

    ctrl.startBatch(["a", "b"]);
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ mode: "batch", slotIds: ["a", "b"], index: 0 });
  });

  it("fires callback on cancel", () => {
    const { config } = makeConfig();
    const ctrl = createMidiLearnController(config);
    ctrl.startSingle("s1");

    const handler = vi.fn();
    ctrl.onStateChanged(handler);
    ctrl.cancel();

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ mode: "idle" });
  });

  it("fires callback on handleMessage in single mode", () => {
    const { config } = makeConfig();
    const ctrl = createMidiLearnController(config);
    ctrl.startSingle("s1");

    const handler = vi.fn();
    ctrl.onStateChanged(handler);
    ctrl.handleMessage(cc(74));

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ mode: "idle" });
  });

  it("fires callback on each advance in batch mode", () => {
    const { config } = makeConfig();
    const ctrl = createMidiLearnController(config);
    ctrl.startBatch(["a", "b"]);

    const states: MidiLearnState[] = [];
    ctrl.onStateChanged((s) => states.push(s));

    ctrl.handleMessage(cc(1)); // a → advance to index 1
    ctrl.handleMessage(cc(2)); // b → idle

    expect(states).toHaveLength(2);
    expect(states[0]).toEqual({ mode: "batch", slotIds: ["a", "b"], index: 1 });
    expect(states[1]).toEqual({ mode: "idle" });
  });

  it("fires callback on skip", () => {
    const { config } = makeConfig();
    const ctrl = createMidiLearnController(config);
    ctrl.startBatch(["a", "b"]);

    const handler = vi.fn();
    ctrl.onStateChanged(handler);
    ctrl.skip();

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ mode: "batch", slotIds: ["a", "b"], index: 1 });
  });

  it("unsubscribe stops receiving callbacks", () => {
    const { config } = makeConfig();
    const ctrl = createMidiLearnController(config);
    const handler = vi.fn();
    const unsub = ctrl.onStateChanged(handler);

    unsub();
    ctrl.startSingle("s1");

    expect(handler).not.toHaveBeenCalled();
  });

  it("multiple subscribers all fire", () => {
    const { config } = makeConfig();
    const ctrl = createMidiLearnController(config);
    const h1 = vi.fn();
    const h2 = vi.fn();
    ctrl.onStateChanged(h1);
    ctrl.onStateChanged(h2);

    ctrl.startSingle("s1");
    expect(h1).toHaveBeenCalledOnce();
    expect(h2).toHaveBeenCalledOnce();
  });
});

// ── Import type check ─────────────────────────────────────────────────────────

// Verify MidiLearnState type is re-exported from contracts (used by the controller)
import type { MidiLearnState } from "../../contracts/midi.ts";
type _checkMidiLearnState = MidiLearnState; // used only for type check
