import type { EditorView } from "@codemirror/view";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import type { ActionId } from "../lib/keybindings/actions";

import {
  navigateIn,
  navigateOut,
  navigateNext,
  navigatePrev,
  navigateRight,
  navigateLeft,
  navigateUp,
  navigateDown,
  findNodeAt,
} from "../editors/extensions/structure/new-structure";
import { getTrimmedRange, performNavigation } from "../editors/extensions/structure";
import * as ch from "../contracts/gamepadChannels";

type NavigationFn = (state: EditorState) => EditorState;
const typedNavigateIn = navigateIn as NavigationFn;
const typedNavigateOut = navigateOut as NavigationFn;
const typedNavigateUp = navigateUp as NavigationFn;
const typedNavigateDown = navigateDown as NavigationFn;
const typedNavigateLeft = navigateLeft as NavigationFn;
const typedNavigateRight = navigateRight as NavigationFn;
const typedNavigateNext = navigateNext as NavigationFn;
const typedNavigatePrev = navigatePrev as NavigationFn;

const typedFindNodeAt = findNodeAt as (
  state: EditorState,
  from: number,
  to?: number,
) => SyntaxNode | null;

const typedGetTrimmedRange = getTrimmedRange as (
  node: SyntaxNode,
  state: EditorState,
) => { from: number; to: number } | null;

const typedPerformNavigation = performNavigation as (
  view: EditorView,
  navFn: NavigationFn,
) => boolean;

export type ActionGate = (actionId: ActionId) => "allow" | "block";

export interface ZenNavigationHandle {
  dispose(): void;
}

function getCursorNode(view: EditorView): SyntaxNode | null {
  if (!view) return null;
  const selection = view.state.selection.main;
  return typedFindNodeAt(view.state, selection.from, selection.to);
}

function deleteNodeAtCursor(view: EditorView): boolean {
  if (!view) return false;
  const node = getCursorNode(view);
  if (!node) return false;
  const range = typedGetTrimmedRange(node, view.state);
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

    const navigationMap: Record<string, NavigationFn> =
      navigationMode === "spatial"
        ? {
            up: typedNavigateUp,
            down: typedNavigateDown,
            left: typedNavigateLeft,
            right: typedNavigateRight,
          }
        : {
            up: typedNavigatePrev,
            down: typedNavigateNext,
            left: typedNavigatePrev,
            right: typedNavigateNext,
          };

    const handler = navigationMap[direction];
    if (handler && typedPerformNavigation(view, handler)) {
      hideEditorCursor(view);
    }
  });

  const unsubEnter = ch.enter.subscribe(() => {
    if (!view) return;
    if (gate("nav.enter") === "block") return;
    if (typedPerformNavigation(view, typedNavigateIn)) {
      hideEditorCursor(view);
    }
  });

  const unsubBack = ch.back.subscribe(() => {
    if (!view) return;
    if (gate("nav.back") === "block") return;
    if (typedPerformNavigation(view, typedNavigateOut)) {
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
