import { createActor } from "xstate";
import { describe, it, expect, vi } from "vitest";
import { transportMachine } from "./transport.machine";

function createTestActor(overrides?: Record<string, () => void>) {
  const actions = {
    emitPlay: vi.fn(),
    emitPause: vi.fn(),
    emitStop: vi.fn(),
    emitRewind: vi.fn(),
    emitClear: vi.fn(),
    syncWasmPlay: vi.fn(),
    syncWasmPause: vi.fn(),
    syncWasmStop: vi.fn(),
    ...overrides,
  };
  const machine = transportMachine.provide({ actions });
  const actor = createActor(machine);
  actor.start();
  return { actor, actions };
}

describe("transportMachine", () => {
  describe("initial state", () => {
    it("starts in playing state with mode none", () => {
      const { actor } = createTestActor();
      const snap = actor.getSnapshot();
      expect(snap.value).toBe("playing");
      expect(snap.context.mode).toBe("none");
    });
  });

  describe("user-driven transitions", () => {
    it("playing -> paused via PAUSE", () => {
      const { actor, actions } = createTestActor();
      actor.send({ type: "PAUSE" });
      expect(actor.getSnapshot().value).toBe("paused");
      expect(actions.emitPause).toHaveBeenCalledOnce();
    });

    it("playing -> stopped via STOP", () => {
      const { actor, actions } = createTestActor();
      actor.send({ type: "STOP" });
      expect(actor.getSnapshot().value).toBe("stopped");
      expect(actions.emitStop).toHaveBeenCalledOnce();
    });

    it("paused -> playing via PLAY", () => {
      const { actor, actions } = createTestActor();
      actor.send({ type: "PAUSE" });
      actor.send({ type: "PLAY" });
      expect(actor.getSnapshot().value).toBe("playing");
      expect(actions.emitPlay).toHaveBeenCalledOnce();
    });

    it("stopped -> playing via PLAY", () => {
      const { actor, actions } = createTestActor();
      actor.send({ type: "STOP" });
      actor.send({ type: "PLAY" });
      expect(actor.getSnapshot().value).toBe("playing");
      expect(actions.emitPlay).toHaveBeenCalledOnce();
    });

    it("REWIND from playing goes to stopped and emits both rewind and stop", () => {
      const { actor, actions } = createTestActor();
      actor.send({ type: "REWIND" });
      expect(actor.getSnapshot().value).toBe("stopped");
      expect(actions.emitRewind).toHaveBeenCalledOnce();
      expect(actions.emitStop).toHaveBeenCalledOnce();
    });

    it("REWIND from stopped stays stopped and emits rewind only", () => {
      const { actor, actions } = createTestActor();
      actor.send({ type: "STOP" });
      actions.emitRewind.mockClear();
      actions.emitStop.mockClear();
      actor.send({ type: "REWIND" });
      expect(actor.getSnapshot().value).toBe("stopped");
      expect(actions.emitRewind).toHaveBeenCalledOnce();
      expect(actions.emitStop).not.toHaveBeenCalled();
    });

    it("CLEAR fires the emitClear action without changing state", () => {
      const { actor, actions } = createTestActor();
      actor.send({ type: "CLEAR" });
      expect(actor.getSnapshot().value).toBe("playing");
      expect(actions.emitClear).toHaveBeenCalledOnce();
    });

    it("ignores PLAY when already playing", () => {
      const { actor, actions } = createTestActor();
      actor.send({ type: "PLAY" });
      expect(actor.getSnapshot().value).toBe("playing");
      expect(actions.emitPlay).not.toHaveBeenCalled();
    });

    it("ignores PAUSE when stopped", () => {
      const { actor, actions } = createTestActor();
      actor.send({ type: "STOP" });
      actions.emitPause.mockClear();
      actor.send({ type: "PAUSE" });
      expect(actor.getSnapshot().value).toBe("stopped");
      expect(actions.emitPause).not.toHaveBeenCalled();
    });
  });

  describe("SYNC (runtime sync from hardware)", () => {
    it("syncs from playing to stopped", () => {
      const { actor } = createTestActor();
      expect(actor.getSnapshot().value).toBe("playing");
      actor.send({ type: "SYNC", state: "stopped" });
      expect(actor.getSnapshot().value).toBe("stopped");
    });

    it("syncs from playing to paused", () => {
      const { actor } = createTestActor();
      actor.send({ type: "SYNC", state: "paused" });
      expect(actor.getSnapshot().value).toBe("paused");
    });

    it("syncs from stopped to playing", () => {
      const { actor } = createTestActor();
      actor.send({ type: "STOP" });
      actor.send({ type: "SYNC", state: "playing" });
      expect(actor.getSnapshot().value).toBe("playing");
    });

    it("SYNC does not fire emit actions (no hardware feedback loop)", () => {
      const { actor, actions } = createTestActor();
      actor.send({ type: "SYNC", state: "stopped" });
      expect(actions.emitPlay).not.toHaveBeenCalled();
      expect(actions.emitPause).not.toHaveBeenCalled();
      expect(actions.emitStop).not.toHaveBeenCalled();
      expect(actions.emitRewind).not.toHaveBeenCalled();
    });

    it("SYNC to stopped fires syncWasmStop", () => {
      const { actor, actions } = createTestActor();
      actor.send({ type: "SYNC", state: "stopped" });
      expect(actions.syncWasmStop).toHaveBeenCalledOnce();
      expect(actions.syncWasmPlay).not.toHaveBeenCalled();
      expect(actions.syncWasmPause).not.toHaveBeenCalled();
    });

    it("SYNC to paused fires syncWasmPause", () => {
      const { actor, actions } = createTestActor();
      actor.send({ type: "SYNC", state: "paused" });
      expect(actions.syncWasmPause).toHaveBeenCalledOnce();
      expect(actions.syncWasmPlay).not.toHaveBeenCalled();
      expect(actions.syncWasmStop).not.toHaveBeenCalled();
    });

    it("SYNC to playing fires syncWasmPlay", () => {
      const { actor, actions } = createTestActor();
      actor.send({ type: "STOP" });
      actions.syncWasmPlay.mockClear();
      actions.syncWasmPause.mockClear();
      actions.syncWasmStop.mockClear();
      actor.send({ type: "SYNC", state: "playing" });
      expect(actions.syncWasmPlay).toHaveBeenCalledOnce();
      expect(actions.syncWasmPause).not.toHaveBeenCalled();
      expect(actions.syncWasmStop).not.toHaveBeenCalled();
    });

    it("SYNC to the same state is a no-op", () => {
      const { actor } = createTestActor();
      const snapBefore = actor.getSnapshot();
      actor.send({ type: "SYNC", state: "playing" });
      expect(actor.getSnapshot().value).toBe(snapBefore.value);
    });
  });

  describe("UPDATE_MODE", () => {
    it("updates mode to hardware", () => {
      const { actor } = createTestActor();
      actor.send({ type: "UPDATE_MODE", mode: "hardware" });
      expect(actor.getSnapshot().context.mode).toBe("hardware");
    });

    it("updates mode to wasm", () => {
      const { actor } = createTestActor();
      actor.send({ type: "UPDATE_MODE", mode: "wasm" });
      expect(actor.getSnapshot().context.mode).toBe("wasm");
    });

    it("updates mode to both", () => {
      const { actor } = createTestActor();
      actor.send({ type: "UPDATE_MODE", mode: "both" });
      expect(actor.getSnapshot().context.mode).toBe("both");
    });

    it("updates mode to none", () => {
      const { actor } = createTestActor();
      actor.send({ type: "UPDATE_MODE", mode: "hardware" });
      actor.send({ type: "UPDATE_MODE", mode: "none" });
      expect(actor.getSnapshot().context.mode).toBe("none");
    });

    it("mode update does not change transport state", () => {
      const { actor } = createTestActor();
      actor.send({ type: "PAUSE" });
      actor.send({ type: "UPDATE_MODE", mode: "both" });
      expect(actor.getSnapshot().value).toBe("paused");
      expect(actor.getSnapshot().context.mode).toBe("both");
    });

    it("UPDATE_MODE with the same mode is a no-op (no spurious assign)", () => {
      const { actor } = createTestActor();
      actor.send({ type: "UPDATE_MODE", mode: "hardware" });
      const snapBefore = actor.getSnapshot();
      actor.send({ type: "UPDATE_MODE", mode: "hardware" });
      const snapAfter = actor.getSnapshot();
      expect(snapAfter.context.mode).toBe("hardware");
      expect(snapAfter.value).toBe(snapBefore.value);
    });

    it("UPDATE_MODE works from every transport state", () => {
      const { actor } = createTestActor();

      // From playing
      actor.send({ type: "UPDATE_MODE", mode: "wasm" });
      expect(actor.getSnapshot().context.mode).toBe("wasm");
      expect(actor.getSnapshot().value).toBe("playing");

      // From paused
      actor.send({ type: "PAUSE" });
      actor.send({ type: "UPDATE_MODE", mode: "hardware" });
      expect(actor.getSnapshot().context.mode).toBe("hardware");
      expect(actor.getSnapshot().value).toBe("paused");

      // From stopped
      actor.send({ type: "STOP" });
      actor.send({ type: "UPDATE_MODE", mode: "both" });
      expect(actor.getSnapshot().context.mode).toBe("both");
      expect(actor.getSnapshot().value).toBe("stopped");
    });
  });

  // -----------------------------------------------------------------------
  // Rapid event sequences
  // -----------------------------------------------------------------------
  describe("rapid event sequences", () => {
    it("PLAY → PAUSE → PLAY in quick succession settles in playing", () => {
      const { actor, actions } = createTestActor();
      // Start in playing, pause, then play again
      actor.send({ type: "PAUSE" });
      actor.send({ type: "PLAY" });
      expect(actor.getSnapshot().value).toBe("playing");
      expect(actions.emitPause).toHaveBeenCalledOnce();
      expect(actions.emitPlay).toHaveBeenCalledOnce();
    });

    it("STOP → PLAY → STOP → PLAY settles in playing with correct action counts", () => {
      const { actor, actions } = createTestActor();
      actor.send({ type: "STOP" });
      actor.send({ type: "PLAY" });
      actor.send({ type: "STOP" });
      actor.send({ type: "PLAY" });
      expect(actor.getSnapshot().value).toBe("playing");
      expect(actions.emitStop).toHaveBeenCalledTimes(2);
      expect(actions.emitPlay).toHaveBeenCalledTimes(2);
    });

    it("double-PAUSE from playing only fires once", () => {
      const { actor, actions } = createTestActor();
      actor.send({ type: "PAUSE" });
      actor.send({ type: "PAUSE" }); // ignored — already paused, no PAUSE handler
      expect(actor.getSnapshot().value).toBe("paused");
      expect(actions.emitPause).toHaveBeenCalledOnce();
    });

    it("double-STOP from playing only fires once", () => {
      const { actor, actions } = createTestActor();
      actor.send({ type: "STOP" });
      actor.send({ type: "STOP" }); // ignored — already stopped, no STOP handler
      expect(actor.getSnapshot().value).toBe("stopped");
      expect(actions.emitStop).toHaveBeenCalledOnce();
    });

    it("REWIND → PLAY → REWIND cycle", () => {
      const { actor, actions } = createTestActor();
      // playing → REWIND → stopped (emitRewind + emitStop)
      actor.send({ type: "REWIND" });
      expect(actor.getSnapshot().value).toBe("stopped");
      // stopped → PLAY → playing (emitPlay)
      actor.send({ type: "PLAY" });
      expect(actor.getSnapshot().value).toBe("playing");
      // playing → REWIND → stopped (emitRewind + emitStop again)
      actor.send({ type: "REWIND" });
      expect(actor.getSnapshot().value).toBe("stopped");

      expect(actions.emitRewind).toHaveBeenCalledTimes(2);
      expect(actions.emitStop).toHaveBeenCalledTimes(2);
      expect(actions.emitPlay).toHaveBeenCalledOnce();
    });

    it("CLEAR can be interleaved with state changes without disruption", () => {
      const { actor, actions } = createTestActor();
      actor.send({ type: "CLEAR" });
      actor.send({ type: "PAUSE" });
      actor.send({ type: "CLEAR" });
      actor.send({ type: "PLAY" });
      actor.send({ type: "CLEAR" });
      expect(actor.getSnapshot().value).toBe("playing");
      expect(actions.emitClear).toHaveBeenCalledTimes(3);
      expect(actions.emitPause).toHaveBeenCalledOnce();
      expect(actions.emitPlay).toHaveBeenCalledOnce();
    });

    it("UPDATE_MODE interleaved with transitions preserves both", () => {
      const { actor } = createTestActor();
      actor.send({ type: "UPDATE_MODE", mode: "hardware" });
      actor.send({ type: "PAUSE" });
      actor.send({ type: "UPDATE_MODE", mode: "both" });
      actor.send({ type: "STOP" });
      actor.send({ type: "UPDATE_MODE", mode: "wasm" });
      expect(actor.getSnapshot().value).toBe("stopped");
      expect(actor.getSnapshot().context.mode).toBe("wasm");
    });
  });

  // -----------------------------------------------------------------------
  // SYNC edge cases
  // -----------------------------------------------------------------------
  describe("SYNC edge cases", () => {
    it("SYNC while stopped transitions to the target state", () => {
      const { actor, actions } = createTestActor();
      actor.send({ type: "STOP" });
      actions.syncWasmPlay.mockClear();
      actor.send({ type: "SYNC", state: "playing" });
      expect(actor.getSnapshot().value).toBe("playing");
      expect(actions.syncWasmPlay).toHaveBeenCalledOnce();
    });

    it("SYNC while stopped to paused works", () => {
      const { actor, actions } = createTestActor();
      actor.send({ type: "STOP" });
      actions.syncWasmPause.mockClear();
      actor.send({ type: "SYNC", state: "paused" });
      expect(actor.getSnapshot().value).toBe("paused");
      expect(actions.syncWasmPause).toHaveBeenCalledOnce();
    });

    it("SYNC while stopped to stopped is a self-transition", () => {
      const { actor, actions } = createTestActor();
      actor.send({ type: "STOP" });
      actions.syncWasmStop.mockClear();
      actor.send({ type: "SYNC", state: "stopped" });
      expect(actor.getSnapshot().value).toBe("stopped");
      // syncWasmStop fires because SYNC is a global event that re-enters the state
      expect(actions.syncWasmStop).toHaveBeenCalledOnce();
    });

    it("SYNC from paused to each state", () => {
      for (const target of ["playing", "paused", "stopped"] as const) {
        const { actor } = createTestActor();
        actor.send({ type: "PAUSE" });
        actor.send({ type: "SYNC", state: target });
        expect(actor.getSnapshot().value).toBe(target);
      }
    });

    it("rapid SYNC oscillation settles at last state", () => {
      const { actor, actions } = createTestActor();
      actor.send({ type: "SYNC", state: "stopped" });
      actor.send({ type: "SYNC", state: "playing" });
      actor.send({ type: "SYNC", state: "paused" });
      actor.send({ type: "SYNC", state: "playing" });
      expect(actor.getSnapshot().value).toBe("playing");

      // Each sync should fire its corresponding wasm action
      expect(actions.syncWasmStop).toHaveBeenCalledOnce();
      // syncWasmPlay fires twice: once for initial playing→playing self-transition
      // if it's a self-transition, and once for final sync to playing
      expect(actions.syncWasmPause).toHaveBeenCalledOnce();
    });

    it("SYNC does not interfere with subsequent user-driven events", () => {
      const { actor, actions } = createTestActor();
      // Hardware syncs to stopped
      actor.send({ type: "SYNC", state: "stopped" });
      expect(actor.getSnapshot().value).toBe("stopped");

      // User presses play — should work normally
      actor.send({ type: "PLAY" });
      expect(actor.getSnapshot().value).toBe("playing");
      expect(actions.emitPlay).toHaveBeenCalledOnce();

      // Another SYNC arrives from hardware
      actor.send({ type: "SYNC", state: "paused" });
      expect(actor.getSnapshot().value).toBe("paused");
      expect(actions.emitPause).not.toHaveBeenCalled(); // SYNC uses syncWasm*, not emit*
      expect(actions.syncWasmPause).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Ignored events (no handler in current state)
  // -----------------------------------------------------------------------
  describe("ignored events", () => {
    it("PAUSE is ignored in stopped state", () => {
      const { actor, actions } = createTestActor();
      actor.send({ type: "STOP" });
      actions.emitPause.mockClear();
      actor.send({ type: "PAUSE" });
      expect(actor.getSnapshot().value).toBe("stopped");
      expect(actions.emitPause).not.toHaveBeenCalled();
    });

    it("STOP is ignored in stopped state", () => {
      const { actor, actions } = createTestActor();
      actor.send({ type: "STOP" });
      actions.emitStop.mockClear();
      actor.send({ type: "STOP" });
      expect(actor.getSnapshot().value).toBe("stopped");
      expect(actions.emitStop).not.toHaveBeenCalled();
    });

    it("PAUSE is ignored in paused state", () => {
      const { actor, actions } = createTestActor();
      actor.send({ type: "PAUSE" });
      actions.emitPause.mockClear();
      actor.send({ type: "PAUSE" });
      expect(actor.getSnapshot().value).toBe("paused");
      expect(actions.emitPause).not.toHaveBeenCalled();
    });

    it("PLAY is ignored in playing state", () => {
      const { actor, actions } = createTestActor();
      actor.send({ type: "PLAY" });
      expect(actor.getSnapshot().value).toBe("playing");
      expect(actions.emitPlay).not.toHaveBeenCalled();
    });
  });
});
