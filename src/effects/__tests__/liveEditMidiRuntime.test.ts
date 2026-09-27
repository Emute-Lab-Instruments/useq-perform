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
});
