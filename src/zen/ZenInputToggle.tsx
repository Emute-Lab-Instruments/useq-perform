import { Component } from "solid-js";
import { state, setDetectedInput } from "./store";

const KeyboardIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
    <rect x="2" y="6" width="20" height="12" rx="2" />
    <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M10 14h.01M14 14h.01M18 14h.01" />
    <path d="M8 14h8" />
  </svg>
);

const GamepadIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round">
    <path d="M7 8h10a4 4 0 0 1 4 4v1a3 3 0 0 1-5.5 1.7L14 13h-4l-1.5 1.7A3 3 0 0 1 3 13v-1a4 4 0 0 1 4-4Z" />
    <path d="M8 11v2M7 12h2" stroke-linecap="round" />
    <circle cx="15" cy="11.5" r="0.7" fill="currentColor" stroke="none" />
    <circle cx="17" cy="12.5" r="0.7" fill="currentColor" stroke="none" />
  </svg>
);

const ZenInputToggle: Component = () => {
  const isGamepad = () => state.detectedInput === "gamepad";
  return (
    <div class="zen-input-toggle" role="group" aria-label="Input mode">
      <button
        type="button"
        class="zen-input-toggle-btn"
        classList={{ "zen-input-toggle-active": !isGamepad() }}
        onClick={() => setDetectedInput("keyboard")}
        title="Keyboard hints"
        aria-pressed={!isGamepad()}
      >
        <KeyboardIcon />
      </button>
      <button
        type="button"
        class="zen-input-toggle-btn"
        classList={{ "zen-input-toggle-active": isGamepad() }}
        onClick={() => setDetectedInput("gamepad")}
        title="Gamepad hints"
        aria-pressed={isGamepad()}
      >
        <GamepadIcon />
      </button>
    </div>
  );
};

export default ZenInputToggle;
