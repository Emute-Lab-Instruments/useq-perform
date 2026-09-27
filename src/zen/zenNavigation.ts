import type { EditorView } from "@codemirror/view";
import type { ActionId } from "../lib/keybindings/actions";

import {
  executeEditorCommand,
} from "../editors/commands/editorCommandRouter.ts";
import type { StructuralAction } from "../editors/extensions/structure/adapter/dispatcher";

export type ActionGate = (actionId: ActionId) => "allow" | "block";

export interface ZenNavigationHandle {
  /**
   * Forward a gamepad-resolved ActionId from the gamepad pipeline's
   * `onAction` observer. Implements the same gating + structural-dispatch
   * logic as keyboard, so an exercise can be cleared from either input.
   * Returns true if the action was consumed (the gate did not block and
   * the dispatcher ran successfully).
   */
  onAction(actionId: ActionId): boolean;
  dispose(): void;
}

function hideEditorCursor(view: EditorView): void {
  if (view?.dom) view.dom.classList.add("hide-cursor");
}

// Map an ActionId to the structural-dispatcher action name. Only listed
// actions are routed; everything else is ignored by the zen bridge.
const ACTION_TO_DISPATCH: Partial<Record<ActionId, StructuralAction>> = {
  "nav.up": "nav.up",
  "nav.down": "nav.down",
  "nav.left": "nav.left",
  "nav.right": "nav.right",
  "nav.in": "nav.in",
  "nav.out": "nav.out",
  "nav.next": "nav.next",
  "nav.prev": "nav.prev",
};

export function bindZenGamepadNavigation(
  view: EditorView,
  gate: ActionGate,
): ZenNavigationHandle {
  const pointerListener = () => {
    if (view?.dom) view.dom.classList.remove("hide-cursor");
  };
  if (view?.dom) {
    view.dom.addEventListener("pointerdown", pointerListener);
  }

  function onAction(actionId: ActionId): boolean {
    if (!view) return false;
    if (gate(actionId) === "block") return false;

    if (actionId === "edit.delete") {
      if (executeEditorCommand(view, {
        kind: "structural",
        action: "edit.delete",
        source: "gamepad",
      })) {
        hideEditorCursor(view);
        return true;
      }
      return false;
    }

    const dispatchName = ACTION_TO_DISPATCH[actionId];
    if (dispatchName && executeEditorCommand(view, {
      kind: "structural",
      action: dispatchName,
      source: "gamepad",
    })) {
      hideEditorCursor(view);
      return true;
    }
    return false;
  }

  return {
    onAction,
    dispose() {
      if (view?.dom) {
        view.dom.removeEventListener("pointerdown", pointerListener);
      }
    },
  };
}
