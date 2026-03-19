// src/editors/gamepadNavigation.ts
//
// Subscribes to gamepad intent channels and drives CodeMirror structural
// navigation + editor actions. Has no knowledge of the gamepad polling
// system — it only reacts to published intents.

import type { EditorView } from "@codemirror/view";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

import {
  navigateIn,
  navigateNext,
  navigateOut,
  navigatePrev,
  navigateRight,
  navigateLeft,
  navigateUp,
  navigateDown,
  findNodeAt,
} from "./extensions/structure/new-structure.ts";
import { getTrimmedRange, performNavigation } from "./extensions/structure.ts";
import { evaluate } from "../effects/editorEvaluation.ts";
import { sendSerialInputStreamValue } from "../transport/json-protocol.ts";
import {
  clearManualControlBinding,
  getManualControlBinding,
  setManualControlBinding,
  slotForStick,
  type ManualControlBinding,
} from "../lib/manualControlState.ts";

import * as ch from "../contracts/gamepadChannels";

// ---------------------------------------------------------------------------
// Typed navigation fn casts (upstream modules are @ts-nocheck)
// ---------------------------------------------------------------------------

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
  to?: number
) => SyntaxNode | null;

const typedGetTrimmedRange = getTrimmedRange as (
  node: SyntaxNode,
  state: EditorState
) => { from: number; to: number } | null;

const typedPerformNavigation = performNavigation as (
  view: EditorView,
  navFn: NavigationFn
) => boolean;

const typedEvaluate = evaluate as (
  view: EditorView,
  strategy: "toplevel" | "expression" | "soft",
) => boolean;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MANUAL_CONTROL_SEND_HZ = 30;
const MANUAL_CONTROL_SEND_INTERVAL_MS = Math.ceil(
  1000 / MANUAL_CONTROL_SEND_HZ
);
const MANUAL_CONTROL_EPSILON = 1e-6;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function getCursorNode(view: EditorView): SyntaxNode | null {
  if (!view) return null;
  const selection = view.state.selection.main;
  return typedFindNodeAt(view.state, selection.from, selection.to);
}

function deleteNodeAtCursor(view: EditorView): boolean {
  if (!view) return false;
  const state = view.state;
  const node = getCursorNode(view);
  if (!node) return false;
  const range = typedGetTrimmedRange(node, state);
  if (!range) return false;

  const doc = state.doc;
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

function isNumberNode(node: SyntaxNode | null): boolean {
  return (
    node != null &&
    (node.type?.name === "Number" || (node.type as unknown) === "Number")
  );
}

function getNumberNodeValue(
  node: SyntaxNode,
  state: EditorState
): number | null {
  if (typeof node.from !== "number" || typeof node.to !== "number") return null;
  const text = state.doc.sliceString(node.from, node.to);
  const num = Number(text);
  return Number.isNaN(num) ? null : num;
}

function setNumberNodeValue(
  view: EditorView,
  node: SyntaxNode,
  value: number
): void {
  if (!view) return;
  if (typeof node.from !== "number" || typeof node.to !== "number") return;
  const doc = view.state.doc;
  const originalText = doc.sliceString(node.from, node.to);
  const match = originalText.match(/^(\s*)(.*?)(\s*)$/);
  const leading = match ? match[1] : "";
  const trailing = match ? match[3] : "";
  const newText = `${leading}${value}${trailing}`;

  view.dispatch({
    changes: { from: node.from, to: node.to, insert: newText },
    selection: { anchor: node.from + leading.length },
    scrollIntoView: true,
    userEvent: "edit.number",
  });
}

function adjustNumberAtCursor(view: EditorView, delta: number): boolean {
  if (!view) return false;
  const state = view.state;
  const node = getCursorNode(view);
  if (!node || !isNumberNode(node)) return false;
  const currentValue = getNumberNodeValue(node, state);
  if (currentValue === null) return false;
  setNumberNodeValue(view, node, currentValue + delta);
  return true;
}

function formatManualControlNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (Object.is(value, -0)) value = 0;
  const abs = Math.abs(value);
  let text: string;
  if (abs === 0) {
    text = "0";
  } else if (abs < 0.001) {
    text = value.toExponential(3);
  } else if (abs < 100) {
    text = value.toFixed(4);
  } else if (abs < 10000) {
    text = value.toFixed(2);
  } else {
    text = String(Math.round(value));
  }

  if (text.includes(".") && !text.includes("e")) {
    text = text.replace(/\.?0+$/, "");
  }
  return text;
}

function getNodeRangeAtCursor(
  view: EditorView
): { from: number; to: number } | null {
  if (!view) return null;
  const node = getCursorNode(view);
  if (!node) return null;
  const range = typedGetTrimmedRange(node, view.state) || node;
  if (typeof range?.from !== "number" || typeof range?.to !== "number")
    return null;
  return { from: range.from, to: range.to };
}

function getNumericSeedFromText(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : null;
}

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

  const unsubNavigate = ch.navigate.subscribe(({ direction }) => {
    if (!view) return;
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
    if (typedPerformNavigation(view, typedNavigateIn)) {
      hideEditorCursor(view);
    }
  });

  const unsubBack = ch.back.subscribe(() => {
    if (!view) return;
    if (typedPerformNavigation(view, typedNavigateOut)) {
      hideEditorCursor(view);
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

  // -- Delete node ----------------------------------------------------------

  const unsubDeleteNode = ch.deleteNode.subscribe(() => {
    if (!view) return;
    const removed = deleteNodeAtCursor(view);
    if (removed) hideEditorCursor(view);
  });

  // -- Number adjustment ----------------------------------------------------

  const unsubAdjustNumber = ch.adjustNumber.subscribe(({ delta }) => {
    if (!view) return;
    const adjusted = adjustNumberAtCursor(view, delta);
    if (adjusted) hideEditorCursor(view);
  });

  // -- Manual control -------------------------------------------------------

  const unsubToggleManualControl = ch.toggleManualControl.subscribe(
    ({ stick }) => {
      if (!view) return;
      const existing = getManualControlBinding(stick);
      if (existing) {
        clearManualControlBinding(stick);
        return;
      }

      const range = getNodeRangeAtCursor(view);
      if (!range) return;

      const originalText = view.state.doc.sliceString(range.from, range.to);
      const seed = getNumericSeedFromText(originalText);
      const value = seed ?? 0;
      const slot = slotForStick(stick);

      const text = formatManualControlNumber(value);
      view.dispatch({
        changes: { from: range.from, to: range.to, insert: text },
        selection: { anchor: range.from + text.length },
        scrollIntoView: true,
        userEvent: "manualControl.bind",
      });
      hideEditorCursor(view);

      const binding: ManualControlBinding = {
        stick,
        slot,
        from: range.from,
        to: range.from + text.length,
        value,
        originalText,
        lastSentAt: 0,
        lastSentValue: NaN,
      };
      setManualControlBinding(stick, binding);

      sendSerialInputStreamValue(slot, value).catch(() => {});
    }
  );

  const nowFn = () => Date.now();

  const unsubStickAxis = ch.stickAxis.subscribe(({ stick, x, y }) => {
    if (!view) return;

    const binding = getManualControlBinding(stick);
    if (!binding) return;

    const nowMs = nowFn();
    if (
      binding.lastSentAt &&
      nowMs - binding.lastSentAt < MANUAL_CONTROL_SEND_INTERVAL_MS
    ) {
      return;
    }

    if (x === 0 && y === 0) {
      binding.lastSentAt = nowMs;
      return;
    }

    const base = 0.01 * Math.max(1, Math.abs(binding.value));
    const k = 3;
    const sensitivity = base * Math.pow(10, k * x);
    const nextValue = binding.value + -y * sensitivity;

    if (
      Number.isFinite(binding.lastSentValue) &&
      Math.abs(nextValue - binding.lastSentValue) < MANUAL_CONTROL_EPSILON
    ) {
      binding.lastSentAt = nowMs;
      return;
    }

    binding.value = nextValue;
    binding.lastSentValue = nextValue;
    binding.lastSentAt = nowMs;

    const text = formatManualControlNumber(nextValue);

    view.dispatch({
      changes: { from: binding.from, to: binding.to, insert: text },
      selection: { anchor: binding.from + text.length },
      scrollIntoView: false,
      userEvent: "manualControl.update",
    });
    binding.to = binding.from + text.length;

    sendSerialInputStreamValue(binding.slot, nextValue).catch(() => {});
  });

  // -- Dispose --------------------------------------------------------------

  return {
    dispose() {
      unsubNavigate();
      unsubEnter();
      unsubBack();
      unsubToggleNavMode();
      unsubEval();
      unsubDeleteNode();
      unsubAdjustNumber();
      unsubToggleManualControl();
      unsubStickAxis();
      if (view?.dom) {
        view.dom.removeEventListener("pointerdown", pointerListener);
      }
    },
  };
}
