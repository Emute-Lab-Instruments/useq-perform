// src/effects/__tests__/midiInput.test.ts
//
// Unit tests for the Web MIDI input service.
//
// Web MIDI API is not available in jsdom; tests cover:
//   1. Pure MIDI byte parsing.
//   2. Service creation defaults.
//   3. Mocked navigator.requestMIDIAccess flow.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseMidiBytes,
  createMidiInputService,
} from "../midiInput.ts";
import type { MidiMessage } from "../../contracts/midi.ts";

// ── parseMidiBytes ─────────────────────────────────────────────────────────

describe("parseMidiBytes", () => {
  it("parses a CC message", () => {
    const msg = parseMidiBytes(new Uint8Array([0xb0, 7, 100]), "p1", 10);
    expect(msg).toEqual<MidiMessage>({
      kind: "cc",
      channel: 1,
      controller: 7,
      value: 100,
      portId: "p1",
      time: 10,
    });
  });

  it("parses a CC message on channel 10", () => {
    const msg = parseMidiBytes(new Uint8Array([0xb9, 11, 64]), "p2", 0);
    expect(msg).toEqual<MidiMessage>({
      kind: "cc",
      channel: 10,
      controller: 11,
      value: 64,
      portId: "p2",
      time: 0,
    });
  });

  it("parses a note-on message", () => {
    const msg = parseMidiBytes(new Uint8Array([0x91, 60, 127]), "p1", 5);
    expect(msg).toEqual<MidiMessage>({
      kind: "note-on",
      channel: 2,
      note: 60,
      velocity: 127,
      portId: "p1",
      time: 5,
    });
  });

  it("treats note-on with velocity 0 as note-off", () => {
    const msg = parseMidiBytes(new Uint8Array([0x90, 60, 0]), "p1", 5);
    expect(msg).toEqual<MidiMessage>({
      kind: "note-off",
      channel: 1,
      note: 60,
      velocity: 0,
      portId: "p1",
      time: 5,
    });
  });

  it("parses a note-off message", () => {
    const msg = parseMidiBytes(new Uint8Array([0x82, 60, 64]), "p1", 0);
    expect(msg).toEqual<MidiMessage>({
      kind: "note-off",
      channel: 3,
      note: 60,
      velocity: 64,
      portId: "p1",
      time: 0,
    });
  });

  it("returns null for a sysex byte", () => {
    const msg = parseMidiBytes(new Uint8Array([0xf0, 0x41, 0xf7]), "p1", 0);
    expect(msg).toBeNull();
  });

  it("returns null for a MIDI clock byte", () => {
    const msg = parseMidiBytes(new Uint8Array([0xf8]), "p1", 0);
    expect(msg).toBeNull();
  });

  it("returns null for an empty buffer", () => {
    const msg = parseMidiBytes(new Uint8Array([]), "p1", 0);
    expect(msg).toBeNull();
  });

  it("returns null for a single-byte buffer (no data bytes)", () => {
    const msg = parseMidiBytes(new Uint8Array([0xb0]), "p1", 0);
    // data[1] and data[2] will fall back to 0 — this is actually parseable
    // as CC controller=0 value=0. Length >= 2 check is on data.length.
    // 1 byte → length < 2 → null.
    expect(msg).toBeNull();
  });

  it("extracts channel 16 correctly", () => {
    const msg = parseMidiBytes(new Uint8Array([0xbf, 1, 127]), "p1", 0);
    expect(msg?.kind).toBe("cc");
    expect((msg as Extract<MidiMessage, { kind: "cc" }>).channel).toBe(16);
  });
});

// ── createMidiInputService defaults ───────────────────────────────────────

describe("createMidiInputService — initial state", () => {
  it("starts with permission 'unknown'", () => {
    const svc = createMidiInputService();
    expect(svc.permission).toBe("unknown");
    svc.dispose();
  });

  it("starts with an empty inputs list", () => {
    const svc = createMidiInputService();
    expect(svc.inputs).toEqual([]);
    svc.dispose();
  });
});

describe("createMidiInputService — unsupported browser", () => {
  let originalRequestMIDIAccess: typeof navigator.requestMIDIAccess | undefined;

  beforeEach(() => {
    originalRequestMIDIAccess = (navigator as Record<string, unknown>)
      .requestMIDIAccess as typeof navigator.requestMIDIAccess | undefined;
    // Remove the API to simulate an unsupported browser.
    delete (navigator as Record<string, unknown>).requestMIDIAccess;
  });

  afterEach(() => {
    if (originalRequestMIDIAccess !== undefined) {
      (navigator as Record<string, unknown>).requestMIDIAccess =
        originalRequestMIDIAccess;
    }
  });

  it("sets permission to 'unsupported' when requestMIDIAccess is absent", async () => {
    const svc = createMidiInputService();
    await svc.requestAccess();
    expect(svc.permission).toBe("unsupported");
    svc.dispose();
  });
});

// ── createMidiInputService — mocked MIDI access flow ──────────────────────

type MockMIDIInput = {
  id: string;
  name: string;
  manufacturer: string;
  state: "connected" | "disconnected";
  onmidimessage: ((event: Event) => void) | null;
};

function makeMockAccess(inputs: MockMIDIInput[]) {
  const inputsMap = new Map(inputs.map((i) => [i.id, i]));
  return {
    inputs: inputsMap,
    onstatechange: null as ((event: Event) => void) | null,
  };
}

describe("createMidiInputService — mocked requestMIDIAccess", () => {
  let originalRequestMIDIAccess: typeof navigator.requestMIDIAccess | undefined;

  afterEach(() => {
    if (originalRequestMIDIAccess !== undefined) {
      (navigator as Record<string, unknown>).requestMIDIAccess =
        originalRequestMIDIAccess;
    } else {
      delete (navigator as Record<string, unknown>).requestMIDIAccess;
    }
    vi.restoreAllMocks();
  });

  it("sets permission to 'granted' on success", async () => {
    const mockAccess = makeMockAccess([]);
    (navigator as Record<string, unknown>).requestMIDIAccess = vi
      .fn()
      .mockResolvedValue(mockAccess);

    const svc = createMidiInputService();
    await svc.requestAccess();
    expect(svc.permission).toBe("granted");
    svc.dispose();
  });

  it("enumerates connected inputs after grant", async () => {
    const mockInput: MockMIDIInput = {
      id: "port-1",
      name: "MIDI Fighter",
      manufacturer: "DJ TechTools",
      state: "connected",
      onmidimessage: null,
    };
    const mockAccess = makeMockAccess([mockInput]);
    (navigator as Record<string, unknown>).requestMIDIAccess = vi
      .fn()
      .mockResolvedValue(mockAccess);

    const svc = createMidiInputService();
    await svc.requestAccess();

    expect(svc.inputs).toHaveLength(1);
    expect(svc.inputs[0]).toMatchObject({
      id: "port-1",
      name: "MIDI Fighter",
      manufacturer: "DJ TechTools",
      state: "connected",
      enabled: true,
    });
    svc.dispose();
  });

  it("sets permission to 'denied' when requestMIDIAccess rejects", async () => {
    (navigator as Record<string, unknown>).requestMIDIAccess = vi
      .fn()
      .mockRejectedValue(new DOMException("Permission denied", "NotAllowedError"));

    const svc = createMidiInputService();
    await svc.requestAccess();
    expect(svc.permission).toBe("denied");
    svc.dispose();
  });

  it("fires permission change callbacks", async () => {
    const mockAccess = makeMockAccess([]);
    (navigator as Record<string, unknown>).requestMIDIAccess = vi
      .fn()
      .mockResolvedValue(mockAccess);

    const svc = createMidiInputService();
    const states: string[] = [];
    svc.onPermissionChanged((s) => states.push(s));
    await svc.requestAccess();

    expect(states).toEqual(["granted"]);
    svc.dispose();
  });

  it("fires device change callback when inputs are enumerated", async () => {
    const mockInput: MockMIDIInput = {
      id: "port-2",
      name: "Keystep",
      manufacturer: "Arturia",
      state: "connected",
      onmidimessage: null,
    };
    const mockAccess = makeMockAccess([mockInput]);
    (navigator as Record<string, unknown>).requestMIDIAccess = vi
      .fn()
      .mockResolvedValue(mockAccess);

    const svc = createMidiInputService();
    const deviceSnapshots: number[] = [];
    svc.onDevicesChanged((inputs) => deviceSnapshots.push(inputs.length));
    await svc.requestAccess();

    expect(deviceSnapshots).toContain(1);
    svc.dispose();
  });

  it("attaches onmidimessage to connected + enabled inputs", async () => {
    const mockInput: MockMIDIInput = {
      id: "port-3",
      name: "nanoKONTROL",
      manufacturer: "KORG",
      state: "connected",
      onmidimessage: null,
    };
    const mockAccess = makeMockAccess([mockInput]);
    (navigator as Record<string, unknown>).requestMIDIAccess = vi
      .fn()
      .mockResolvedValue(mockAccess);

    const svc = createMidiInputService();
    await svc.requestAccess();

    // The service should have attached an onmidimessage handler.
    expect(mockInput.onmidimessage).toBeTypeOf("function");
    svc.dispose();
  });

  it("delivers parsed CC messages via onMessage", async () => {
    const mockInput: MockMIDIInput = {
      id: "port-4",
      name: "nanoKONTROL",
      manufacturer: "KORG",
      state: "connected",
      onmidimessage: null,
    };
    const mockAccess = makeMockAccess([mockInput]);
    (navigator as Record<string, unknown>).requestMIDIAccess = vi
      .fn()
      .mockResolvedValue(mockAccess);

    const svc = createMidiInputService();
    await svc.requestAccess();

    const received: MidiMessage[] = [];
    svc.onMessage((msg) => received.push(msg));

    // Simulate a MIDI message event.
    const fakeEvent = {
      data: new Uint8Array([0xb0, 7, 100]),
      timeStamp: 42,
    } as unknown as MIDIMessageEvent;
    mockInput.onmidimessage!(fakeEvent);

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual<MidiMessage>({
      kind: "cc",
      channel: 1,
      controller: 7,
      value: 100,
      portId: "port-4",
      time: 42,
    });
    svc.dispose();
  });

  it("does not deliver messages from disabled inputs", async () => {
    const mockInput: MockMIDIInput = {
      id: "port-5",
      name: "Launchpad",
      manufacturer: "Novation",
      state: "connected",
      onmidimessage: null,
    };
    const mockAccess = makeMockAccess([mockInput]);
    (navigator as Record<string, unknown>).requestMIDIAccess = vi
      .fn()
      .mockResolvedValue(mockAccess);

    const svc = createMidiInputService();
    await svc.requestAccess();

    // Disable the input — this should detach the listener.
    svc.setInputEnabled("port-5", false);

    expect(mockInput.onmidimessage).toBeNull();
    svc.dispose();
  });

  it("returns an unsubscribe function from onMessage", async () => {
    const mockAccess = makeMockAccess([]);
    (navigator as Record<string, unknown>).requestMIDIAccess = vi
      .fn()
      .mockResolvedValue(mockAccess);

    const svc = createMidiInputService();
    await svc.requestAccess();

    const received: MidiMessage[] = [];
    const unsub = svc.onMessage((msg) => received.push(msg));
    unsub();

    // No message should arrive after unsubscribing.
    // (There are no inputs to fire messages anyway, just verify no throw.)
    expect(received).toHaveLength(0);
    svc.dispose();
  });

  it("dispose removes all listeners", async () => {
    const mockInput: MockMIDIInput = {
      id: "port-6",
      name: "KeyLab",
      manufacturer: "Arturia",
      state: "connected",
      onmidimessage: null,
    };
    const mockAccess = makeMockAccess([mockInput]);
    (navigator as Record<string, unknown>).requestMIDIAccess = vi
      .fn()
      .mockResolvedValue(mockAccess);

    const svc = createMidiInputService();
    await svc.requestAccess();
    svc.dispose();

    expect(mockInput.onmidimessage).toBeNull();
    expect(mockAccess.onstatechange).toBeNull();
  });
});
