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

    it("SYNC does not fire emit actions (sync is silent)", () => {
      const { actor, actions } = createTestActor();
      actor.send({ type: "SYNC", state: "stopped" });
      expect(actions.emitPlay).not.toHaveBeenCalled();
      expect(actions.emitPause).not.toHaveBeenCalled();
      expect(actions.emitStop).not.toHaveBeenCalled();
      expect(actions.emitRewind).not.toHaveBeenCalled();
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
  });
});
