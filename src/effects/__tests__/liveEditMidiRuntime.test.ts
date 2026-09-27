import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  messageHandler: undefined as undefined | ((message: never) => void),
  values: [] as Array<[string, number | boolean | string]>,
  bindings: {} as Record<string, { kind: "cc"; channel: number | "any"; controller: number }>,
  slot: { id: "gain", kind: "numeric" as const, min: 0, max: 1, options: undefined },
}));

vi.mock("../midiInput.ts", () => ({
  createMidiInputService: () => ({
    permission: "unknown", inputs: [], requestAccess: vi.fn(async () => {}),
    setInputEnabled: vi.fn(), onMessage(handler: (message: never) => void) { harness.messageHandler = handler; return () => { harness.messageHandler = undefined; }; },
    onDevicesChanged: vi.fn(() => () => {}), onPermissionChanged: vi.fn(() => () => {}), dispose: vi.fn(),
  }),
}));
vi.mock("../liveEditRuntime.ts", () => ({
  liveEditStore: { getSlot: (id: string) => id === "gain" ? harness.slot : undefined },
  liveEditPersistence: {
    load: () => ({ midiBindings: harness.bindings }),
    saveBinding: (id: string, source: typeof harness.bindings[string]) => { harness.bindings[id] = source; },
    removeBinding: (id: string) => { delete harness.bindings[id]; },
  },
  liveEditOnValueChange: (id: string, value: number | boolean | string) => { harness.values.push([id, value]); },
}));

import { toastChannel, type ToastEvent } from "../../contracts/toastChannels.ts";
import { midiInput, midiLearnController, startLiveEditMidiRuntime } from "../liveEditMidiRuntime.ts";

describe("production live-edit MIDI wiring", () => {
  beforeEach(() => {
    harness.messageHandler = undefined;
    harness.values = [];
    harness.bindings = {};
  });

  it("learns a CC into persistence and routes its next value through liveEditOnValueChange", () => {
    const stop = startLiveEditMidiRuntime();
    midiLearnController.startSingle("gain");
    harness.messageHandler?.({ kind: "cc", channel: 2, controller: 74, value: 127, portId: "midi-1", time: 1 } as never);

    expect(harness.bindings.gain).toEqual({ kind: "cc", channel: 2, controller: 74 });
    expect(harness.values).toEqual([["gain", 1]]);
    expect(midiInput.permission).toBe("unknown");
    stop();
  });

  it("surfaces a binding conflict as a toast with a working Undo (live-edit.md §5.10)", () => {
    const toasts: ToastEvent[] = [];
    const unsubToasts = toastChannel.subscribe((event) => toasts.push(event));
    const stop = startLiveEditMidiRuntime();

    // First learn binds CC74 (channel 2) into "gain" — no conflict, no toast.
    midiLearnController.startSingle("gain");
    harness.messageHandler?.({ kind: "cc", channel: 2, controller: 74, value: 127, portId: "midi-1", time: 1 } as never);
    expect(toasts).toHaveLength(0);

    // Learning the same source into another slot moves the binding and
    // publishes the §5.10 conflict toast with an Undo action.
    midiLearnController.startSingle("other");
    harness.messageHandler?.({ kind: "cc", channel: 2, controller: 74, value: 100, portId: "midi-1", time: 2 } as never);
    expect(toasts).toHaveLength(1);
    expect(toasts[0].message).toContain("CC74 moved from `gain` to `other`");
    expect(toasts[0].durationMs).toBe(6000);
    expect(toasts[0].action?.label).toBe("Undo");
    expect(harness.bindings.gain).toBeUndefined();
    expect(harness.bindings.other).toEqual({ kind: "cc", channel: 2, controller: 74 });

    // Undo reverts both bindings to the pre-bind state in one action.
    toasts[0].action!.run();
    expect(harness.bindings.gain).toEqual({ kind: "cc", channel: 2, controller: 74 });
    expect(harness.bindings.other).toBeUndefined();

    unsubToasts();
    stop();
  });

  it("conflict Undo restores the target slot's own prior binding", () => {
    const toasts: ToastEvent[] = [];
    const unsubToasts = toastChannel.subscribe((event) => toasts.push(event));
    harness.bindings["other"] = { kind: "cc", channel: 1, controller: 20 };
    const stop = startLiveEditMidiRuntime();

    midiLearnController.startSingle("gain");
    harness.messageHandler?.({ kind: "cc", channel: 2, controller: 74, value: 127, portId: "midi-1", time: 1 } as never);
    midiLearnController.startSingle("other");
    harness.messageHandler?.({ kind: "cc", channel: 2, controller: 74, value: 100, portId: "midi-1", time: 2 } as never);

    toasts[0].action!.run();
    expect(harness.bindings.gain).toEqual({ kind: "cc", channel: 2, controller: 74 });
    // "other" is restored to the CC20 binding it had before the learn.
    expect(harness.bindings.other).toEqual({ kind: "cc", channel: 1, controller: 20 });

    unsubToasts();
    stop();
  });
});
