import { describe, expect, it, vi } from "vitest";
import { createActor } from "xstate";
import { transportMachine } from "./transport.machine";

describe("browser-local startup transport event", () => {
  it("starts playback without changing paused state, leaving STOP effective", () => {
    const play = vi.fn();
    const stop = vi.fn();
    const actor = createActor(transportMachine.provide({ actions: {
      autoStartBrowserLocal: play,
      emitStop: stop,
    } }));
    actor.start();

    actor.send({ type: "AUTO_START_BROWSER_LOCAL" });
    expect(actor.getSnapshot().value).toBe("paused");
    expect(play).toHaveBeenCalledOnce();

    actor.send({ type: "STOP" });
    expect(actor.getSnapshot().value).toBe("stopped");
    expect(stop).toHaveBeenCalledOnce();
    actor.stop();
  });
});
