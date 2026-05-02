import type { ActionId } from "../lib/keybindings/actions";

export type StepState = "pending" | "active" | "completed";

export interface SequenceState {
  steps: ActionId[];
  currentStep: number;
  stepStates: StepState[];
  isComplete: boolean;
}

export interface StepResult {
  kind: "correct" | "wrong";
  sequenceState: SequenceState;
}

export function createSequenceState(actions: ActionId[]): SequenceState {
  return {
    steps: actions,
    currentStep: 0,
    stepStates: actions.map((_, i) => (i === 0 ? "active" : "pending")),
    isComplete: actions.length === 0,
  };
}

export function checkAction(
  state: SequenceState,
  action: ActionId,
): StepResult {
  if (state.isComplete) {
    return { kind: "wrong", sequenceState: state };
  }

  const expected = state.steps[state.currentStep];
  if (action === expected) {
    const nextStep = state.currentStep + 1;
    const isComplete = nextStep >= state.steps.length;
    const stepStates = state.steps.map((_, i) => {
      if (i < nextStep) return "completed" as const;
      if (i === nextStep && !isComplete) return "active" as const;
      return "pending" as const;
    });
    return {
      kind: "correct",
      sequenceState: {
        steps: state.steps,
        currentStep: nextStep,
        stepStates,
        isComplete,
      },
    };
  }

  return { kind: "wrong", sequenceState: state };
}

export function resetSequence(state: SequenceState): SequenceState {
  return createSequenceState(state.steps);
}
