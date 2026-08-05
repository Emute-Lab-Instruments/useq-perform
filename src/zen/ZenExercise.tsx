import { Component, Show, For, createSignal, createEffect, on, onCleanup, createMemo } from "solid-js";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { history } from "@codemirror/commands";
import { bracketMatching } from "@codemirror/language";
import { default_extensions as clojureExtensions } from "@nextjournal/clojure-mode";
import { baseKeymap } from "../editors/keymaps";
import { editorBaseTheme, themes } from "../editors/themes";
import { defaultTheme } from "../lib/editorDefaults";
import { structuralCoreExtensions } from "../editors/extensions/structure/adapter/extension";
import { getAppSettings } from "../runtime/appSettingsRepository";
import { validateExercise } from "./validation";
import { getButtonHint, getDeduplicatedHints, type ButtonHint } from "./hints";
import {
  state,
  activeExercise,
  markCompleted,
  advanceToNext,
  returnToGrid,
  cycleGuidanceMode,
  checkGuidedAction,
  logAction,
  incrementWrongMoves,
} from "./store";
import { getExercisesByCategory, type Exercise } from "./exercises";
import type { StepState } from "./sequenceTracker";
import {
  bindZenGamepadNavigation,
  type ActionGate,
  type ZenNavigationHandle,
} from "./zenNavigation";
import { createZenKeymapGuard } from "./zenKeymapGuard";
import { subscribeZenAction } from "./zenActionBus";
import type { ActionId } from "../lib/keybindings/actions";
import ZenInputToggle from "./ZenInputToggle";

const ZenExercise: Component = () => {
  let editorContainer: HTMLDivElement | undefined;
  let targetContainer: HTMLDivElement | undefined;
  let editorView: EditorView | undefined;
  let targetView: EditorView | undefined;
  let navHandle: ZenNavigationHandle | undefined;
  let unsubAction: (() => void) | undefined;
  let completed = false;
  const [glowing, setGlowing] = createSignal(false);
  const [showDone, setShowDone] = createSignal(false);

  function teardown() {
    if (unsubAction) {
      unsubAction();
      unsubAction = undefined;
    }
    if (navHandle) {
      navHandle.dispose();
      navHandle = undefined;
    }
    if (editorView) {
      editorView.destroy();
      editorView = undefined;
    }
    if (targetView) {
      targetView.destroy();
      targetView = undefined;
    }
    completed = false;
    setShowDone(false);
    setGlowing(false);
  }

  const actionGate: ActionGate = (actionId: ActionId) => {
    const result = checkGuidedAction(actionId);
    if (result === "correct") {
      logAction(actionId);
      return "allow";
    }
    if (result === "wrong") {
      incrementWrongMoves();
      return "block";
    }
    // "unchecked" (Hints/Bare mode) — allow freely
    logAction(actionId);
    return "allow";
  };

  function setup() {
    const ex = activeExercise();
    if (!ex || !editorContainer) return;

    teardown();

    let ready = false;

    editorView = createZenEditor(editorContainer, ex, actionGate, () => {
      if (!ready || completed) return;
      completed = true;
      handleCompletion();
    });

    // The target editor only exists for prompt modes that render it
    // (beforeAfter, puzzle, ghost). spotlight has no target container.
    // Guard on `isConnected` so a stale ref left behind by a previous prompt
    // mode (Solid callback refs aren't cleared on unmount) is ignored.
    if (
      promptMode() !== "spotlight" &&
      targetContainer &&
      targetContainer.isConnected
    ) {
      targetView = createTargetEditor(targetContainer, ex);
    }

    navHandle = bindZenGamepadNavigation(editorView, actionGate);
    // Forward gamepad-resolved ActionIds (from ZenMode's pipeline) to the
    // exercise nav handle while this exercise is mounted.
    const exerciseHandle = navHandle;
    unsubAction = subscribeZenAction((action) => {
      if (state.view !== "exercise") return false;
      return exerciseHandle.onAction(action);
    });

    queueMicrotask(() => {
      ready = true;
      // Focus the user's editor so keyboard shortcuts (e.g. Ctrl+]) work
      // immediately on load without an extra click.
      editorView?.focus();
    });

    console.log(`[zen] Exercise loaded: "${ex.title}" (${ex.id})`);
  }

  createEffect(
    on(
      () => state.activeExerciseId,
      () => setup(),
    ),
  );

  onCleanup(teardown);

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

  const guidedSequence = createMemo(() => {
    const ex = activeExercise();
    if (!ex?.actions?.length) return [];
    return ex.actions.map((a, i) => ({
      action: a,
      hint: getButtonHint(a),
      state: state.sequenceState.stepStates[i] ?? ("pending" as StepState),
    }));
  });

  const hintsSet = createMemo(() => {
    const ex = activeExercise();
    if (!ex?.actions?.length) return [];
    return getDeduplicatedHints(ex.actions);
  });

  const guidanceModeLabel = createMemo(() => {
    switch (state.guidanceMode) {
      case "guided": return "Guided";
      case "hints": return "Hints";
      case "bare": return "Bare";
    }
  });

  const promptMode = createMemo(() => activeExercise()?.promptMode ?? "beforeAfter");

  // Puzzle mode deliberately withholds operation hints — the user must figure
  // out *which* operation to use. We therefore suppress the instruction text,
  // the hint badges and the progressive hint regardless of guidance mode
  // (Guided still shows the button sequence so the mode stays usable).
  const isPuzzle = () => promptMode() === "puzzle";
  // ghost overlays the target on the editor; spotlight relies on the structural
  // halo. Neither shows a separate Target column.
  const showTargetColumn = () => promptMode() === "beforeAfter" || isPuzzle();
  const showGhostOverlay = () => promptMode() === "ghost";

  const showInstruction = () =>
    state.guidanceMode !== "bare" && !isPuzzle();
  const showSequence = () => state.guidanceMode === "guided";
  const showHintsSet = () => state.guidanceMode === "hints" && !isPuzzle();

  return (
    <div class="zen-exercise">
      {/* Nav bar */}
      <div class="zen-topbar">
        <div class="zen-topbar-left">
          <button class="zen-btn zen-btn-ghost zen-btn-sm" onClick={returnToGrid}>
            &larr; Grid
          </button>
          <span class="zen-topbar-title">{activeExercise()?.title}</span>
        </div>
        <div class="zen-topbar-right">
          <ZenInputToggle />
          <Show when={activeExercise()}>
            <span class="zen-topbar-counter">
              {exerciseIndex(activeExercise()!) + 1}/{exerciseCategoryTotal(activeExercise()!)}
            </span>
          </Show>
        </div>
      </div>

      {/* Instruction section */}
      <Show when={showInstruction() && activeExercise()?.hints?.[0]}>
        <div class="zen-instruction">
          {activeExercise()!.hints![0]}
        </div>
      </Show>

      {/* Hints: deduplicated keybinding set */}
      <Show when={showHintsSet() && hintsSet().length > 0}>
        <div class="zen-button-hints">
          <For each={hintsSet()}>
            {(entry) => {
              const label = () =>
                state.detectedInput === "gamepad"
                  ? entry.hint.gamepad
                  : entry.hint.keyboard;
              return (
                <span class="zen-hint-badge">
                  {label() || entry.action.split(".").pop()}
                </span>
              );
            }}
          </For>
        </div>
      </Show>

      {/* Progressive text hint (on wrong moves) */}
      <Show when={showInstruction() && currentHint()}>
        <div class="zen-hint">{currentHint()}</div>
      </Show>

      {/* Guided: ordered button sequence — sits directly above the editors */}
      <Show when={showSequence() && guidedSequence().length > 0}>
        <div
          class="zen-button-sequence"
          classList={{ "zen-sequence-shake": state.wrongActionFlash }}
        >
          <For each={guidedSequence()}>
            {(step, i) => {
              const label = () =>
                state.detectedInput === "gamepad"
                  ? step.hint.gamepad
                  : step.hint.keyboard;
              return (
                <>
                  <Show when={i() > 0}>
                    <span class="zen-seq-arrow" aria-hidden="true">&rarr;</span>
                  </Show>
                  <span
                    class="zen-seq-badge"
                    classList={{
                      "zen-seq-completed": step.state === "completed",
                      "zen-seq-active": step.state === "active",
                      "zen-seq-pending": step.state === "pending",
                    }}
                  >
                    {label() || step.action.split(".").pop()}
                  </span>
                </>
              );
            }}
          </For>
        </div>
      </Show>

      {/* Main area: editors, laid out per prompt mode */}
      <div class="zen-editors-area" classList={{ [`zen-prompt-${promptMode()}`]: true }}>
        <div
          class="zen-editor-wrapper zen-editor-active"
          classList={{ "zen-glow": glowing() }}
        >
          <Show when={showDone()}>
            <div class="zen-done-overlay">
              <span class="zen-done-check">&#10003;</span>
            </div>
          </Show>
          <div class="zen-editor-label">Your code</div>
          <div class="zen-editor-stack">
            {/* Ghost mode: translucent target rendered behind the editor */}
            <Show when={showGhostOverlay()}>
              <div ref={(el) => (targetContainer = el)} class="zen-editor zen-editor-ghost" />
            </Show>
            <div ref={editorContainer} class="zen-editor" />
          </div>
        </div>

        {/* beforeAfter / puzzle: target shown in its own column */}
        <Show when={showTargetColumn()}>
          <div class="zen-editor-wrapper zen-editor-target">
            <div class="zen-editor-label">{isPuzzle() ? "Reach this" : "Target"}</div>
            <div ref={(el) => (targetContainer = el)} class="zen-editor zen-editor-readonly" />
          </div>
        </Show>
      </div>

      {/* Floating guidance mode toggle */}
      <button
        class="zen-mode-toggle"
        onClick={cycleGuidanceMode}
        title={`Mode: ${guidanceModeLabel()} (click to cycle)`}
      >
        {guidanceModeLabel()}
      </button>
    </div>
  );
};

function createZenEditor(
  container: HTMLDivElement,
  ex: Exercise,
  gate: ActionGate,
  onComplete: () => void,
): EditorView {
  container.innerHTML = "";

  const settings = getAppSettings();
  const theme = themes[settings.editor?.theme] ?? themes[defaultTheme];

  const validationListener = EditorView.updateListener.of((update) => {
    if (!update.docChanged && !update.selectionSet) return;
    const result = validateExercise(update.view, ex);
    if (result.complete) {
      onComplete();
    }
  });

  const keymapGuard = createZenKeymapGuard(gate);

  const editorState = EditorState.create({
    doc: ex.startCode,
    extensions: [
      keymapGuard,
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
      ...structuralCoreExtensions(),
      validationListener,
    ],
  });

  const view = new EditorView({ state: editorState, parent: container });

  placeCursor(view, ex.startCode, ex.startCursorText);
  view.focus();

  return view;
}

function createTargetEditor(
  container: HTMLDivElement,
  ex: Exercise,
): EditorView {
  container.innerHTML = "";

  const settings = getAppSettings();
  const theme = themes[settings.editor?.theme] ?? themes[defaultTheme];

  const editorState = EditorState.create({
    doc: ex.targetCode,
    extensions: [
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
      EditorView.editable.of(false),
    ],
  });

  const view = new EditorView({ state: editorState, parent: container });

  placeCursor(view, ex.targetCode, ex.targetCursorText);

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
