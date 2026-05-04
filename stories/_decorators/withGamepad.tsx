// stories/_decorators/withGamepad.tsx
//
// Reusable Storybook decorator factory that spins up a real gamepad pipeline
// for the duration of a story. Drop onto any story via:
//
//   decorators: [withGamepad({ paradigm: 'modal-shift' })]
//
// Behaviour:
// - Stands up `useGamepadPipeline()` (the same recognizer + resolver
//   primitives the production code uses, see src/lib/gamepad/storybook.ts).
//   The pipeline only does meaningful work when a gamepad is actually
//   connected — the underlying manager poll returns `null` otherwise.
// - Renders a small low-opacity status pill in the bottom-right showing
//   "connected (id)" or "not connected", driven by `useGamepadSnapshot()`.
// - Disposes the pipeline + snapshot poller on story unmount via Solid's
//   `onCleanup`.
// - Wraps the story output unchanged.
//
// Boundary-clean: no imports from src/ui/, src/runtime/, src/effects/,
// src/transport/, or src/editors/ — only consumes the Storybook-friendly
// helpers in `src/lib/gamepad/storybook.ts`.

import { Show, type JSX } from "solid-js";
import type { EditorView } from "@codemirror/view";
import {
  createJSXDecorator,
  type Decorator,
} from "storybook-solidjs-vite";

import {
  useGamepadPipeline,
  useGamepadSnapshot,
  type Paradigm,
} from "@src/lib/gamepad/storybook";

export interface WithGamepadOptions {
  /** Which layer paradigm to load. Defaults to "modal-shift". */
  readonly paradigm?: Paradigm;
  /**
   * Lazy accessor for the EditorView the pipeline should target. Called once
   * on decorator mount; pass `() => editorRef()` to forward a Solid signal.
   */
  readonly getEditor?: () => EditorView | undefined;
}

const PILL_STYLE: JSX.CSSProperties = {
  position: "fixed",
  bottom: "8px",
  right: "8px",
  "z-index": "2147483646",
  "font-family":
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  "font-size": "11px",
  "line-height": "1",
  padding: "4px 8px",
  "border-radius": "999px",
  background: "rgba(0, 0, 0, 0.55)",
  color: "rgba(255, 255, 255, 0.9)",
  "pointer-events": "none",
  opacity: "0.55",
  "user-select": "none",
};

/**
 * Internal component — created inside the decorator's JSX so Solid's
 * reactive scope is active when `useGamepadPipeline`/`useGamepadSnapshot`
 * register their `onCleanup` handlers.
 */
function GamepadStatusPill(props: {
  paradigm?: Paradigm;
  getEditor?: () => EditorView | undefined;
  children: JSX.Element;
}): JSX.Element {
  // Stand up the pipeline. The hook registers its own `onCleanup`, so when
  // the story unmounts the pipeline is torn down automatically.
  useGamepadPipeline({
    paradigm: props.paradigm,
    editor: props.getEditor?.(),
  });

  const snap = useGamepadSnapshot();

  return (
    <>
      {props.children}
      <div
        style={PILL_STYLE}
        data-testid="gamepad-status-pill"
        aria-live="polite"
      >
        <Show
          when={snap()}
          fallback={<span>{"\u{1F3AE} not connected"}</span>}
          keyed
        >
          {(s) => <span>{`\u{1F3AE} connected (${s.id || "?"})`}</span>}
        </Show>
      </div>
    </>
  );
}

/**
 * Storybook decorator factory. Returns a `Decorator` that wraps the story in
 * a live gamepad pipeline + status pill.
 */
export function withGamepad(options: WithGamepadOptions = {}): Decorator {
  return createJSXDecorator((Story: () => JSX.Element) => (
    <GamepadStatusPill
      paradigm={options.paradigm}
      getEditor={options.getEditor}
    >
      {Story()}
    </GamepadStatusPill>
  ));
}
