import type { EditorView } from "@codemirror/view";
import type { ActionId } from "../lib/keybindings/actions";

import { findNodeAt, getTrimmedRange } from "../editors/extensions/lezerHelpers";
import { dispatchAction } from "../editors/extensions/structure/adapter/dispatcher";
import * as ch from "../contracts/gamepadChannels";

export type ActionGate = (actionId: ActionId) => "allow" | "block";

export interface ZenNavigationHandle {
  dispose(): void;
}

function deleteNodeAtCursor(view: EditorView): boolean {
  if (!view) return false;
  const selection = view.state.selection.main;
  const node = findNodeAt(view.state, selection.from, selection.to);
  if (!node) return false;
  const range = getTrimmedRange(node, view.state);
  if (!range) return false;

  const doc = view.state.doc;
  let whitespaceEnd = range.to;
  const docLen = doc.length;
  while (whitespaceEnd < docLen) {
    const char = doc.sliceString(whitespaceEnd, whitespaceEnd + 1);
    if (char === " " || char === "\t") {
      whitespaceEnd += 1;
    } else if (char === "\n") {
      whitespaceEnd += 1;
      break;
    } else {
      break;
    }
  }

  view.dispatch({
    changes: { from: range.from, to: whitespaceEnd, insert: "" },
    selection: { anchor: range.from },
    scrollIntoView: true,
    userEvent: "delete.node",
  });
  return true;
}

function hideEditorCursor(view: EditorView): void {
  if (view?.dom) view.dom.classList.add("hide-cursor");
}

const directionToActionId: Record<string, Record<string, ActionId>> = {
  spatial: {
    up: "nav.structuralUp",
    down: "nav.structuralDown",
    left: "nav.structuralLeft",
    right: "nav.structuralRight",
  },
  structural: {
    up: "nav.structuralUp",
    down: "nav.structuralDown",
    left: "nav.structuralLeft",
    right: "nav.structuralRight",
  },
};

// Direction → dispatcher action name, per navigation mode.
// - spatial:   geometric movement (up/down/left/right by source position)
// - structural: sibling-step (prev/next regardless of axis)
const directionToDispatch: Record<
  "spatial" | "structural",
  Record<string, string>
> = {
  spatial: {
    up: "nav.up",
    down: "nav.down",
    left: "nav.left",
    right: "nav.right",
  },
  structural: {
    up: "nav.prev",
    down: "nav.next",
    left: "nav.prev",
    right: "nav.next",
  },
};

export function bindZenGamepadNavigation(
  view: EditorView,
  gate: ActionGate,
): ZenNavigationHandle {
  let navigationMode: "spatial" | "structural" = "spatial";

  const pointerListener = () => {
    if (view?.dom) view.dom.classList.remove("hide-cursor");
  };
  if (view?.dom) {
    view.dom.addEventListener("pointerdown", pointerListener);
  }

  const unsubNavigate = ch.navigate.subscribe(({ direction }) => {
    if (!view) return;

    const actionId = directionToActionId[navigationMode]?.[direction];
    if (actionId && gate(actionId) === "block") return;

    const dispatchName = directionToDispatch[navigationMode]?.[direction];
    if (dispatchName && dispatchAction(view, dispatchName)) {
      hideEditorCursor(view);
    }
  });

  const unsubEnter = ch.enter.subscribe(() => {
    if (!view) return;
    if (gate("nav.enter") === "block") return;
    if (dispatchAction(view, "nav.in")) {
      hideEditorCursor(view);
    }
  });

  const unsubBack = ch.back.subscribe(() => {
    if (!view) return;
    if (gate("nav.back") === "block") return;
    if (dispatchAction(view, "nav.out")) {
      hideEditorCursor(view);
    }
  });

  const unsubToggleNavMode = ch.toggleNavMode.subscribe(() => {
    navigationMode =
      navigationMode === "structural" ? "spatial" : "structural";
  });

  const unsubDeleteNode = ch.deleteNode.subscribe(() => {
    if (!view) return;
    if (gate("edit.delete") === "block") return;
    if (deleteNodeAtCursor(view)) hideEditorCursor(view);
  });

  // Slurp/barf channels don't exist yet as typed channels —
  // they go through the keyboard resolver. If/when they're wired
  // to gamepad, add subscribers here with gate checks.

  return {
    dispose() {
      unsubNavigate();
      unsubEnter();
      unsubBack();
      unsubToggleNavMode();
      unsubDeleteNode();
      if (view?.dom) {
        view.dom.removeEventListener("pointerdown", pointerListener);
      }
    },
  };
}
