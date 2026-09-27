import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GeneralSettings } from "./GeneralSettings";
import { midiInput } from "../../effects/liveEditMidiRuntime.ts";
import type { MidiInputService } from "../../effects/midiInput.ts";
import type { MidiInputDescriptor } from "../../contracts/midi.ts";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ── Web MIDI stubs (jsdom has no Web MIDI) ────────────────────────────────

function makeMidiPort(id: string, name: string, manufacturer: string) {
  return { id, name, manufacturer, state: "connected", onmidimessage: null };
}

function makeMidiAccess(ports: ReturnType<typeof makeMidiPort>[]) {
  return {
    inputs: new Map(ports.map((p) => [p.id, p])),
    onstatechange: null,
  };
}

function stubRequestMidiAccess(access: ReturnType<typeof makeMidiAccess>): void {
  Object.defineProperty(window.navigator, "requestMIDIAccess", {
    configurable: true,
    value: vi.fn(async () => access),
  });
}

function unstubRequestMidiAccess(): void {
  delete (window.navigator as unknown as Record<string, unknown>).requestMIDIAccess;
}

/** The checkbox inside the MIDI section's device row labelled `deviceName`. */
function midiDeviceCheckbox(deviceName: string): HTMLInputElement {
  const section = screen.getByText("MIDI Input").closest(".panel-section");
  if (!section) throw new Error("MIDI section not found");
  const row = Array.from(section.querySelectorAll(".panel-row")).find(
    (r) => r.querySelector(".panel-label")?.textContent === deviceName,
  );
  if (!row) throw new Error(`device row for ${deviceName} not found`);
  const input = row.querySelector<HTMLInputElement>("input[type=checkbox]");
  if (!input) throw new Error(`checkbox for ${deviceName} not found`);
  return input;
}

// ── Production wiring (live-edit.md §5.6) ──────────────────────────────────

describe("GeneralSettings MIDI section", () => {
  it("renders MIDI settings wired to the production liveEditMidiRuntime singleton", async () => {
    stubRequestMidiAccess(
      makeMidiAccess([
        makeMidiPort("lcxl", "Launch Control XL", "Novation"),
        makeMidiPort("mpk", "MPK Mini Mk3", "Akai"),
      ]),
    );

    // Bare render — GeneralSettings must default to the real singleton.
    render(() => <GeneralSettings />);

    // The section exists and reflects the real singleton's initial state.
    expect(screen.getByText("MIDI Input")).toBeTruthy();
    expect(midiInput.permission).toBe("unknown");
    expect(screen.getByRole("button", { name: "Request MIDI access" })).toBeTruthy();

    // The request goes through the real service into the browser API.
    fireEvent.click(screen.getByRole("button", { name: "Request MIDI access" }));
    await vi.waitFor(() => expect(midiInput.permission).toBe("granted"));

    // The real service enumerated the devices into the section.
    expect(screen.getByText("Launch Control XL")).toBeTruthy();
    expect(screen.getByText("MPK Mini Mk3")).toBeTruthy();

    // Device toggles flow back into the real singleton.
    fireEvent.click(midiDeviceCheckbox("Launch Control XL"));
    expect(midiInput.inputs.find((d) => d.id === "lcxl")?.enabled).toBe(false);
    expect(midiInput.inputs.find((d) => d.id === "mpk")?.enabled).toBe(true);

    unstubRequestMidiAccess();
  });

  it("accepts an injected MidiInputService (tests/stories override the singleton)", () => {
    const setInputEnabled = vi.fn();
    const device: MidiInputDescriptor = {
      id: "fake-1",
      name: "Fake Controller",
      manufacturer: "TestCo",
      state: "connected",
      enabled: true,
    };
    const fake = {
      permission: "granted",
      inputs: [device],
      requestAccess: vi.fn(async () => {}),
      setInputEnabled,
      onMessage: vi.fn(() => () => {}),
      onDevicesChanged: vi.fn(() => () => {}),
      onPermissionChanged: vi.fn(() => () => {}),
      dispose: vi.fn(),
    } as unknown as MidiInputService;

    render(() => <GeneralSettings midiInput={fake} />);

    // Injected service state drives the section directly (no permission CTA).
    expect(screen.getByText("Fake Controller")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Request MIDI access" })).toBeNull();

    const checkbox = screen
      .getByText("Fake Controller")
      .closest(".panel-row")!
      .querySelector<HTMLInputElement>("input[type=checkbox]")!;
    expect(checkbox.checked).toBe(true);
    fireEvent.click(checkbox);
    expect(setInputEnabled).toHaveBeenCalledWith("fake-1", false);
  });
});
