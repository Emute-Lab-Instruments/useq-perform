/**
 * [F9] The editor must re-sync its §6.5 binary INPUT_SET id→slot_index map on
 * every successful eval (wire-protocol.md §6.5, §11.1).
 *
 * Each eval RE-ALLOCATES the device live-slot table in declaration order. If the
 * editor keeps a map built from a previous eval's layout, the binary INPUT_SET
 * fast-path (which addresses slots by raw index and is fire-and-forget with only
 * a range check) silently writes knob/slider scrubs to the WRONG slot.
 *
 * This guards the eval-completion re-sync (`resyncLiveSlotIndexAfterEval`):
 *   - it INVALIDATES the map immediately (so a push before re-sync completes
 *     falls back to the robust set-live-inputs path — resolveLiveSlotIndex→null);
 *   - on hardware it RE-SYNCS from a fresh get-state, so a subsequent push
 *     targets the CORRECT new index, never the stale one.
 *
 * The old manualControlWire test simulated the sync by calling syncLiveSlotIndex
 * directly and never re-evaluating, so it could not catch a stale-map push.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StateSnapshot } from "../contracts/runtimeTypes.ts";

// Connection gating + get-state are the two transport dependencies of the
// re-sync. `webSerialHostPort.requestStateSnapshot()` calls the real
// `sendGetState` then feeds `snapshot.liveSlots` into the REAL `syncLiveSlotIndex`,
// so mocking get-state alone drives the whole re-sync through real map code.
let connected = true;
let jsonActive = true;
const sendGetStateMock = vi.fn<[], Promise<{ success: boolean; state: StateSnapshot }>>();

vi.mock("../transport/index.ts", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    isConnectedToModule: () => connected,
    isJsonProtocolActive: () => jsonActive,
  };
});

vi.mock("../transport/json-protocol.ts", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    sendGetState: () => sendGetStateMock(),
  };
});

import { resyncLiveSlotIndexAfterEval } from "./liveEditRuntime.ts";
import {
  syncLiveSlotIndex,
  resolveLiveSlotIndex,
  isLiveSlotIndexSynced,
} from "../lib/liveSlotIndex.ts";

function snapshotWithLiveSlots(ids: string[]): StateSnapshot {
  return {
    transport: { playing: false, timeOffset: 0 },
    time: 0,
    cells: {},
    outputs: {},
    stateSlots: [],
    liveSlots: ids.map((id) => ({ id, value: 0, min: 0, max: 1 })),
  };
}

/** Let the fire-and-forget requestStateSnapshot() promise chain settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

describe("[F9] live-slot id→index re-sync on eval (wire-protocol.md §6.5/§11.1)", () => {
  beforeEach(() => {
    connected = true;
    jsonActive = true;
    sendGetStateMock.mockReset();
    syncLiveSlotIndex(null); // start clean
  });

  afterEach(() => {
    syncLiveSlotIndex(null);
  });

  it("a scrub does NOT hit a stale slot after an eval reallocates the table", async () => {
    // Eval #1 declared [ssin1, ssin17] → ssin1 at index 0.
    syncLiveSlotIndex([{ id: "ssin1" }, { id: "ssin17" }]);
    expect(resolveLiveSlotIndex("ssin1")).toBe(0);

    // Eval #2 changed the live-input set: a new input `gain` is declared first,
    // so the device now allocates ssin1 at index 1. get-state reflects this.
    sendGetStateMock.mockResolvedValue({
      success: true,
      state: snapshotWithLiveSlots(["gain", "ssin1", "ssin17"]),
    });

    resyncLiveSlotIndexAfterEval();

    // Immediately after eval the map is invalidated: a push landing before the
    // async get-state resolves MUST fall back (resolveLiveSlotIndex → null),
    // never the stale index 0.
    expect(isLiveSlotIndexSynced()).toBe(false);
    expect(resolveLiveSlotIndex("ssin1")).toBeNull();

    await flush();

    // After re-sync, ssin1 resolves to its NEW index 1 — the correct slot, not
    // the stale 0 the pre-eval map held.
    expect(sendGetStateMock).toHaveBeenCalledTimes(1);
    expect(resolveLiveSlotIndex("ssin1")).toBe(1);
    expect(resolveLiveSlotIndex("gain")).toBe(0);
  });

  it("invalidates without re-syncing when not connected to hardware", async () => {
    syncLiveSlotIndex([{ id: "ssin1" }]);
    expect(resolveLiveSlotIndex("ssin1")).toBe(0);

    connected = false; // WASM-only / no-module mode

    resyncLiveSlotIndexAfterEval();
    await flush();

    // Map invalidated → scrub falls back to set-live-inputs; no get-state issued.
    expect(isLiveSlotIndexSynced()).toBe(false);
    expect(resolveLiveSlotIndex("ssin1")).toBeNull();
    expect(sendGetStateMock).not.toHaveBeenCalled();
  });

  it("invalidates without re-syncing when the JSON protocol is not active", async () => {
    syncLiveSlotIndex([{ id: "ssin1" }]);
    jsonActive = false;

    resyncLiveSlotIndexAfterEval();
    await flush();

    expect(resolveLiveSlotIndex("ssin1")).toBeNull();
    expect(sendGetStateMock).not.toHaveBeenCalled();
  });
});
