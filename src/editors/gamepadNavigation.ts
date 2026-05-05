// src/editors/gamepadNavigation.ts
//
// Subscribes to remaining gamepad intent channels and drives editor
// commands for non-structural concerns. Has no knowledge of the gamepad
// polling system — it only reacts to published intents.
//
// Spatial navigation (`nav.up`/`nav.down`/`nav.left`/`nav.right`) flows
// directly through the keybindings handler registry from the gamepad
// pipeline (see `src/lib/gamepad/index.ts` → `createActionRunner`). This
// module covers the remaining channel-driven intents — eval and the
// manual-control stick axis — pending Track G/H.

import type { EditorView } from "@codemirror/view";

import { evaluate } from "../effects/editorEvaluation.ts";
import { executeEditorCommand } from "./commands/editorCommandRouter.ts";

import * as ch from "../contracts/gamepadChannels";

const typedEvaluate = evaluate as (
  view: EditorView,
  strategy: "toplevel" | "expression" | "soft",
) => boolean;

// ---------------------------------------------------------------------------
// Cursor helpers
// ---------------------------------------------------------------------------

function showEditorCursor(view: EditorView): void {
  if (view?.dom) {
    view.dom.classList.remove("hide-cursor");
  }
}

function hideEditorCursor(view: EditorView): void {
  if (view?.dom) {
    view.dom.classList.add("hide-cursor");
  }
}

export function hideSystemCursor(): void {
  document.body.classList.add("gamepad-active");
}

function showSystemCursor(): void {
  document.body.classList.remove("gamepad-active");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface GamepadNavigationHandle {
  dispose(): void;
}

/**
 * Wire up remaining gamepad intent channels to CodeMirror editor actions.
 * Returns a handle to unsubscribe all listeners.
 */
export function bindGamepadNavigation(
  view: EditorView
): GamepadNavigationHandle {
  // Restore cursors on pointer interaction
  const pointerListener = () => showEditorCursor(view);
  if (view?.dom) {
    view.dom.addEventListener("pointerdown", pointerListener);
  }

  // Restore system cursor on mouse movement
  const mouseMoveListener = () => showSystemCursor();
  document.addEventListener("mousemove", mouseMoveListener);

  // -- Eval -----------------------------------------------------------------

  const unsubEval = ch.evalNow.subscribe(() => {
    if (!view) return;
    typedEvaluate(view, "expression");
  });

  // -- Manual control -------------------------------------------------------

  const unsubStickAxis = ch.stickAxis.subscribe(({ stick, x, y }) => {
    if (!view) return;
    const updated = executeEditorCommand(view, {
      kind: "manualControlAxis",
      stick,
      x,
      y,
      source: "gamepad",
    });
    if (updated) hideEditorCursor(view);
    hideSystemCursor();
  });

  // -- Dispose --------------------------------------------------------------

  return {
    dispose() {
      unsubEval();
      unsubStickAxis();
      if (view?.dom) {
        view.dom.removeEventListener("pointerdown", pointerListener);
      }
      document.removeEventListener("mousemove", mouseMoveListener);
      showSystemCursor();
    },
  };
}
