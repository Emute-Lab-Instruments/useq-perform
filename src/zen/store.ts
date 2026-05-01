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
import type { ActionId } from "../lib/keybindings/actions";

export type ZenView = "grid" | "exercise";
export type DetectedInput = "gamepad" | "keyboard";

interface ZenState {
  view: ZenView;
  activeExerciseId: string | null;
  actionLog: ActionId[];
  detectedInput: DetectedInput;
  paradigm: string;
  wrongMoves: number;
  completed: boolean;
  showHints: boolean;
}

const [state, setState] = createStore<ZenState>({
  view: "grid",
  activeExerciseId: null,
  actionLog: [],
  detectedInput: "keyboard",
  paradigm: "modal-shift",
  wrongMoves: 0,
  completed: false,
  showHints: true,
});

const [progress, setProgressStore] = createSignal<ZenProgress>(loadProgress());

export { state };

export const activeExercise = createMemo<Exercise | null>(() => {
  if (!state.activeExerciseId) return null;
  return exercises.find((e) => e.id === state.activeExerciseId) ?? null;
});

export function enterExercise(id: string) {
  setState({
    view: "exercise",
    activeExerciseId: id,
    actionLog: [],
    wrongMoves: 0,
    completed: false,
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
  setState("detectedInput", input);
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
  };
  saveProgress(fresh);
  setProgressStore(fresh);
}

export function toggleHints() {
  setState("showHints", !state.showHints);
}
