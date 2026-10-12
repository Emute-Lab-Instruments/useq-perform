/**
 * Tests for the application-owned liveEditPanel component.
 *
 * Strategy: unit-test the adapter's dependency wiring without full SolidJS
 * rendering. The adapter's contract is that it correctly routes each callback
 * to the right store/persistence/controller method. We verify this by calling
 * those callbacks via spied or mocked dependencies.
 *
 * Full rendering smoke tests would require a browser environment with the
 * SolidJS JSX transform wired in; those are deferred to Storybook stories.
 */

import { render } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveEditStoreAPI } from "../../../effects/liveEditStore.ts";
import type { LiveEditPersistence, LiveEditPersistedData } from "../../../effects/liveEditPersistence.ts";
import type { MidiLearnController } from "../../../effects/midiLearnController.ts";
import type { MidiLearnState } from "../../../contracts/midi.ts";
import type { LiveEditSlot } from "../../../contracts/liveEdit.ts";
import type { MidiInputService } from "../../../effects/midiInput.ts";

// Mock LiveEditPanel to avoid full SolidJS rendering in the unit test project.
const liveEditPanel = vi.hoisted(() => vi.fn((_props: unknown) => null));
vi.mock("../../liveEdit/LiveEditPanel.tsx", () => ({
  LiveEditPanel: liveEditPanel,
}));

// Mock the value chokepoint so callback-routing tests can assert on it without
// dragging the real runtime (editor/eval imports) into this test.
vi.mock("../../../effects/liveEditRuntime.ts", () => ({
  liveEditOnValueChange: vi.fn(),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeDefaultPersistedData(): LiveEditPersistedData {
  return {
    values: {},
    orphans: {},
    midiBindings: {},
    panelOrder: { mode: "document" },
    panelDock: "right",
    panelOpen: false,
    schemaVersion: 1,
  };
}

function makeStore(slots: LiveEditSlot[] = []): LiveEditStoreAPI {
  const _slots = [...slots];
  return {
    get slots() { return _slots; },
    registerSlot: vi.fn(),
    removeSlot: vi.fn(),
    setValue: vi.fn(),
    setState: vi.fn(),
    getSlot: vi.fn((id: string) => _slots.find((s) => s.id === id)),
    replaceAll: vi.fn((newSlots: LiveEditSlot[]) => {
      _slots.splice(0, _slots.length, ...newSlots);
    }),
    getValuesRecord: vi.fn(() => ({})),
  };
}

function makePersistence(overrides: Partial<LiveEditPersistedData> = {}): LiveEditPersistence {
  const data = { ...makeDefaultPersistedData(), ...overrides };
  return {
    load: vi.fn(() => data),
    saveValue: vi.fn(),
    flushValues: vi.fn(),
    saveBinding: vi.fn(),
    removeBinding: vi.fn((slotId: string) => { delete data.midiBindings[slotId]; }),
    savePanelState: vi.fn(),
    reconcile: vi.fn(() => data),
    dispose: vi.fn(),
  };
}

function makeLearnController(getState: () => MidiLearnState = () => ({ mode: "idle" })): MidiLearnController {
  const listeners = new Set<(state: MidiLearnState) => void>();
  const ctrl: MidiLearnController = {
    get state(): MidiLearnState { return getState(); },
    startSingle: vi.fn(),
    startBatch: vi.fn(),
    cancel: vi.fn(),
    skip: vi.fn(),
    handleMessage: vi.fn(() => null),
    onStateChanged: vi.fn((handler: (state: MidiLearnState) => void) => {
      listeners.add(handler);
      return () => { listeners.delete(handler); };
    }),
  };
  return ctrl;
}

function makeMidiInput(): MidiInputService {
  return {
    permission: "unknown",
    inputs: [],
    requestAccess: vi.fn(async () => {}),
    setInputEnabled: vi.fn(),
    onMessage: vi.fn(() => () => {}),
    onDevicesChanged: vi.fn(() => () => {}),
    onPermissionChanged: vi.fn(() => () => {}),
    dispose: vi.fn(),
  };
}

// ── Import under test (after mocks are registered) ───────────────────────────

import { WiredLiveEditPanel, startLiveEditLearnAll, toggleLiveEditPanel } from "../liveEditPanel.tsx";
import { liveEditOnValueChange } from "../../../effects/liveEditRuntime.ts";

// ── Tests ────────────────────────────────────────────────────────────────────

describe("WiredLiveEditPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads persisted state and subscribes to MIDI learn for its application lifetime", () => {
    const store = makeStore();
    const persistence = makePersistence({ panelOpen: true });
    const learnController = makeLearnController();

    const midiInput = makeMidiInput();
    const mounted = render(() => WiredLiveEditPanel({ store, persistence, learnController, midiInput }));

    expect(persistence.load).toHaveBeenCalledTimes(1);
    expect(learnController.onStateChanged).toHaveBeenCalledTimes(1);
    expect(midiInput.onPermissionChanged).toHaveBeenCalledTimes(1);
    expect(liveEditPanel).toHaveBeenCalledTimes(1);
    mounted.unmount();
  });
});

// ── Callback routing tests ────────────────────────────────────────────────────
// These render the real WiredLiveEditPanel adapter (with LiveEditPanel mocked
// out at the view boundary), capture the callback props the adapter passes to
// the view, and invoke them — asserting the adapter's actual downstream
// behaviour (persistence, learn controller, liveEditOnValueChange), not a
// re-implementation of it.

interface CapturedPanelProps {
  onValueChange: (id: string, value: number) => void;
  onResetToSeed: (id: string) => void;
  onStartLearn: (id: string) => void;
  onStartLearnAll: () => void;
  onRequestMidiAccess: () => void;
  onClearBinding: (id: string) => void;
  onReorder: (order: string[]) => void;
  onResetOrder: () => void;
  onClose: () => void;
  onDockChange: (dock: "right" | "bottom" | "left") => void;
  bindings: Map<string, unknown>;
}

function lastPanelProps(): CapturedPanelProps {
  const call = liveEditPanel.mock.calls.at(-1);
  if (!call) throw new Error("LiveEditPanel was not rendered");
  return call[0] as CapturedPanelProps;
}

describe("liveEditPanel callback routing (via the real adapter)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderOpenPanel(overrides: {
    store?: ReturnType<typeof makeStore>;
    persistence?: ReturnType<typeof makePersistence>;
    learnController?: MidiLearnController;
    midiInput?: MidiInputService;
  } = {}) {
    const store = overrides.store ?? makeStore();
    const persistence = overrides.persistence ?? makePersistence({ panelOpen: true });
    const learnController = overrides.learnController ?? makeLearnController();
    const midiInput = overrides.midiInput ?? makeMidiInput();
    const mounted = render(() =>
      WiredLiveEditPanel({ store, persistence, learnController, midiInput }),
    );
    return { store, persistence, learnController, midiInput, mounted };
  }

  it("onValueChange routes through the liveEditOnValueChange chokepoint", () => {
    const { mounted } = renderOpenPanel();

    lastPanelProps().onValueChange("slot-abc", 0.75);

    expect(liveEditOnValueChange).toHaveBeenCalledWith("slot-abc", 0.75);
    mounted.unmount();
  });

  it("onResetToSeed pushes the slot's seed through liveEditOnValueChange", () => {
    const slotId = "slot-xyz";
    const mockSlot: LiveEditSlot = {
      id: slotId,
      kind: "numeric",
      seed: 0.5,
      value: 0.9,
      state: "idle",
      range: { from: 0, to: 10 },
    };
    const { mounted } = renderOpenPanel({ store: makeStore([mockSlot]) });

    lastPanelProps().onResetToSeed(slotId);

    expect(liveEditOnValueChange).toHaveBeenCalledWith(slotId, 0.5);
    mounted.unmount();
  });

  it("onStartLearn arms an idle slot and re-clicking the armed slot cancels", () => {
    let state: MidiLearnState = { mode: "idle" };
    const learnController = makeLearnController(() => state);
    const { mounted } = renderOpenPanel({ learnController });

    lastPanelProps().onStartLearn("slot-learn");
    expect(learnController.startSingle).toHaveBeenCalledWith("slot-learn");

    state = { mode: "single", slotId: "slot-learn" };
    lastPanelProps().onStartLearn("slot-learn");
    expect(learnController.cancel).toHaveBeenCalled();
    mounted.unmount();
  });

  it("onStartLearnAll batches every slot id; re-invoking cancels batch mode", () => {
    let state: MidiLearnState = { mode: "idle" };
    const learnController = makeLearnController(() => state);
    const store = makeStore([
      { id: "a", kind: "numeric", seed: 0, value: 0, state: "idle", range: { from: 0, to: 1 } },
      { id: "b", kind: "boolean", seed: false, value: false, state: "idle", range: { from: 0, to: 1 } },
    ]);
    const { mounted } = renderOpenPanel({ store, learnController });

    lastPanelProps().onStartLearnAll();
    expect(learnController.startBatch).toHaveBeenCalledWith(["a", "b"]);

    state = { mode: "batch", slotIds: ["a", "b"], index: 0 };
    lastPanelProps().onStartLearnAll();
    expect(learnController.cancel).toHaveBeenCalled();
    mounted.unmount();
  });

  it("onRequestMidiAccess asks the MIDI input service for access", async () => {
    const midiInput = makeMidiInput();
    const { mounted } = renderOpenPanel({ midiInput });

    lastPanelProps().onRequestMidiAccess();
    expect(midiInput.requestAccess).toHaveBeenCalledTimes(1);
    mounted.unmount();
  });

  it("onClearBinding removes the persisted binding and refreshes the view", () => {
    const persistence = makePersistence({
      panelOpen: true,
      midiBindings: { "slot-1": { kind: "cc", channel: 1, controller: 7 } },
    });
    const { mounted } = renderOpenPanel({ persistence });

    lastPanelProps().onClearBinding("slot-1");

    expect(persistence.removeBinding).toHaveBeenCalledWith("slot-1");
    // The view re-rendered with the binding gone from the bindings map.
    expect(lastPanelProps().bindings.has("slot-1")).toBe(false);
    mounted.unmount();
  });

  it("onReorder, onResetOrder and onClose persist panel state", () => {
    const persistence = makePersistence({ panelOpen: true });
    const { mounted } = renderOpenPanel({ persistence });

    lastPanelProps().onReorder(["slot-b", "slot-a"]);
    expect(persistence.savePanelState).toHaveBeenCalledWith({
      order: { mode: "custom", custom: ["slot-b", "slot-a"] },
    });

    lastPanelProps().onResetOrder();
    expect(persistence.savePanelState).toHaveBeenCalledWith({ order: { mode: "document" } });

    lastPanelProps().onClose();
    expect(persistence.savePanelState).toHaveBeenCalledWith({ open: false });
    mounted.unmount();
  });

  it("onDockChange persists the new dock side", () => {
    const persistence = makePersistence({ panelOpen: true });
    const { mounted } = renderOpenPanel({ persistence });

    lastPanelProps().onDockChange("bottom");
    expect(persistence.savePanelState).toHaveBeenCalledWith({ dock: "bottom" });
    mounted.unmount();
  });

  it("toggleLiveEditPanel() opens the closed panel, then closes it again", () => {
    const persistence = makePersistence({ panelOpen: false });
    const { mounted } = renderOpenPanel({ persistence });
    const callsBefore = liveEditPanel.mock.calls.length;

    toggleLiveEditPanel();
    expect(persistence.savePanelState).toHaveBeenCalledWith({ open: true });
    expect(liveEditPanel.mock.calls.length).toBe(callsBefore + 1);

    toggleLiveEditPanel();
    expect(persistence.savePanelState).toHaveBeenCalledWith({ open: false });
    mounted.unmount();
  });

  it("startLiveEditLearnAll() opens the panel if closed and starts batch learn", () => {
    let state: MidiLearnState = { mode: "idle" };
    const learnController = makeLearnController(() => state);
    const persistence = makePersistence({ panelOpen: false });
    const store = makeStore([
      { id: "a", kind: "numeric", seed: 0, value: 0, state: "idle", range: { from: 0, to: 1 } },
    ]);
    const { mounted } = renderOpenPanel({ store, persistence, learnController });

    startLiveEditLearnAll();

    // Panel became visible so the batch banner/progress is observable.
    expect(persistence.savePanelState).toHaveBeenCalledWith({ open: true });
    expect(learnController.startBatch).toHaveBeenCalledWith(["a"]);
    mounted.unmount();
  });
});
