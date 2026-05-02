const STORAGE_KEY = "useq:zen:progress";

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
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PROGRESS };
    const parsed = JSON.parse(raw);
    if (parsed?.version === 1) return parsed;
    return { ...DEFAULT_PROGRESS };
  } catch {
    return { ...DEFAULT_PROGRESS };
  }
}

export function saveProgress(p: ZenProgress): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    // localStorage full or unavailable — silently drop
  }
}
