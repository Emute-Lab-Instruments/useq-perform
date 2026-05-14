import { Component, Show, onMount, onCleanup, createSignal, createEffect } from "solid-js";
import { state, returnToGrid, enterExercise, setDetectedInput, getFirstIncomplete } from "./store";
import { categories, getExercisesByCategory, getExercise, type Exercise } from "./exercises";
import ZenGrid from "./ZenGrid";
import ZenExercise from "./ZenExercise";
import { createGamepadPipeline, type GamepadPipeline } from "../lib/gamepad/index";
import { publishZenAction, subscribeZenAction } from "./zenActionBus";
import type { ActionId } from "../lib/keybindings/actions";
import { buildZenHash, parseZenHash, ZEN_HASH_PREFIX } from "./routing";
import "./zen.css";

const ZenMode: Component = () => {
  let gamepadPipeline: GamepadPipeline | undefined;
  const [focusedRow, setFocusedRow] = createSignal(0);
  const [focusedCol, setFocusedCol] = createSignal(0);

  function getRowExercises(row: number): Exercise[] {
    if (row < 0 || row >= categories.length) return [];
    return getExercisesByCategory(categories[row].id);
  }

  function focusedExercise(): Exercise | null {
    const exercises = getRowExercises(focusedRow());
    const col = focusedCol();
    if (col < 0 || col >= exercises.length) return null;
    return exercises[col];
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      if (state.view === "exercise") {
        returnToGrid();
      } else {
        exitZenMode();
      }
      return;
    }

    if (state.view !== "grid") return;

    switch (e.key) {
      case "ArrowUp":
        navigateGrid("up");
        e.preventDefault();
        break;
      case "ArrowDown":
        navigateGrid("down");
        e.preventDefault();
        break;
      case "ArrowLeft":
        navigateGrid("left");
        e.preventDefault();
        break;
      case "ArrowRight":
        navigateGrid("right");
        e.preventDefault();
        break;
      case "Enter":
        selectFocused();
        e.preventDefault();
        break;
    }
  }

  function navigateGrid(direction: "up" | "down" | "left" | "right") {
    const row = focusedRow();
    const col = focusedCol();

    switch (direction) {
      case "up": {
        const newRow = Math.max(0, row - 1);
        setFocusedRow(newRow);
        const maxCol = getRowExercises(newRow).length - 1;
        if (col > maxCol) setFocusedCol(maxCol);
        break;
      }
      case "down": {
        const newRow = Math.min(categories.length - 1, row + 1);
        setFocusedRow(newRow);
        const maxCol = getRowExercises(newRow).length - 1;
        if (col > maxCol) setFocusedCol(maxCol);
        break;
      }
      case "left":
        setFocusedCol(Math.max(0, col - 1));
        break;
      case "right": {
        const maxCol = getRowExercises(row).length - 1;
        setFocusedCol(Math.min(maxCol, col + 1));
        break;
      }
    }
  }

  function selectFocused() {
    const ex = focusedExercise();
    if (ex) enterExercise(ex.id);
  }

  // -- Gamepad action subscriptions --
  //
  // The grid handler runs only while view === "grid"; ZenExercise
  // separately subscribes for the editor while view === "exercise". The
  // bus invokes handlers in registration order and short-circuits on the
  // first true return — registering this handler at mount keeps it below
  // any later-registered exercise handlers (per Solid component lifecycle
  // ordering); when in the grid state, the exercise handler isn't
  // registered, so this handler fires.
  let unsubGridAction: (() => void) | undefined;

  onMount(() => {
    document.addEventListener("keydown", handleKeydown);
    document.body.classList.add("zen-active");

    window.addEventListener("gamepadconnected", onGamepadConnected);
    window.addEventListener("gamepaddisconnected", onGamepadDisconnected);
    window.addEventListener("hashchange", onHashChange);

    // Keep URL in sync with the active exercise. When state changes, push a
    // new history entry so the back button steps through visited exercises.
    // The hashchange listener handles paste/back/forward in the reverse
    // direction; both sides no-op when hash and state already agree, so the
    // two reactions can't ping-pong.
    createEffect(() => {
      const desired = state.view === "exercise" && state.activeExerciseId
        ? buildZenHash(state.activeExerciseId)
        : buildZenHash(null);
      if (window.location.hash !== desired) {
        history.pushState(null, "", desired);
      }
    });

    // Start gamepad pipeline. Any fired ActionId is forwarded to the
    // zen action bus; the active surface (grid here, or exercise in
    // ZenExercise) consumes it.
    gamepadPipeline = createGamepadPipeline({
      onAction: (action: ActionId) => {
        publishZenAction(action);
      },
    });
    gamepadPipeline.start();
    console.log("[zen] Gamepad pipeline started, polling for controllers...");

    const gamepads = navigator.getGamepads?.() ?? [];
    for (const gp of gamepads) {
      if (gp) {
        console.log(`[zen] Gamepad already connected: "${gp.id}" (index ${gp.index})`);
        setDetectedInput("gamepad");
      }
    }

    unsubGridAction = subscribeZenAction((action) => {
      if (state.view !== "grid") return false;
      switch (action) {
        case "nav.up":
          navigateGrid("up");
          return true;
        case "nav.down":
          navigateGrid("down");
          return true;
        case "nav.left":
          navigateGrid("left");
          return true;
        case "nav.right":
          navigateGrid("right");
          return true;
        case "nav.in":
          // Treat tree-descend as "select" while on the grid.
          selectFocused();
          return true;
        case "nav.out":
          // Treat tree-ascend as "exit zen" while on the grid.
          exitZenMode();
          return true;
        default:
          return false;
      }
    });
  });

  onCleanup(() => {
    document.removeEventListener("keydown", handleKeydown);
    document.body.classList.remove("zen-active");
    window.removeEventListener("gamepadconnected", onGamepadConnected);
    window.removeEventListener("gamepaddisconnected", onGamepadDisconnected);
    window.removeEventListener("hashchange", onHashChange);

    unsubGridAction?.();

    if (gamepadPipeline) {
      gamepadPipeline.dispose();
      gamepadPipeline = undefined;
      console.log("[zen] Gamepad pipeline disposed");
    }
  });

  function onGamepadConnected(e: GamepadEvent) {
    console.log(`[zen] Gamepad connected: "${e.gamepad.id}" (index ${e.gamepad.index})`);
    setDetectedInput("gamepad");
  }

  function onGamepadDisconnected(e: GamepadEvent) {
    console.log(`[zen] Gamepad disconnected: "${e.gamepad.id}" (index ${e.gamepad.index})`);
  }

  function onHashChange() {
    const hash = window.location.hash;
    if (!hash.startsWith(ZEN_HASH_PREFIX)) {
      // User navigated outside the zen URL space (e.g. back past the grid).
      // Reload so the main app boots normally.
      window.location.reload();
      return;
    }
    const { exerciseId } = parseZenHash(hash);
    if (exerciseId && state.activeExerciseId === exerciseId) return;
    if (exerciseId) {
      const ex = getExercise(exerciseId);
      if (ex) {
        enterExercise(ex.id);
        return;
      }
      // Unknown id — rewrite the URL back to the current view so the user
      // doesn't end up staring at a misleading link.
      if (state.view === "exercise") returnToGrid();
      else history.replaceState(null, "", buildZenHash(null));
      return;
    }
    if (state.view === "exercise") returnToGrid();
  }

  function exitZenMode() {
    window.location.hash = "";
    window.location.reload();
  }

  return (
    <div class="zen-root">
      <Show when={state.view === "grid"}>
        <ZenGrid
          onExit={exitZenMode}
          focusedRow={focusedRow()}
          focusedCol={focusedCol()}
        />
      </Show>
      <Show when={state.view === "exercise"}>
        <ZenExercise />
      </Show>
    </div>
  );
};

export default ZenMode;
