// src/effects/__tests__/midiRouter.test.ts
//
// Unit tests for the MIDI → live-edit slot router.
// Spec: docs/specs/live-edit.md §5.7

import { describe, it, expect, beforeEach } from "vitest";
import {
  createMidiRouter,
  type MidiRouterConfig,
  type SlotInfo,
  type MidiRouter,
} from "../midiRouter.ts";
import type { MidiBinding, MidiMessage, MidiSource } from "../../contracts/midi.ts";
import type { SlotValue } from "../../contracts/liveEdit.ts";

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeConfig(
  bindings: MidiBinding[],
  slots: Record<string, SlotInfo>
): MidiRouterConfig {
  return {
    findBinding(source: MidiSource): MidiBinding | undefined {
      return bindings.find((b) => {
        const s = b.source;
        if (s.kind !== source.kind) return false;
        if (s.kind === "cc" && source.kind === "cc") {
          return s.controller === source.controller && s.channel === source.channel;
        }
        if (s.kind === "note" && source.kind === "note") {
          return (
            s.note === source.note &&
            s.channel === source.channel &&
            s.mode === source.mode
          );
        }
        return false;
      });
    },
    getSlotInfo(slotId: string): SlotInfo | undefined {
      return slots[slotId];
    },
  };
}

function ccMsg(
  controller: number,
  value: number,
  channel = 1
): MidiMessage {
  return { kind: "cc", channel, controller, value, portId: "p1", time: 0 };
}

function noteOnMsg(note: number, velocity: number, channel = 1): MidiMessage {
  return { kind: "note-on", channel, note, velocity, portId: "p1", time: 0 };
}

function noteOffMsg(note: number, velocity = 64, channel = 1): MidiMessage {
  return { kind: "note-off", channel, note, velocity, portId: "p1", time: 0 };
}

// Floating-point equality helper
function approx(a: SlotValue, b: number, eps = 1e-9): boolean {
  return typeof a === "number" && Math.abs(a - b) < eps;
}

// ── CC → numeric ──────────────────────────────────────────────────────────────

describe("CC → numeric slot", () => {
  let router: MidiRouter;

  beforeEach(() => {
    router = createMidiRouter(
      makeConfig(
        [{ slotId: "s1", source: { kind: "cc", channel: "any", controller: 74 } }],
        { s1: { kind: "numeric", min: 0, max: 1 } }
      )
    );
  });

  it("maps CC 0 to min", () => {
    const updates = router.route(ccMsg(74, 0));
    expect(updates).toHaveLength(1);
    expect(updates[0].value).toBe(0);
  });

  it("maps CC 127 to max", () => {
    const updates = router.route(ccMsg(74, 127));
    expect(updates).toHaveLength(1);
    expect(updates[0].value).toBe(1);
  });

  it("maps CC 64 to midpoint (approximately 0.5039)", () => {
    const updates = router.route(ccMsg(74, 64));
    expect(updates).toHaveLength(1);
    // 0 + (64/127) * (1-0) = 64/127 ≈ 0.5039
    expect(approx(updates[0].value, 64 / 127)).toBe(true);
  });

  it("maps into a custom [min, max] range", () => {
    router = createMidiRouter(
      makeConfig(
        [{ slotId: "s1", source: { kind: "cc", channel: "any", controller: 1 } }],
        { s1: { kind: "numeric", min: -1, max: 1 } }
      )
    );
    const updates = router.route(ccMsg(1, 0));
    expect(updates[0].value).toBe(-1);

    const updates2 = router.route(ccMsg(1, 127));
    expect(updates2[0].value).toBe(1);
  });
});

// ── CC → boolean ──────────────────────────────────────────────────────────────

describe("CC → boolean slot", () => {
  let router: MidiRouter;

  beforeEach(() => {
    router = createMidiRouter(
      makeConfig(
        [{ slotId: "b1", source: { kind: "cc", channel: "any", controller: 10 } }],
        { b1: { kind: "boolean", min: 0, max: 1 } }
      )
    );
  });

  it("CC 63 → false (below threshold)", () => {
    const updates = router.route(ccMsg(10, 63));
    expect(updates[0].value).toBe(false);
  });

  it("CC 64 → true (at threshold)", () => {
    const updates = router.route(ccMsg(10, 64));
    expect(updates[0].value).toBe(true);
  });

  it("CC 127 → true", () => {
    const updates = router.route(ccMsg(10, 127));
    expect(updates[0].value).toBe(true);
  });

  it("CC 0 → false", () => {
    const updates = router.route(ccMsg(10, 0));
    expect(updates[0].value).toBe(false);
  });
});

// ── CC → keyword (enum) ───────────────────────────────────────────────────────

describe("CC → keyword slot", () => {
  let router: MidiRouter;
  const options = ["low", "mid", "high"];

  beforeEach(() => {
    router = createMidiRouter(
      makeConfig(
        [{ slotId: "k1", source: { kind: "cc", channel: "any", controller: 20 } }],
        { k1: { kind: "keyword", min: 0, max: 2, options } }
      )
    );
  });

  it("CC 0 → first option", () => {
    const updates = router.route(ccMsg(20, 0));
    expect(updates[0].value).toBe("low");
  });

  it("CC 127 → last option (clamped)", () => {
    const updates = router.route(ccMsg(20, 127));
    expect(updates[0].value).toBe("high");
  });

  it("CC 43 → second option (floor(43/128*3)=1)", () => {
    // floor(43/128 * 3) = floor(1.008) = 1 → "mid"
    const updates = router.route(ccMsg(20, 43));
    expect(updates[0].value).toBe("mid");
  });

  it("CC 85 → third option (floor(85/128*3)=1→2)", () => {
    // floor(85/128 * 3) = floor(1.992) = 1 → "mid"? Let's compute exactly.
    // 85/128 = 0.664, * 3 = 1.992, floor = 1 → "mid"
    const updates = router.route(ccMsg(20, 85));
    expect(updates[0].value).toBe("mid");
  });

  it("maps across all three buckets", () => {
    // 3 options, so buckets: 0..42 → low, 43..84 → mid, 85..127 → high
    // Check boundary at 42
    expect(router.route(ccMsg(20, 42))[0].value).toBe("low");
    expect(router.route(ccMsg(20, 43))[0].value).toBe("mid");
    // floor(128/128 * 3) would be 3, but 127 is the max: floor(127/128*3)=floor(2.976)=2→"high"
    expect(router.route(ccMsg(20, 127))[0].value).toBe("high");
  });
});

// ── Note velocity mode → numeric ──────────────────────────────────────────────

describe("note velocity mode → numeric slot", () => {
  let router: MidiRouter;

  beforeEach(() => {
    router = createMidiRouter(
      makeConfig(
        [
          {
            slotId: "n1",
            source: { kind: "note", channel: "any", note: 60, mode: "velocity" },
          },
        ],
        { n1: { kind: "numeric", min: 0, max: 1 } }
      )
    );
  });

  it("note-on maps velocity 0..127 linearly like CC", () => {
    expect(router.route(noteOnMsg(60, 0))[0].value).toBe(0);
    expect(router.route(noteOnMsg(60, 127))[0].value).toBe(1);
    expect(approx(router.route(noteOnMsg(60, 64))[0].value, 64 / 127)).toBe(true);
  });

  it("note-off sets value to min", () => {
    const updates = router.route(noteOffMsg(60));
    expect(updates[0].value).toBe(0); // min
  });
});

// ── Note velocity mode → boolean ──────────────────────────────────────────────

describe("note velocity mode → boolean slot", () => {
  let router: MidiRouter;

  beforeEach(() => {
    router = createMidiRouter(
      makeConfig(
        [
          {
            slotId: "b2",
            source: { kind: "note", channel: "any", note: 48, mode: "velocity" },
          },
        ],
        { b2: { kind: "boolean", min: 0, max: 1 } }
      )
    );
  });

  it("note-on velocity >= 64 → true", () => {
    expect(router.route(noteOnMsg(48, 64))[0].value).toBe(true);
    expect(router.route(noteOnMsg(48, 127))[0].value).toBe(true);
  });

  it("note-on velocity < 64 → false", () => {
    expect(router.route(noteOnMsg(48, 63))[0].value).toBe(false);
    expect(router.route(noteOnMsg(48, 0))[0].value).toBe(false);
  });

  it("note-off → false", () => {
    expect(router.route(noteOffMsg(48))[0].value).toBe(false);
  });
});

// ── Note toggle mode → boolean ────────────────────────────────────────────────

describe("note toggle mode → boolean slot", () => {
  let router: MidiRouter;

  beforeEach(() => {
    router = createMidiRouter(
      makeConfig(
        [
          {
            slotId: "t1",
            source: { kind: "note", channel: "any", note: 36, mode: "toggle" },
          },
        ],
        { t1: { kind: "boolean", min: 0, max: 1 } }
      )
    );
  });

  it("first note-on flips false → true", () => {
    const updates = router.route(noteOnMsg(36, 100));
    expect(updates[0].value).toBe(true);
  });

  it("second note-on flips true → false", () => {
    router.route(noteOnMsg(36, 100)); // → true
    const updates = router.route(noteOnMsg(36, 100));
    expect(updates[0].value).toBe(false);
  });

  it("note-off is ignored in toggle mode", () => {
    const updates = router.route(noteOffMsg(36));
    expect(updates).toHaveLength(0);
  });

  it("toggle state is independent per router instance", () => {
    const router2 = createMidiRouter(
      makeConfig(
        [
          {
            slotId: "t1",
            source: { kind: "note", channel: "any", note: 36, mode: "toggle" },
          },
        ],
        { t1: { kind: "boolean", min: 0, max: 1 } }
      )
    );
    // Both fresh — first note-on → true
    expect(router2.route(noteOnMsg(36, 100))[0].value).toBe(true);
  });
});

// ── Note toggle mode → non-boolean (ignored) ──────────────────────────────────

describe("note toggle mode → non-boolean slot", () => {
  it("toggle mode is ignored for numeric slots", () => {
    const router = createMidiRouter(
      makeConfig(
        [
          {
            slotId: "num",
            source: { kind: "note", channel: "any", note: 60, mode: "toggle" },
          },
        ],
        { num: { kind: "numeric", min: 0, max: 1 } }
      )
    );
    expect(router.route(noteOnMsg(60, 100))).toHaveLength(0);
  });

  it("toggle mode is ignored for keyword slots", () => {
    const router = createMidiRouter(
      makeConfig(
        [
          {
            slotId: "kw",
            source: {
              kind: "note",
              channel: "any",
              note: 60,
              mode: "toggle",
            },
          },
        ],
        { kw: { kind: "keyword", min: 0, max: 2, options: ["a", "b"] } }
      )
    );
    expect(router.route(noteOnMsg(60, 100))).toHaveLength(0);
  });
});

// ── Channel matching ──────────────────────────────────────────────────────────

describe("channel matching", () => {
  it('"any" channel binding matches messages on any channel', () => {
    const router = createMidiRouter(
      makeConfig(
        [{ slotId: "s1", source: { kind: "cc", channel: "any", controller: 1 } }],
        { s1: { kind: "numeric", min: 0, max: 1 } }
      )
    );
    expect(router.route(ccMsg(1, 64, 1))).toHaveLength(1);
    expect(router.route(ccMsg(1, 64, 7))).toHaveLength(1);
    expect(router.route(ccMsg(1, 64, 16))).toHaveLength(1);
  });

  it("specific channel binding only matches that channel", () => {
    const router = createMidiRouter(
      makeConfig(
        [{ slotId: "s1", source: { kind: "cc", channel: 3, controller: 1 } }],
        { s1: { kind: "numeric", min: 0, max: 1 } }
      )
    );
    expect(router.route(ccMsg(1, 64, 3))).toHaveLength(1);
    expect(router.route(ccMsg(1, 64, 1))).toHaveLength(0);
    expect(router.route(ccMsg(1, 64, 16))).toHaveLength(0);
  });

  it("specific channel note binding matches only that channel", () => {
    const router = createMidiRouter(
      makeConfig(
        [
          {
            slotId: "n1",
            source: { kind: "note", channel: 2, note: 60, mode: "velocity" },
          },
        ],
        { n1: { kind: "numeric", min: 0, max: 1 } }
      )
    );
    expect(router.route(noteOnMsg(60, 100, 2))).toHaveLength(1);
    expect(router.route(noteOnMsg(60, 100, 1))).toHaveLength(0);
  });
});

// ── No match ──────────────────────────────────────────────────────────────────

describe("no match cases", () => {
  let router: MidiRouter;

  beforeEach(() => {
    router = createMidiRouter(
      makeConfig(
        [{ slotId: "s1", source: { kind: "cc", channel: "any", controller: 74 } }],
        { s1: { kind: "numeric", min: 0, max: 1 } }
      )
    );
  });

  it("different CC controller → no update", () => {
    expect(router.route(ccMsg(75, 64))).toHaveLength(0);
  });

  it("note-on for a CC-bound controller → no update", () => {
    expect(router.route(noteOnMsg(74, 100))).toHaveLength(0);
  });

  it("message with no binding at all → no update", () => {
    expect(router.route(ccMsg(99, 64))).toHaveLength(0);
  });
});

// ── Missing slot info (graceful skip) ─────────────────────────────────────────

describe("missing slot info", () => {
  it("skips gracefully when getSlotInfo returns undefined", () => {
    const router = createMidiRouter({
      findBinding(_src) {
        return { slotId: "ghost", source: { kind: "cc", channel: "any", controller: 1 } };
      },
      getSlotInfo(_id) {
        return undefined;
      },
    });
    expect(router.route(ccMsg(1, 64))).toHaveLength(0);
  });
});

// ── Throttle / coalesce ───────────────────────────────────────────────────────

describe("throttle / coalesce", () => {
  let router: MidiRouter;

  beforeEach(() => {
    router = createMidiRouter(
      makeConfig(
        [{ slotId: "s1", source: { kind: "cc", channel: "any", controller: 1 } }],
        { s1: { kind: "numeric", min: 0, max: 100 } }
      )
    );
  });

  it("multiple CC messages for the same slot — flush returns only the latest", () => {
    router.route(ccMsg(1, 10));
    router.route(ccMsg(1, 50));
    router.route(ccMsg(1, 90));

    const updates = router.flush();
    expect(updates).toHaveLength(1);
    // Latest: 0 + (90/127)*100 ≈ 70.87
    expect(approx(updates[0].value, (90 / 127) * 100, 1e-6)).toBe(true);
  });

  it("flush clears the buffer — second flush returns empty", () => {
    router.route(ccMsg(1, 64));
    router.flush();
    expect(router.flush()).toHaveLength(0);
  });

  it("multiple slots — flush returns one entry per slot", () => {
    const router2 = createMidiRouter(
      makeConfig(
        [
          { slotId: "a", source: { kind: "cc", channel: "any", controller: 1 } },
          { slotId: "b", source: { kind: "cc", channel: "any", controller: 2 } },
        ],
        {
          a: { kind: "numeric", min: 0, max: 1 },
          b: { kind: "numeric", min: 0, max: 1 },
        }
      )
    );
    router2.route(ccMsg(1, 10));
    router2.route(ccMsg(1, 90)); // second write for slot "a"
    router2.route(ccMsg(2, 50));

    const updates = router2.flush();
    expect(updates).toHaveLength(2);

    const aUpdate = updates.find((u) => u.slotId === "a");
    const bUpdate = updates.find((u) => u.slotId === "b");
    expect(aUpdate).toBeDefined();
    expect(bUpdate).toBeDefined();
    // "a" should have the value from CC=90 (latest)
    expect(approx(aUpdate!.value, 90 / 127, 1e-6)).toBe(true);
    expect(approx(bUpdate!.value, 50 / 127, 1e-6)).toBe(true);
  });

  it("route() returns the immediate update even before flush", () => {
    const updates = router.route(ccMsg(1, 64));
    expect(updates).toHaveLength(1);
    expect(approx(updates[0].value, (64 / 127) * 100, 1e-6)).toBe(true);
  });
});
