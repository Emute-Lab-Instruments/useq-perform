// src/editors/gamepadNavigation.ts
//
// Subscribes to gamepad intent channels and drives CodeMirror structural
// navigation + editor commands. Has no knowledge of the gamepad polling
// system — it only reacts to published intents.
//
// Structural navigation (nav.in/out/next/prev in structural mode) is handled
// by `bindStructuralGamepadBridge` in the structure adapter. This module
// covers spatial-mode navigation, eval, and manual-control axis updates.

import type { EditorView } from "@codemirror/view";

import { evaluate } from "../effects/editorEvaluation.ts";
import { executeEditorCommand } from "./commands/editorCommandRouter.ts";
import { checkAndPublishHoleFocus } from "./holeFocusEmitter.ts";

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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface GamepadNavigationHandle {
  dispose(): void;
}

/**
 * Wire up gamepad intent channels to CodeMirror editor actions.
 * Returns a handle to unsubscribe all listeners.
 */
export function bindGamepadNavigation(
  view: EditorView
): GamepadNavigationHandle {
  let navigationMode: "spatial" | "structural" = "spatial";

  // Restore cursor on pointer interaction
  const pointerListener = () => showEditorCursor(view);
  if (view?.dom) {
    view.dom.addEventListener("pointerdown", pointerListener);
  }

  // -- Navigation -----------------------------------------------------------
  //
  // Structural-mode nav (next/prev/in/out) is routed through
  // `bindStructuralGamepadBridge` in the structure adapter. We only handle
  // spatial mode here, plus the toggleNavMode tracker so we know which mode
  // is active.

  const unsubNavigate = ch.navigate.subscribe(({ direction }) => {
    if (!view) return;
    if (navigationMode !== "spatial") return;
    const actionMap: Record<string, string> = {
      up: "nav.up",
      down: "nav.down",
      left: "nav.left",
      right: "nav.right",
    };
    const action = actionMap[direction];
    const dispatched = action
      ? executeEditorCommand(view, {
        kind: "structural",
        action,
        source: "gamepad",
      })
      : false;
    if (dispatched) {
      hideEditorCursor(view);
      checkAndPublishHoleFocus(view, "navigation");
    }
  });

  // -- Toggle nav mode ------------------------------------------------------

  const unsubToggleNavMode = ch.toggleNavMode.subscribe(() => {
    navigationMode =
      navigationMode === "structural" ? "spatial" : "structural";
  });

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
  });

  // -- Dispose --------------------------------------------------------------

  return {
    dispose() {
      unsubNavigate();
      unsubToggleNavMode();
      unsubEval();
      unsubStickAxis();
      if (view?.dom) {
        view.dom.removeEventListener("pointerdown", pointerListener);
      }
    },
  };
}
