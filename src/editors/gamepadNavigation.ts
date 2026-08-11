// src/editors/gamepadNavigation.ts
//
// Owns the editor-specific half of gamepad integration: reads structural
// cursor context for the lower-layer recognizer and applies the continuous
// manual-control axis stream.
//
// Spatial navigation (`nav.up`/`nav.down`/`nav.left`/`nav.right`) flows
// directly through the keybindings handler registry from the gamepad
// pipeline (see `src/lib/gamepad/index.ts` → `createActionRunner`). This
// module covers the remaining channel-driven manual-control stick axis.

import type { EditorView } from "@codemirror/view";

import { executeEditorCommand } from "./commands/editorCommandRouter.ts";
import type { GamepadEditorContext } from "../lib/gamepad/index.ts";
import {
  insertionModeField,
  structField,
} from "./extensions/structure/adapter/stateField.ts";
import {
  findById,
  isLeaf,
  type LeafKind,
} from "./extensions/structure/core/index.ts";

import * as ch from "../contracts/gamepadChannels";

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

/** Read CodeMirror/structural state without pulling editor modules into lib/. */
export function readGamepadEditorContext(
  view: EditorView,
): GamepadEditorContext {
  const insertionMode = view.state.field(insertionModeField, false) ?? false;
  const structural = view.state.field(structField, false);
  if (!structural) {
    return { insertionMode, cursorOnLeafAtom: false, cursorNodeKind: null };
  }

  const primary = structural.state.cursors.primary;
  if (primary.kind !== "node") {
    return { insertionMode, cursorOnLeafAtom: false, cursorNodeKind: null };
  }

  const node = findById(structural.state.tree.root, primary.target);
  if (!node || !isLeaf(node) || node.kind === "document") {
    return { insertionMode, cursorOnLeafAtom: false, cursorNodeKind: null };
  }

  return {
    insertionMode,
    cursorOnLeafAtom: true,
    cursorNodeKind: node.kind as LeafKind,
  };
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
      unsubStickAxis();
      if (view?.dom) {
        view.dom.removeEventListener("pointerdown", pointerListener);
      }
      document.removeEventListener("mousemove", mouseMoveListener);
      showSystemCursor();
    },
  };
}
