import { Component, Show, For, createSignal, createEffect, on } from "solid-js";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { history } from "@codemirror/commands";
import { bracketMatching } from "@codemirror/language";
// @ts-expect-error — no type declarations
import { default_extensions as clojureExtensions } from "@nextjournal/clojure-mode";
import { baseKeymap } from "../editors/keymaps";
import { editorBaseTheme, themes } from "../editors/themes";
import { structureExtensions } from "../editors/extensions/structure";
import { getAppSettings } from "../runtime/appSettingsRepository";
import { bindGamepadNavigation } from "../editors/gamepadNavigation";
import { validateExercise } from "./validation";
import { getButtonHint, type ButtonHint } from "./hints";
import {
  state,
  activeExercise,
  markCompleted,
  advanceToNext,
  returnToGrid,
  toggleHints,
} from "./store";
import { getExercisesByCategory, type Exercise } from "./exercises";

const ZenExercise: Component = () => {
  let editorContainer: HTMLDivElement | undefined;
  let editorView: EditorView | undefined;
  let navHandle: { dispose(): void } | undefined;
  let completed = false;
  const [glowing, setGlowing] = createSignal(false);
  const [showDone, setShowDone] = createSignal(false);

  function teardown() {
    if (navHandle) {
      navHandle.dispose();
      navHandle = undefined;
    }
    if (editorView) {
      editorView.destroy();
      editorView = undefined;
    }
    completed = false;
    setShowDone(false);
    setGlowing(false);
  }

  function setup() {
    const ex = activeExercise();
    if (!ex || !editorContainer) return;

    teardown();

    // Guard: skip validation/action-tracking during initial editor setup
    let ready = false;

    editorView = createZenEditor(editorContainer, ex, () => {
      if (!ready || completed) return;
      completed = true;
      handleCompletion();
    });

    navHandle = bindGamepadNavigation(editorView);

    // Arm validation after initial setup settles (next microtask)
    queueMicrotask(() => { ready = true; });

    console.log(`[zen] Exercise loaded: "${ex.title}" (${ex.id})`);
  }

  createEffect(
    on(
      () => state.activeExerciseId,
      () => setup(),
    ),
  );

  function handleCompletion() {
    const ex = activeExercise();
    console.log(`[zen] Exercise complete: "${ex?.title}"`);
    markCompleted();
    setGlowing(true);
    setShowDone(true);
    setTimeout(() => {
      setGlowing(false);
      setShowDone(false);
      advanceToNext();
    }, 900);
  }

  function currentHint(): string | null {
    const ex = activeExercise();
    if (!ex?.hints?.length) return null;
    const wrongMoves = state.wrongMoves;
    if (wrongMoves < 3) return null;
    const hintIdx = Math.min(
      Math.floor((wrongMoves - 3) / 2),
      ex.hints.length - 1,
    );
    return ex.hints[hintIdx];
  }

  function currentButtonHints(): ButtonHint[] {
    const ex = activeExercise();
    if (!ex?.optimalActions?.length) return [];
    return ex.optimalActions.map((a) => getButtonHint(a));
  }



  return (
    <div class="zen-exercise">
      <div class="zen-topbar">
        <div class="zen-topbar-left">
          <button class="zen-btn zen-btn-ghost zen-btn-sm" onClick={returnToGrid}>
            &larr; Grid
          </button>
          <span class="zen-topbar-title">{activeExercise()?.title}</span>
        </div>
        <div class="zen-topbar-right">
          <button
            class="zen-btn zen-btn-ghost zen-btn-sm"
            classList={{ "zen-btn-active": !state.showHints }}
            onClick={toggleHints}
            title={state.showHints ? "Hide hints (hard mode)" : "Show hints"}
          >
            {state.showHints ? "hints on" : "hard mode"}
          </button>
          <Show when={activeExercise()}>
            <span class="zen-topbar-counter">
              {exerciseIndex(activeExercise()!) + 1}/{exerciseCategoryTotal(activeExercise()!)}
            </span>
          </Show>
        </div>
      </div>

      {/* Button hints strip */}
      <Show when={state.showHints && currentButtonHints().length > 0}>
        <div class="zen-button-hints">
          <For each={currentButtonHints()}>
            {(hint) => {
              const label = () =>
                state.detectedInput === "gamepad"
                  ? hint.gamepad
                  : hint.keyboard;
              return (
                <span class="zen-hint-badge">
                  {label() || "?"}
                </span>
              );
            }}
          </For>
        </div>
      </Show>

      <Show when={currentHint()}>
        <div class="zen-hint">{currentHint()}</div>
      </Show>

      <Show when={activeExercise()?.promptMode === "ghost"}>
        <div class="zen-ghost">
          <pre class="zen-ghost-code">{activeExercise()?.targetCode}</pre>
        </div>
      </Show>

      <div
        class="zen-editor-wrapper"
        classList={{ "zen-glow": glowing() }}
      >
        {/* Completion overlay */}
        <Show when={showDone()}>
          <div class="zen-done-overlay">
            <span class="zen-done-check">&#10003;</span>
          </div>
        </Show>

        <div ref={editorContainer} class="zen-editor" />
      </div>

      <Show when={activeExercise()?.promptMode === "beforeAfter"}>
        <div class="zen-target-panel">
          <span class="zen-target-label">Target</span>
          <pre class="zen-target-code">{activeExercise()?.targetCode}</pre>
        </div>
      </Show>
    </div>
  );
};

function createZenEditor(
  container: HTMLDivElement,
  ex: Exercise,
  onComplete: () => void,
): EditorView {
  container.innerHTML = "";

  const settings = getAppSettings();
  const theme = themes[settings.editor?.theme] ?? themes["oneDark"];

  const validationListener = EditorView.updateListener.of((update) => {
    if (!update.docChanged && !update.selectionSet) return;
    const result = validateExercise(update.view, ex);
    if (result.complete) {
      onComplete();
    }
  });

  const editorState = EditorState.create({
    doc: ex.startCode,
    extensions: [
      baseKeymap,
      history(),
      bracketMatching(),
      editorBaseTheme,
      theme,
      EditorView.theme({
        "&": { height: "100%", maxHeight: "300px" },
        ".cm-content": {
          fontSize: `${settings.editor?.fontSize || 18}px`,
          padding: "16px",
        },
        ".cm-scroller": { overflow: "auto" },
      }),
      ...clojureExtensions,
      ...structureExtensions,
      validationListener,
    ],
  });

  const view = new EditorView({ state: editorState, parent: container });

  placeCursor(view, ex.startCode, ex.startCursorText);
  view.focus();

  return view;
}

function placeCursor(
  view: EditorView,
  code: string,
  cursorText: string,
): void {
  const idx = code.indexOf(cursorText);
  if (idx === -1) return;
  view.dispatch({
    selection: { anchor: idx, head: idx + cursorText.length },
  });
}

function exerciseIndex(ex: Exercise): number {
  const catExercises = getExercisesByCategory(ex.category);
  return catExercises.findIndex((e) => e.id === ex.id);
}

function exerciseCategoryTotal(ex: Exercise): number {
  return getExercisesByCategory(ex.category).length;
}

export default ZenExercise;
