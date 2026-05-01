import { Component, For, Show, createEffect } from "solid-js";
import {
  categories,
  getExercisesByCategory,
  type Exercise,
} from "./exercises";
import {
  enterExercise,
  isExerciseCompleted,
  getCategoryProgress,
  getFirstIncomplete,
} from "./store";

interface ZenGridProps {
  onExit: () => void;
  focusedRow: number;
  focusedCol: number;
}

const ZenGrid: Component<ZenGridProps> = (props) => {
  const firstIncomplete = () => getFirstIncomplete();

  createEffect(() => {
    const el = document.querySelector(".zen-card-focused");
    if (el) el.scrollIntoView({ block: "nearest", inline: "nearest" });
  });

  return (
    <div class="zen-grid">
      <div class="zen-grid-header">
        <h1 class="zen-grid-title">Structural Editing</h1>
        <div class="zen-grid-actions">
          <Show when={firstIncomplete()}>
            <button
              class="zen-btn zen-btn-primary"
              onClick={() => enterExercise(firstIncomplete()!.id)}
            >
              Continue
            </button>
          </Show>
          <button class="zen-btn zen-btn-ghost" onClick={props.onExit}>
            Exit
          </button>
        </div>
      </div>

      <div class="zen-grid-body">
        <For each={categories}>
          {(cat, rowIdx) => {
            const catExercises = () => getExercisesByCategory(cat.id);
            const progress = () => getCategoryProgress(cat.id);
            const isRowFocused = () => rowIdx() === props.focusedRow;
            return (
              <div
                class="zen-category-row"
                classList={{ "zen-row-focused": isRowFocused() }}
              >
                <div class="zen-category-label">
                  <span class="zen-category-name">{cat.label}</span>
                  <span class="zen-category-count">
                    {progress().completed}/{progress().total}
                  </span>
                </div>
                <div class="zen-category-cards">
                  <For each={catExercises()}>
                    {(ex, colIdx) => (
                      <ExerciseCard
                        exercise={ex}
                        focused={isRowFocused() && colIdx() === props.focusedCol}
                      />
                    )}
                  </For>
                </div>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
};

const ExerciseCard: Component<{ exercise: Exercise; focused: boolean }> = (props) => {
  const completed = () => isExerciseCompleted(props.exercise.id);

  return (
    <button
      class="zen-card"
      classList={{
        "zen-card-done": completed(),
        "zen-card-focused": props.focused,
      }}
      onClick={() => enterExercise(props.exercise.id)}
      title={props.exercise.title}
    >
      <pre class="zen-card-code">{props.exercise.startCode}</pre>
      <span class="zen-card-title">{props.exercise.title}</span>
    </button>
  );
};

export default ZenGrid;
