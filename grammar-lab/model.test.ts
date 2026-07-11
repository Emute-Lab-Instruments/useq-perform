import { describe, expect, it } from "vitest";
import {
  GOAL_STEPS,
  PROFILES,
  analyzeRun,
  bindingFor,
  createInitialState,
  guidanceFor,
  invokeAction,
  isComplete,
  recordRawInput,
  recordUnbound,
  resolveGesture,
  waveformPath,
} from "./model";

describe("grammar lab model", () => {
  it("moves the focused high step forward while preserving focus identity by position", () => {
    const state = invokeAction(createInitialState(), "edit.transposeNext", {
      device: "keyboard",
      gesture: "Alt+ArrowRight",
      t: 10,
    });

    expect(state.steps).toEqual(GOAL_STEPS);
    expect(state.liveSteps).toEqual(GOAL_STEPS);
    expect(state.focus).toBe(2);
    expect(state.trace[0]).toMatchObject({
      action: "edit.transposeNext",
      status: "applied",
      signal: "updated",
    });
    expect(isComplete(state)).toBe(true);
  });

  it("blocks movement at a structural boundary without adding undo history", () => {
    let state = createInitialState();
    state = invokeAction(state, "focus.next", { device: "keyboard", gesture: "ArrowRight", t: 1 });
    state = invokeAction(state, "focus.next", { device: "keyboard", gesture: "ArrowRight", t: 2 });
    const blocked = invokeAction(state, "edit.transposeNext", {
      device: "keyboard",
      gesture: "Alt+ArrowRight",
      t: 3,
    });

    expect(blocked.steps).toEqual(state.steps);
    expect(blocked.history).toHaveLength(0);
    expect(blocked.trace.at(-1)).toMatchObject({ status: "blocked" });
  });

  it("keeps the last good signal alive while the structure contains a hole", () => {
    const initial = createInitialState();
    const broken = invokeAction(initial, "structure.makeHole", {
      device: "gamepad",
      gesture: "X",
      t: 10,
    });
    const rejected = invokeAction(broken, "program.commit", {
      device: "gamepad",
      gesture: "Start",
      t: 20,
    });

    expect(broken.steps[1]).toBeNull();
    expect(broken.liveSteps).toEqual(initial.liveSteps);
    expect(rejected.liveSteps).toEqual(initial.liveSteps);
    expect(rejected.trace.at(-1)).toMatchObject({
      status: "blocked",
      signal: "held-last-good",
    });
  });

  it("does not report a signal update while another structural hole remains", () => {
    let state = createInitialState();
    state = invokeAction(state, "structure.makeHole", { device: "keyboard", gesture: "Backspace", t: 1 });
    state = invokeAction(state, "focus.next", { device: "keyboard", gesture: "ArrowRight", t: 2 });
    state = invokeAction(state, "structure.makeHole", { device: "keyboard", gesture: "Backspace", t: 3 });
    state = invokeAction(state, "structure.fillHole", { device: "keyboard", gesture: "Enter", t: 4 });

    expect(state.steps).toEqual([0.2, null, 0.5, 0.6]);
    expect(state.liveSteps).toEqual([0.2, 0.8, 0.4, 0.6]);
    expect(state.trace.at(-1)).toMatchObject({ signal: "held-last-good" });
  });

  it("undo restores structure, focus, and live signal exactly", () => {
    const initial = createInitialState();
    const changed = invokeAction(initial, "value.increase", {
      device: "keyboard",
      gesture: "ArrowUp",
      t: 10,
    });
    const restored = invokeAction(changed, "history.undo", {
      device: "keyboard",
      gesture: "Z",
      t: 20,
    });

    expect(restored.steps).toEqual(initial.steps);
    expect(restored.liveSteps).toEqual(initial.liveSteps);
    expect(restored.focus).toBe(initial.focus);
    expect(restored.history).toHaveLength(0);
  });

  it("derives gestures and previews from the active profile", () => {
    const shifted = PROFILES.find((profile) => profile.id === "shifted")!;
    const state = createInitialState();
    const guidance = guidanceFor(state, shifted, "gamepad", "edit.transposeNext");

    expect(guidance.gesture).toBe("LB + D-pad →");
    expect(guidance.available).toBe(true);
    expect(guidance.previewAfter).toBe("[0.2 0.4 0.8 0.6]");
  });

  it("keeps every profile wired to the same semantic target", () => {
    for (const profile of PROFILES) {
      const keyboard = bindingFor(profile, "edit.transposeNext", "keyboard");
      const gamepad = bindingFor(profile, "edit.transposeNext", "gamepad");
      expect(resolveGesture(profile, "keyboard", keyboard)).toBe("edit.transposeNext");
      expect(resolveGesture(profile, "gamepad", gamepad)).toBe("edit.transposeNext");
    }
  });

  it("records unbound input separately from semantic actions", () => {
    const state = recordUnbound(createInitialState(), {
      device: "keyboard",
      gesture: "Q",
      t: 20,
    });

    expect(state.trace[0]).toMatchObject({
      action: null,
      status: "unbound",
    });
    expect(state.steps).toEqual([0.2, 0.8, 0.4, 0.6]);
  });

  it("keeps raw control edges separate and excludes guide assistance from motor counts", () => {
    const profile = PROFILES[1];
    let state = recordRawInput(createInitialState(100), {
      device: "keyboard",
      phase: "down",
      control: "ShiftLeft",
      profile: profile.id,
      inputMode: "keyboard",
      t: 120,
    });
    state = invokeAction(state, "edit.transposeNext", {
      device: "guide",
      gesture: "Shift+ArrowRight",
      profile: profile.id,
      inputMode: "keyboard",
      t: 200,
    });
    const summary = analyzeRun(state, profile, "keyboard", 900);

    expect(state.rawInputs).toHaveLength(1);
    expect(state.trace).toHaveLength(1);
    expect(summary.appliedActions).toBe(0);
    expect(summary.assisted).toBe(1);
    expect(summary.elapsedMs).toBe(100);
  });

  it("derives corrections and friction summaries without changing behavior", () => {
    const profile = PROFILES[0];
    let state = createInitialState(100);
    state = invokeAction(state, "value.increase", { device: "keyboard", gesture: "ArrowUp", t: 200 });
    state = invokeAction(state, "history.undo", { device: "keyboard", gesture: "Z", t: 400 });
    state = recordUnbound(state, { device: "keyboard", gesture: "Q", t: 500 });
    const summary = analyzeRun(state, profile, "keyboard", 900);

    expect(summary).toMatchObject({
      elapsedMs: 800,
      appliedActions: 2,
      corrections: 1,
      unbound: 1,
    });
  });

  it("produces a deterministic stepped signal path", () => {
    expect(waveformPath([0.2, 0.8, 0.4, 0.6], 400, 100)).toBe(
      "M 0 70.4 H 100 V 29.599999999999998 H 200 V 56.8 H 300 V 43.2 H 400",
    );
  });
});
