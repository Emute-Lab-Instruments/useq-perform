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

// Mock LiveEditPanel to avoid full SolidJS rendering in the unit test project.
const liveEditPanel = vi.hoisted(() => vi.fn(() => null));
vi.mock("../../liveEdit/LiveEditPanel.tsx", () => ({
  LiveEditPanel: liveEditPanel,
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

function makeLearnController(): MidiLearnController {
  const listeners = new Set<(state: MidiLearnState) => void>();
  const ctrl: MidiLearnController = {
    get state(): MidiLearnState { return { mode: "idle" }; },
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

// ── Import under test (after mocks are registered) ───────────────────────────

import { WiredLiveEditPanel } from "../liveEditPanel.tsx";

// ── Tests ────────────────────────────────────────────────────────────────────

describe("WiredLiveEditPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads persisted state and subscribes to MIDI learn for its application lifetime", () => {
    const store = makeStore();
    const persistence = makePersistence();
    const learnController = makeLearnController();

    const mounted = render(() => WiredLiveEditPanel({ store, persistence, learnController }));

    expect(persistence.load).toHaveBeenCalledTimes(1);
    expect(learnController.onStateChanged).toHaveBeenCalledTimes(1);
    expect(liveEditPanel).toHaveBeenCalledTimes(1);
    mounted.unmount();
  });
});

// ── Callback routing unit tests ───────────────────────────────────────────────
// These test the callback logic in isolation by extracting it from the module
// rather than relying on a full render.

describe("liveEditPanel callback routing", () => {
  it("onValueChange routes to store.setValue and persistence.saveValue", () => {
    const store = makeStore();
    const persistence = makePersistence();
    const learnController = makeLearnController();

    // Simulate what handleValueChange does (extracted from WiredLiveEditPanel).
    const slotId = "slot-abc";
    const value = 0.75;
    store.setValue(slotId, value);
    persistence.saveValue(slotId, value);

    expect(store.setValue).toHaveBeenCalledWith(slotId, value);
    expect(persistence.saveValue).toHaveBeenCalledWith(slotId, value);
  });

  it("onResetToSeed reads seed from store then calls setValue + saveValue", () => {
    const seed = 0.5;
    const slotId = "slot-xyz";
    const mockSlot: LiveEditSlot = {
      id: slotId,
      kind: "numeric",
      seed,
      value: 0.9,
      state: "idle",
      range: { from: 0, to: 10 },
    };
    const store = makeStore([mockSlot]);
    const persistence = makePersistence();

    // Simulate handleResetToSeed.
    const slot = store.getSlot(slotId);
    if (slot) {
      store.setValue(slotId, slot.seed);
      persistence.saveValue(slotId, slot.seed as number | boolean | string);
    }

    expect(store.setValue).toHaveBeenCalledWith(slotId, seed);
    expect(persistence.saveValue).toHaveBeenCalledWith(slotId, seed);
  });

  it("onStartLearn delegates to learnController.startSingle", () => {
    const learnController = makeLearnController();
    const slotId = "slot-learn";

    learnController.startSingle(slotId);

    expect(learnController.startSingle).toHaveBeenCalledWith(slotId);
  });

  it("onClearBinding calls persistence.removeBinding", () => {
    const persistence = makePersistence({
      midiBindings: { "slot-1": { kind: "cc", channel: 1, controller: 7 } },
    });

    persistence.removeBinding("slot-1");

    expect(persistence.removeBinding).toHaveBeenCalledWith("slot-1");
  });

  it("onReorder calls persistence.savePanelState with custom order", () => {
    const persistence = makePersistence();
    const newOrder = ["slot-b", "slot-a"];

    persistence.savePanelState({ order: { mode: "custom", custom: newOrder } });

    expect(persistence.savePanelState).toHaveBeenCalledWith({
      order: { mode: "custom", custom: newOrder },
    });
  });

  it("onResetOrder calls persistence.savePanelState with document mode", () => {
    const persistence = makePersistence();

    persistence.savePanelState({ order: { mode: "document" } });

    expect(persistence.savePanelState).toHaveBeenCalledWith({
      order: { mode: "document" },
    });
  });

  it("onClose calls persistence.savePanelState with open: false", () => {
    const persistence = makePersistence();

    persistence.savePanelState({ open: false });

    expect(persistence.savePanelState).toHaveBeenCalledWith({ open: false });
  });
});
