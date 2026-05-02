import { load, save, PERSISTENCE_KEYS } from "../lib/persistence.ts";

export interface ExerciseProgress {
  completed: boolean;
  bestMoves: number | null;
  bestTimeMs: number | null;
  attempts: number;
}

export interface ZenProgress {
  version: 1;
  exercises: Record<string, ExerciseProgress>;
  lastExercise: string | null;
  paradigm: string | null;
  guidanceMode: string | null;
}

const DEFAULT_PROGRESS: ZenProgress = {
  version: 1,
  exercises: {},
  lastExercise: null,
  paradigm: null,
  guidanceMode: null,
};

export function loadProgress(): ZenProgress {
  const parsed = load<ZenProgress>(PERSISTENCE_KEYS.zenProgress, null);
  if (parsed?.version === 1) return parsed;
  return { ...DEFAULT_PROGRESS };
}

export function saveProgress(p: ZenProgress): void {
  save(PERSISTENCE_KEYS.zenProgress, p);
}
