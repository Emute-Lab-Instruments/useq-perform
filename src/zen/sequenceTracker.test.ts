import { describe, it, expect } from "vitest";
import {
  createSequenceState,
  checkAction,
  resetSequence,
} from "./sequenceTracker";
import type { ActionId } from "../lib/keybindings/actions";

describe("sequenceTracker", () => {
  describe("createSequenceState", () => {
    it("initializes with first step active", () => {
      const state = createSequenceState([
        "nav.structuralRight" as ActionId,
        "nav.enter" as ActionId,
      ]);
      expect(state.currentStep).toBe(0);
      expect(state.stepStates).toEqual(["active", "pending"]);
      expect(state.isComplete).toBe(false);
    });

    it("handles empty actions array", () => {
      const state = createSequenceState([]);
      expect(state.isComplete).toBe(true);
      expect(state.stepStates).toEqual([]);
    });

    it("handles single-action sequence", () => {
      const state = createSequenceState(["edit.slurpFwd" as ActionId]);
      expect(state.stepStates).toEqual(["active"]);
      expect(state.isComplete).toBe(false);
    });
  });

  describe("checkAction", () => {
    it("marks step completed on correct action", () => {
      const state = createSequenceState([
        "nav.structuralRight" as ActionId,
        "nav.enter" as ActionId,
      ]);
      const result = checkAction(state, "nav.structuralRight" as ActionId);
      expect(result.kind).toBe("correct");
      expect(result.sequenceState.currentStep).toBe(1);
      expect(result.sequenceState.stepStates).toEqual(["completed", "active"]);
      expect(result.sequenceState.isComplete).toBe(false);
    });

    it("returns wrong on incorrect action", () => {
      const state = createSequenceState([
        "nav.structuralRight" as ActionId,
        "nav.enter" as ActionId,
      ]);
      const result = checkAction(state, "nav.structuralLeft" as ActionId);
      expect(result.kind).toBe("wrong");
      expect(result.sequenceState.currentStep).toBe(0);
      expect(result.sequenceState.stepStates).toEqual(["active", "pending"]);
    });

    it("completes on final correct action", () => {
      let state = createSequenceState([
        "nav.structuralRight" as ActionId,
        "nav.enter" as ActionId,
      ]);
      state = checkAction(state, "nav.structuralRight" as ActionId).sequenceState;
      const result = checkAction(state, "nav.enter" as ActionId);
      expect(result.kind).toBe("correct");
      expect(result.sequenceState.isComplete).toBe(true);
      expect(result.sequenceState.stepStates).toEqual([
        "completed",
        "completed",
      ]);
    });

    it("returns wrong if already complete", () => {
      let state = createSequenceState(["edit.slurpFwd" as ActionId]);
      state = checkAction(state, "edit.slurpFwd" as ActionId).sequenceState;
      expect(state.isComplete).toBe(true);
      const result = checkAction(state, "edit.slurpFwd" as ActionId);
      expect(result.kind).toBe("wrong");
    });

    it("tracks multi-step progress correctly", () => {
      const actions: ActionId[] = [
        "nav.structuralDown" as ActionId,
        "nav.structuralRight" as ActionId,
        "nav.structuralRight" as ActionId,
        "edit.slurpFwd" as ActionId,
      ];
      let state = createSequenceState(actions);

      // Step 1
      let result = checkAction(state, "nav.structuralDown" as ActionId);
      expect(result.kind).toBe("correct");
      expect(result.sequenceState.stepStates).toEqual([
        "completed",
        "active",
        "pending",
        "pending",
      ]);

      // Step 2
      state = result.sequenceState;
      result = checkAction(state, "nav.structuralRight" as ActionId);
      expect(result.kind).toBe("correct");
      expect(result.sequenceState.stepStates).toEqual([
        "completed",
        "completed",
        "active",
        "pending",
      ]);

      // Step 3 — wrong
      state = result.sequenceState;
      result = checkAction(state, "nav.structuralLeft" as ActionId);
      expect(result.kind).toBe("wrong");
      expect(result.sequenceState.currentStep).toBe(2);

      // Step 3 — correct
      result = checkAction(state, "nav.structuralRight" as ActionId);
      expect(result.kind).toBe("correct");

      // Step 4
      state = result.sequenceState;
      result = checkAction(state, "edit.slurpFwd" as ActionId);
      expect(result.kind).toBe("correct");
      expect(result.sequenceState.isComplete).toBe(true);
    });

    it("handles repeated same actions in sequence", () => {
      const actions: ActionId[] = [
        "edit.slurpFwd" as ActionId,
        "edit.slurpFwd" as ActionId,
        "edit.slurpFwd" as ActionId,
      ];
      let state = createSequenceState(actions);

      for (let i = 0; i < 3; i++) {
        const result = checkAction(state, "edit.slurpFwd" as ActionId);
        expect(result.kind).toBe("correct");
        state = result.sequenceState;
      }
      expect(state.isComplete).toBe(true);
      expect(state.stepStates).toEqual([
        "completed",
        "completed",
        "completed",
      ]);
    });
  });

  describe("resetSequence", () => {
    it("resets a partially completed sequence", () => {
      let state = createSequenceState([
        "nav.structuralRight" as ActionId,
        "nav.enter" as ActionId,
      ]);
      state = checkAction(state, "nav.structuralRight" as ActionId).sequenceState;
      expect(state.currentStep).toBe(1);

      const reset = resetSequence(state);
      expect(reset.currentStep).toBe(0);
      expect(reset.stepStates).toEqual(["active", "pending"]);
      expect(reset.isComplete).toBe(false);
    });

    it("resets a completed sequence", () => {
      let state = createSequenceState(["edit.slurpFwd" as ActionId]);
      state = checkAction(state, "edit.slurpFwd" as ActionId).sequenceState;
      expect(state.isComplete).toBe(true);

      const reset = resetSequence(state);
      expect(reset.isComplete).toBe(false);
      expect(reset.currentStep).toBe(0);
    });
  });
});
