// src/effects/midiInput.ts
//
// Web MIDI input service — device enumeration, permission handling, and
// message parsing.
//
// Spec: docs/specs/live-edit.md §5.6+ (MIDI binding model and learn flow).
// Input only. No MIDI out, no sysex, no clock.

import type {
  MidiInputDescriptor,
  MidiMessage,
  MidiPermissionState,
} from "../contracts/midi.ts";

// ── MIDI byte parsing ──────────────────────────────────────────────────────

/**
 * Parse a raw MIDI message event into a typed `MidiMessage`.
 * Returns `null` for unsupported status bytes (sysex, timing, etc.).
 *
 * Exported for unit testing.
 */
export function parseMidiBytes(
  data: Uint8Array,
  portId: string,
  time: number
): MidiMessage | null {
  if (data.length < 2) return null;

  const status = data[0];
  const type = status & 0xf0;
  const channel = (status & 0x0f) + 1; // MIDI channels are 1..16

  if (type === 0xb0) {
    // Control Change
    const controller = data[1] ?? 0;
    const value = data[2] ?? 0;
    return { kind: "cc", channel, controller, value, portId, time };
  }

  if (type === 0x90) {
    // Note On — but velocity 0 is treated as Note Off
    const note = data[1] ?? 0;
    const velocity = data[2] ?? 0;
    if (velocity === 0) {
      return { kind: "note-off", channel, note, velocity: 0, portId, time };
    }
    return { kind: "note-on", channel, note, velocity, portId, time };
  }

  if (type === 0x80) {
    // Note Off
    const note = data[1] ?? 0;
    const velocity = data[2] ?? 0;
    return { kind: "note-off", channel, note, velocity, portId, time };
  }

  return null;
}

// ── Service interface ──────────────────────────────────────────────────────

export interface MidiInputService {
  /** Current permission state. */
  readonly permission: MidiPermissionState;
  /** Currently known MIDI input devices. */
  readonly inputs: readonly MidiInputDescriptor[];

  /** Request MIDI access from the browser. Transitions permission state. */
  requestAccess(): Promise<void>;
  /** Toggle a device's enabled state. */
  setInputEnabled(portId: string, enabled: boolean): void;

  /** Subscribe to parsed MIDI messages from enabled inputs. */
  onMessage(handler: (msg: MidiMessage) => void): () => void;
  /** Subscribe to device list changes (plug/unplug/state change). */
  onDevicesChanged(
    handler: (inputs: readonly MidiInputDescriptor[]) => void
  ): () => void;
  /** Subscribe to permission state changes. */
  onPermissionChanged(handler: (state: MidiPermissionState) => void): () => void;

  /** Clean up all listeners. */
  dispose(): void;
}

// ── Factory ────────────────────────────────────────────────────────────────

export function createMidiInputService(): MidiInputService {
  let _permission: MidiPermissionState = "unknown";
  let _inputs: MidiInputDescriptor[] = [];

  // Per-device enable preferences, keyed by port id.
  // Persists across reconnects for the lifetime of the service.
  const _enabledPrefs = new Map<string, boolean>();

  const _messageHandlers = new Set<(msg: MidiMessage) => void>();
  const _devicesHandlers = new Set<
    (inputs: readonly MidiInputDescriptor[]) => void
  >();
  const _permissionHandlers = new Set<(state: MidiPermissionState) => void>();

  // The active MIDIAccess object, if granted.
  let _access: MIDIAccess | null = null;

  // ── Helpers ────────────────────────────────────────────────────────────

  function setPermission(state: MidiPermissionState) {
    if (_permission === state) return;
    _permission = state;
    for (const h of _permissionHandlers) h(state);
  }

  function notifyDevices() {
    const snapshot = _inputs.slice();
    for (const h of _devicesHandlers) h(snapshot);
  }

  function isEnabled(portId: string): boolean {
    // Default: enabled for newly-seen devices.
    return _enabledPrefs.get(portId) ?? true;
  }

  function handleMidiMessage(portId: string, event: Event) {
    if (_messageHandlers.size === 0) return;
    const me = event as MIDIMessageEvent;
    const data = me.data;
    if (!data || data.length === 0) return;
    const msg = parseMidiBytes(data, portId, me.timeStamp ?? 0);
    if (msg !== null) {
      for (const h of _messageHandlers) h(msg);
    }
  }

  function attachPortListener(port: MIDIInput) {
    // Remove any previous handler before re-attaching.
    port.onmidimessage = null;

    if (!isEnabled(port.id)) return;
    if (port.state !== "connected") return;

    port.onmidimessage = (event: Event) => handleMidiMessage(port.id, event);
  }

  function detachPortListener(port: MIDIInput) {
    port.onmidimessage = null;
  }

  function buildInputDescriptor(port: MIDIInput): MidiInputDescriptor {
    return {
      id: port.id,
      name: port.name ?? "",
      manufacturer: port.manufacturer ?? "",
      state: port.state === "connected" ? "connected" : "disconnected",
      enabled: isEnabled(port.id),
    };
  }

  function refreshInputList() {
    if (!_access) return;

    const descriptors: MidiInputDescriptor[] = [];
    _access.inputs.forEach((port) => {
      descriptors.push(buildInputDescriptor(port));
      attachPortListener(port);
    });
    _inputs = descriptors;
    notifyDevices();
  }

  function handleStateChange(_event: Event) {
    refreshInputList();
  }

  // ── Public interface ───────────────────────────────────────────────────

  return {
    get permission() {
      return _permission;
    },
    get inputs() {
      return _inputs;
    },

    async requestAccess(): Promise<void> {
      if (typeof navigator === "undefined" || !navigator.requestMIDIAccess) {
        setPermission("unsupported");
        return;
      }

      try {
        const access = await navigator.requestMIDIAccess({ sysex: false });
        _access = access;
        setPermission("granted");
        access.onstatechange = handleStateChange;
        refreshInputList();
      } catch {
        setPermission("denied");
      }
    },

    setInputEnabled(portId: string, enabled: boolean): void {
      _enabledPrefs.set(portId, enabled);

      // Update the descriptor in _inputs.
      _inputs = _inputs.map((d) =>
        d.id === portId ? { ...d, enabled } : d
      );

      // Re-attach or detach the port listener immediately.
      if (_access) {
        _access.inputs.forEach((port) => {
          if (port.id === portId) {
            if (enabled && port.state === "connected") {
              attachPortListener(port);
            } else {
              detachPortListener(port);
            }
          }
        });
      }

      notifyDevices();
    },

    onMessage(handler: (msg: MidiMessage) => void): () => void {
      _messageHandlers.add(handler);
      return () => _messageHandlers.delete(handler);
    },

    onDevicesChanged(
      handler: (inputs: readonly MidiInputDescriptor[]) => void
    ): () => void {
      _devicesHandlers.add(handler);
      return () => _devicesHandlers.delete(handler);
    },

    onPermissionChanged(
      handler: (state: MidiPermissionState) => void
    ): () => void {
      _permissionHandlers.add(handler);
      return () => _permissionHandlers.delete(handler);
    },

    dispose(): void {
      // Remove all onstatechange and onmidimessage listeners.
      if (_access) {
        _access.onstatechange = null;
        _access.inputs.forEach((port) => {
          port.onmidimessage = null;
        });
        _access = null;
      }
      _messageHandlers.clear();
      _devicesHandlers.clear();
      _permissionHandlers.clear();
      _inputs = [];
    },
  };
}
