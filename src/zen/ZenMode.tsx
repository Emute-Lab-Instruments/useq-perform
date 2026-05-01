import { Component, Show, onMount, onCleanup, createSignal } from "solid-js";
import { state, returnToGrid, enterExercise, setDetectedInput, getFirstIncomplete } from "./store";
import { categories, getExercisesByCategory, type Exercise } from "./exercises";
import ZenGrid from "./ZenGrid";
import ZenExercise from "./ZenExercise";
import { createGamepadPipeline, type GamepadPipeline } from "../lib/gamepad/index";
import * as ch from "../contracts/gamepadChannels";
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
    setDetectedInput("keyboard");

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

  // -- Gamepad channel subscriptions --

  let unsubNavigate: (() => void) | undefined;
  let unsubEnter: (() => void) | undefined;
  let unsubBack: (() => void) | undefined;
  let unsubToggleNav: (() => void) | undefined;

  onMount(() => {
    document.addEventListener("keydown", handleKeydown);
    document.body.classList.add("zen-active");

    window.addEventListener("gamepadconnected", onGamepadConnected);
    window.addEventListener("gamepaddisconnected", onGamepadDisconnected);

    // Start gamepad pipeline
    gamepadPipeline = createGamepadPipeline({});
    gamepadPipeline.start();
    console.log("[zen] Gamepad pipeline started, polling for controllers...");

    const gamepads = navigator.getGamepads?.() ?? [];
    for (const gp of gamepads) {
      if (gp) {
        console.log(`[zen] Gamepad already connected: "${gp.id}" (index ${gp.index})`);
        setDetectedInput("gamepad");
      }
    }

    // Subscribe to channels for grid navigation
    unsubNavigate = ch.navigate.subscribe(({ direction }) => {
      if (state.view !== "grid") return;
      setDetectedInput("gamepad");
      navigateGrid(direction);
    });

    unsubEnter = ch.enter.subscribe(() => {
      if (state.view !== "grid") return;
      setDetectedInput("gamepad");
      selectFocused();
    });

    unsubBack = ch.back.subscribe(() => {
      if (state.view !== "grid") return;
      setDetectedInput("gamepad");
      exitZenMode();
    });

    // Back/Select button (toggleNavMode) → also acts as "return to grid"
    unsubToggleNav = ch.toggleNavMode.subscribe(() => {
      setDetectedInput("gamepad");
      if (state.view === "exercise") {
        returnToGrid();
      } else {
        exitZenMode();
      }
    });
  });

  onCleanup(() => {
    document.removeEventListener("keydown", handleKeydown);
    document.body.classList.remove("zen-active");
    window.removeEventListener("gamepadconnected", onGamepadConnected);
    window.removeEventListener("gamepaddisconnected", onGamepadDisconnected);

    unsubNavigate?.();
    unsubEnter?.();
    unsubBack?.();
    unsubToggleNav?.();

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
