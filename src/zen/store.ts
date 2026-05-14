import { createSignal, createMemo } from "solid-js";
import { createStore } from "solid-js/store";
import {
  exercises,
  categories,
  getExercisesByCategory,
  getNextInCategory,
  type Exercise,
  type CategoryId,
} from "./exercises";
import { loadProgress, saveProgress, type ZenProgress } from "./progress";
import {
  createSequenceState,
  checkAction as checkSequenceAction,
  resetSequence,
  type SequenceState,
} from "./sequenceTracker";
import type { ActionId } from "../lib/keybindings/actions";

export type ZenView = "grid" | "exercise";
export type DetectedInput = "gamepad" | "keyboard";
export type GuidanceMode = "guided" | "hints" | "bare";

interface ZenState {
  view: ZenView;
  activeExerciseId: string | null;
  actionLog: ActionId[];
  detectedInput: DetectedInput;
  paradigm: string;
  wrongMoves: number;
  completed: boolean;
  guidanceMode: GuidanceMode;
  sequenceState: SequenceState;
  wrongActionFlash: boolean;
}

const initialProgress = loadProgress();
const validModes: GuidanceMode[] = ["guided", "hints", "bare"];
const restoredMode = validModes.includes(initialProgress.guidanceMode as GuidanceMode)
  ? (initialProgress.guidanceMode as GuidanceMode)
  : "guided";

const validInputs: DetectedInput[] = ["gamepad", "keyboard"];
const restoredInput = validInputs.includes(initialProgress.inputMode as DetectedInput)
  ? (initialProgress.inputMode as DetectedInput)
  : "keyboard";

const [state, setState] = createStore<ZenState>({
  view: "grid",
  activeExerciseId: null,
  actionLog: [],
  detectedInput: restoredInput,
  paradigm: "modal-shift",
  wrongMoves: 0,
  completed: false,
  guidanceMode: restoredMode,
  sequenceState: createSequenceState([]),
  wrongActionFlash: false,
});

const [progress, setProgressStore] = createSignal<ZenProgress>(initialProgress);

export { state };

export const activeExercise = createMemo<Exercise | null>(() => {
  if (!state.activeExerciseId) return null;
  return exercises.find((e) => e.id === state.activeExerciseId) ?? null;
});

export function enterExercise(id: string) {
  const ex = exercises.find((e) => e.id === id);
  setState({
    view: "exercise",
    activeExerciseId: id,
    actionLog: [],
    wrongMoves: 0,
    completed: false,
    sequenceState: createSequenceState(ex?.actions ?? []),
    wrongActionFlash: false,
  });
  const p = progress();
  saveProgress({ ...p, lastExercise: id });
  setProgressStore({ ...p, lastExercise: id });
}

export function returnToGrid() {
  setState({ view: "grid", activeExerciseId: null });
}

export function logAction(action: ActionId) {
  setState("actionLog", [...state.actionLog, action]);
}

export function incrementWrongMoves() {
  setState("wrongMoves", state.wrongMoves + 1);
}

export function markCompleted() {
  setState("completed", true);
  const ex = activeExercise();
  if (!ex) return;

  const p = progress();
  const prev = p.exercises[ex.id];
  const moves = state.actionLog.length;
  const updated: ZenProgress = {
    ...p,
    exercises: {
      ...p.exercises,
      [ex.id]: {
        completed: true,
        bestMoves:
          prev?.bestMoves != null ? Math.min(prev.bestMoves, moves) : moves,
        bestTimeMs: prev?.bestTimeMs ?? null,
        attempts: (prev?.attempts ?? 0) + 1,
      },
    },
  };
  saveProgress(updated);
  setProgressStore(updated);
}

export function advanceToNext() {
  const ex = activeExercise();
  if (!ex) {
    returnToGrid();
    return;
  }
  const next = getNextInCategory(ex.id);
  if (next) {
    enterExercise(next.id);
  } else {
    returnToGrid();
  }
}

export function setDetectedInput(input: DetectedInput) {
  if (state.detectedInput === input) return;
  setState("detectedInput", input);
  const p = progress();
  saveProgress({ ...p, inputMode: input });
  setProgressStore({ ...p, inputMode: input });
}

export function setParadigm(p: string) {
  setState("paradigm", p);
}

export function getProgress() {
  return progress();
}

export function isExerciseCompleted(id: string): boolean {
  return progress().exercises[id]?.completed === true;
}

export function getCategoryProgress(cat: CategoryId): {
  completed: number;
  total: number;
} {
  const catExercises = getExercisesByCategory(cat);
  const p = progress();
  const completed = catExercises.filter(
    (e) => p.exercises[e.id]?.completed,
  ).length;
  return { completed, total: catExercises.length };
}

export function getFirstIncomplete(): Exercise | null {
  const p = progress();
  for (const cat of categories) {
    const catExercises = getExercisesByCategory(cat.id);
    for (const ex of catExercises) {
      if (!p.exercises[ex.id]?.completed) return ex;
    }
  }
  return null;
}

export function resetProgress() {
  const fresh: ZenProgress = {
    version: 1,
    exercises: {},
    lastExercise: null,
    paradigm: null,
    guidanceMode: null,
    inputMode: null,
  };
  saveProgress(fresh);
  setProgressStore(fresh);
}

export function setGuidanceMode(mode: GuidanceMode) {
  setState("guidanceMode", mode);
  const p = progress();
  saveProgress({ ...p, guidanceMode: mode });
  setProgressStore({ ...p, guidanceMode: mode });
}

export function cycleGuidanceMode() {
  const modes: GuidanceMode[] = ["guided", "hints", "bare"];
  const idx = modes.indexOf(state.guidanceMode);
  setGuidanceMode(modes[(idx + 1) % modes.length]);
}

export type ActionCheckResult = "correct" | "wrong" | "unchecked";

export function checkGuidedAction(action: ActionId): ActionCheckResult {
  if (state.guidanceMode !== "guided") return "unchecked";
  if (state.sequenceState.isComplete) return "unchecked";

  const result = checkSequenceAction(state.sequenceState, action);
  if (result.kind === "correct") {
    setState("sequenceState", result.sequenceState);
    return "correct";
  }

  setState("wrongActionFlash", true);
  setTimeout(() => setState("wrongActionFlash", false), 400);
  return "wrong";
}

export function resetExerciseSequence() {
  setState("sequenceState", resetSequence(state.sequenceState));
}
