/**
 * Regression tests for the `liveEditValueChanged` channel wiring.
 *
 * The visualisation sampler subscribes to `liveEditValueChanged` to
 * invalidate future projections conservatively (visualisation spec §3.7 /
 * reactive-flow spec channel table). The live-edit runtime is the
 * publisher: `liveEditOnValueChange` must announce slot value changes
 * beyond epsilon (runtimeChannels.ts contract doc).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { liveEditValueChanged } from "../contracts/runtimeChannels.ts";
import { discoverSlotsAfterEval, liveEditStore, liveEditOnValueChange } from "./liveEditRuntime.ts";
import type { LiveEditValueChangedDetail } from "../contracts/runtimeChannels.ts";
import type { LiveEditSlot } from "../contracts/liveEdit.ts";

// The batch ticker flushes queued values on a real interval; keep the WASM
// push a no-op so no timer tick can throw after a test ends.
vi.mock("../runtime/activeWasmRuntimePort.ts", () => ({
  getActiveWasmRuntimePort: () => ({
    capabilities: () => ({ supportsLiveInputs: false }),
    getLiveSlots: vi.fn().mockResolvedValue([]),
    setLiveInputs: vi.fn().mockResolvedValue(undefined),
  }),
}));
vi.mock("../transport/index.ts", () => ({
  isConnectedToModule: () => true,
  isJsonProtocolActive: () => true,
  sendSetLiveInputs: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../transport/webSerialHostPort.ts", () => ({
  webSerialHostPort: {
    requestStateSnapshot: vi.fn().mockResolvedValue({
      liveSlots: [{
        id: "hardware-slot", value: 0.25, min: 0, max: 1, seed: 0.25,
        variant: "numeric", options: [], step: 0.1, precision: 2,
      }],
    }),
  },
}));

function makeSlot(overrides: Partial<LiveEditSlot> = {}): LiveEditSlot {
  return {
    id: "k1",
    kind: "numeric",
    seed: 0.5,
    value: 0.5,
    min: 0,
    max: 1,
    step: 0.01,
    state: "idle",
    range: { from: 0, to: 20 },
    modified: false,
    ...overrides,
  };
}

describe("liveEditOnValueChange → liveEditValueChanged", () => {
  // Announcement gating keeps the last announced value per slot id across
  // the singleton module's lifetime, so each test uses its own slot id.
  const published: LiveEditValueChangedDetail[] = [];
  let unsub: (() => void) | null = null;
  let nextId = 0;
  const slotId = () => `k${++nextId}`;

  beforeEach(() => {
    published.length = 0;
    unsub = liveEditValueChanged.subscribe((detail) => {
      published.push({ ...detail });
    });
  });

  afterEach(() => {
    unsub?.();
    unsub = null;
    liveEditStore.replaceAll([]);
  });

  it("registers widgets from a hardware-only state snapshot", async () => {
    const view = {
      state: { doc: { toString: () => '(live-edit 0.25 :id "hardware-slot" :min 0 :max 1)' } },
    } as unknown as import("@codemirror/view").EditorView;

    await discoverSlotsAfterEval(view);

    expect(liveEditStore.getSlot("hardware-slot")).toMatchObject({
      id: "hardware-slot", kind: "numeric", seed: 0.25, value: 0.25,
      min: 0, max: 1, step: 0.1, precision: 2,
    });
  });

  it("publishes old → new when the value changes beyond epsilon", () => {
    const id = slotId();
    liveEditStore.registerSlot(makeSlot({ id }));

    liveEditOnValueChange(id, 0.75);

    expect(published).toEqual([
      { slotId: id, newValue: 0.75, oldValue: 0.5 },
    ]);
    // The store itself was also updated.
    expect(liveEditStore.getSlot(id)?.value).toBe(0.75);
  });

  it("does not publish sub-epsilon nudges until the accumulated change is meaningful", () => {
    const id = slotId();
    liveEditStore.registerSlot(makeSlot({ id }));

    liveEditOnValueChange(id, 0.505);
    liveEditOnValueChange(id, 0.508);
    expect(published).toEqual([]);

    // Accumulated drift from the last announced value (0.5) exceeds 0.01.
    liveEditOnValueChange(id, 0.513);
    expect(published).toEqual([
      { slotId: id, newValue: 0.513, oldValue: 0.5 },
    ]);
  });

  it("does not publish a no-op write of the same value", () => {
    const id = slotId();
    liveEditStore.registerSlot(makeSlot({ id }));

    liveEditOnValueChange(id, 0.5);

    expect(published).toEqual([]);
  });

  it("announces boolean toggles as WASM doubles (§2.6)", () => {
    const id = slotId();
    liveEditStore.registerSlot(makeSlot({ id, kind: "boolean", seed: false, value: false, step: undefined }));

    liveEditOnValueChange(id, true);

    expect(published).toEqual([
      { slotId: id, newValue: 1, oldValue: 0 },
    ]);
  });
});
