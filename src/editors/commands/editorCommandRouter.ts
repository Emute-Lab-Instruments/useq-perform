// src/editors/commands/editorCommandRouter.ts
//
// Typed command router for useq-authored editor edit intents. Keyboard,
// gamepad, menu, and tests should send command objects here instead of
// directly composing CodeMirror transactions.

import { Transaction, type ChangeSpec, type EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { runScopeHandlers } from "@codemirror/view";
import {
  deleteCharBackward,
  deleteCharForward,
  insertNewline,
  isolateHistory,
  redo,
  undo,
} from "@codemirror/commands";
import type { SyntaxNode } from "@lezer/common";

import {
  clearManualControlBinding,
  getManualControlBinding,
  setManualControlBinding,
  slotForStick,
  type ManualControlBinding,
} from "../../lib/manualControlState.ts";
import {
  findNodeAt,
  getTrimmedRange,
} from "../extensions/lezerHelpers.ts";
import { syntaxTree } from "@codemirror/language";
import { flashDeleteConfirm, deleteConfirmField } from "../extensions/deleteConfirmFlash.ts";
import { dispatchAction } from "../extensions/structure/adapter/dispatcher.ts";
import { pathsFromCursorSet } from "../extensions/structure/adapter/cursorPath.ts";
import {
  setStructState,
  structField,
} from "../extensions/structure/adapter/stateField.ts";
import {
  childrenOf,
  nodeCursor,
  singleCursor,
  type DocumentNode,
  type Node,
  type NodeId,
  type State,
} from "../extensions/structure/core/index.ts";

export type EditorCommandSource =
  | "keyboard"
  | "gamepad"
  | "menu"
  | "palette"
  | "test"
  | "system";

export type EditorCommand =
  | { kind: "key"; key: string; allowBracketUnbalancing?: boolean; source?: EditorCommandSource }
  | { kind: "typeText"; text: string; source?: EditorCommandSource }
  | { kind: "insertText"; text: string; source?: EditorCommandSource }
  | { kind: "replaceRange"; from: number; to: number; insert: string; selectionAnchor?: number; scrollIntoView?: boolean; userEvent?: string; source?: EditorCommandSource }
  | { kind: "applyChanges"; changes: ChangeSpec | readonly ChangeSpec[]; scrollIntoView?: boolean; userEvent?: string; source?: EditorCommandSource }
  | { kind: "replaceDocument"; text: string; source?: EditorCommandSource }
  | { kind: "undo"; source?: EditorCommandSource }
  | { kind: "redo"; source?: EditorCommandSource }
  | { kind: "structural"; action: string; source?: EditorCommandSource }
  | { kind: "deleteNode"; source?: EditorCommandSource }
  | { kind: "adjustNumber"; delta: number; source?: EditorCommandSource }
  | { kind: "toggleManualControl"; stick: "left" | "right"; source?: EditorCommandSource }
  | { kind: "manualControlAxis"; stick: "left" | "right"; x: number; y: number; nowMs?: number; source?: EditorCommandSource };

const MANUAL_CONTROL_SEND_HZ = 30;
const MANUAL_CONTROL_SEND_INTERVAL_MS = Math.ceil(
  1000 / MANUAL_CONTROL_SEND_HZ,
);
const MANUAL_CONTROL_EPSILON = 1e-6;
const OPENING_BRACKETS: Record<string, string> = {
  "(": ")",
  "[": "]",
  "{": "}",
  "\"": "\"",
};
const CLOSING_BRACKETS = new Set(Object.values(OPENING_BRACKETS));

const typedFindNodeAt = findNodeAt as (
  state: EditorState,
  from: number,
  to?: number,
) => SyntaxNode | null;

const typedGetTrimmedRange = getTrimmedRange as (
  node: SyntaxNode,
  state: EditorState,
) => { from: number; to: number } | null;

export function executeEditorCommand(
  view: EditorView,
  command: EditorCommand,
): boolean {
  switch (command.kind) {
    case "key":
      return pressEditorKey(view, command);

    case "typeText":
      return typeText(view, command.text);

    case "insertText":
      return replaceSelection(view, command.text, "input");

    case "replaceRange":
      return replaceRange(view, command);

    case "applyChanges":
      view.dispatch({
        changes: command.changes,
        scrollIntoView: command.scrollIntoView ?? true,
        userEvent: command.userEvent,
        annotations: isolateHistory.of("full"),
      });
      syncStructuralCursorFromSelection(view);
      return true;

    case "replaceDocument":
      return replaceWholeDocument(view, command.text);

    case "undo":
      return undo(view);

    case "redo":
      return redo(view);

    case "structural":
      return dispatchAction(view, command.action);

    case "deleteNode":
      return dispatchAction(view, "edit.delete");

    case "adjustNumber":
      return adjustNumberAtCursor(view, command.delta);

    case "toggleManualControl":
      return toggleManualControl(view, command.stick);

    case "manualControlAxis":
      return updateManualControlAxis(
        view,
        command.stick,
        command.x,
        command.y,
        command.nowMs ?? Date.now(),
      );
  }
}

function pressEditorKey(
  view: EditorView,
  command: Extract<EditorCommand, { kind: "key" }>,
): boolean {
  const key = command.key;
  if (handleBracketKey(view, key)) {
    return true;
  }

  // Backspace/Delete: the router owns all policy (bracket protection).
  // Don't delegate to keymaps — that would let third-party handlers
  // (clojure-mode close_brackets) run a parallel, potentially divergent path.
  // Other keys (Enter, etc.): keymaps provide input composition (e.g. indentation).
  if (key !== "Backspace" && key !== "Delete" && key !== "Enter") {
    if (runKeymap(view, key)) return true;
  }

  if (
    !command.allowBracketUnbalancing &&
    wouldPlainBackspaceDeleteProtectedCloser(view, key)
  ) {
    return structuralBackspace(view);
  }

  if (
    !command.allowBracketUnbalancing &&
    wouldPlainDeleteRemoveProtectedCloser(view, key)
  ) {
    return true;
  }

  switch (key) {
    case "Backspace":
      return deleteCharBackward(view);
    case "Delete":
      return deleteCharForward(view);
    case "Enter":
      return insertNewline(view);
    default:
      if (key.length === 1) {
        return replaceSelection(view, key, "input");
      }
      return false;
  }
}

function handleBracketKey(view: EditorView, key: string): boolean {
  const selection = view.state.selection.main;

  if (OPENING_BRACKETS[key]) {
    const selectedText = view.state.doc.sliceString(selection.from, selection.to);
    replaceRange(view, {
      kind: "replaceRange",
      from: selection.from,
      to: selection.to,
      insert: `${key}${selectedText}${OPENING_BRACKETS[key]}`,
      selectionAnchor: selection.empty
        ? selection.from + key.length
        : selection.to + key.length,
      scrollIntoView: true,
      userEvent: "input",
    });
    return true;
  }

  if (CLOSING_BRACKETS.has(key) && selection.empty) {
    const next = view.state.doc.sliceString(selection.from, selection.from + key.length);
    if (next === key) {
      view.dispatch({
        selection: { anchor: selection.from + key.length },
        scrollIntoView: true,
        annotations: Transaction.addToHistory.of(false),
      });
      syncStructuralCursorFromSelection(view);
      return true;
    }
  }

  if ((key === "Backspace" || key === "Delete") && selection.empty) {
    const before = view.state.doc.sliceString(selection.from - 1, selection.from);
    const after = view.state.doc.sliceString(selection.from, selection.from + 1);
    if (OPENING_BRACKETS[before] === after) {
      replaceRange(view, {
        kind: "replaceRange",
        from: selection.from - 1,
        to: selection.from + 1,
        insert: "",
        selectionAnchor: selection.from - 1,
        scrollIntoView: true,
        userEvent: "delete",
      });
      return true;
    }
  }

  return false;
}

function wouldPlainBackspaceDeleteProtectedCloser(
  view: EditorView,
  key: string,
): boolean {
  if (key !== "Backspace") return false;

  const selection = view.state.selection.main;
  if (!selection.empty) return false;

  const before = view.state.doc.sliceString(selection.from - 1, selection.from);
  return CLOSING_BRACKETS.has(before);
}

function wouldPlainDeleteRemoveProtectedCloser(
  view: EditorView,
  key: string,
): boolean {
  if (key !== "Delete") return false;

  const selection = view.state.selection.main;
  if (!selection.empty) return false;

  const after = view.state.doc.sliceString(selection.from, selection.from + 1);
  return CLOSING_BRACKETS.has(after);
}

function confirmIsActiveAt(view: EditorView, from: number): boolean {
  const field = view.state.field(deleteConfirmField, false);
  if (!field || field.size === 0) return false;
  let found = false;
  field.between(from, from + 1, (decoFrom) => {
    if (decoFrom === from) found = true;
  });
  return found;
}

function structuralBackspace(view: EditorView): boolean {
  const pos = view.state.selection.main.from;
  const tree = syntaxTree(view.state);
  const charBefore = view.state.doc.sliceString(pos - 1, pos);

  let targetNode: SyntaxNode;

  if (charBefore === '"') {
    // Cursor is after a closing quote — the Lezer tree has a `"` child token
    // inside a `String` node. Walk up to find the String ancestor.
    let node: SyntaxNode | null = tree.resolveInner(pos - 1, 1);
    while (node && node.name !== "String") {
      node = node.parent;
    }
    if (!node || pos !== node.to) return true;
    targetNode = node;
  } else {
    // Cursor is after `)` / `]` / `}` — closer token's parent is the form.
    const closerNode = tree.resolveInner(pos - 1, 1);
    const container = closerNode.parent;
    if (!container) return true;
    targetNode = container;
  }

  // Escalation (confirm flash is active on this form) — remove the whole form.
  if (confirmIsActiveAt(view, targetNode.from)) {
    view.dispatch({
      changes: { from: targetNode.from, to: targetNode.to, insert: "" },
      selection: { anchor: targetNode.from },
      scrollIntoView: true,
      userEvent: "delete",
      annotations: isolateHistory.of("full"),
    });
    syncStructuralCursorFromSelection(view);
    return true;
  }

  // First press: block deletion, flash to indicate confirm mode.
  flashDeleteConfirm(view, targetNode.from, targetNode.to);
  return true;
}

function runKeymap(view: EditorView, key: string): boolean {
  const KeyboardEventCtor =
    view.dom.ownerDocument.defaultView?.KeyboardEvent ?? KeyboardEvent;
  const event = new KeyboardEventCtor("keydown", {
    key,
    bubbles: true,
    cancelable: true,
  });
  return runScopeHandlers(view, event, "editor");
}

function typeText(view: EditorView, text: string): boolean {
  let changed = false;
  for (const char of text) {
    changed = pressEditorKey(view, { kind: "key", key: char }) || changed;
  }
  return changed;
}

function replaceSelection(
  view: EditorView,
  insert: string,
  userEvent: string,
): boolean {
  const selection = view.state.selection.main;
  return replaceRange(view, {
    kind: "replaceRange",
    from: selection.from,
    to: selection.to,
    insert,
    selectionAnchor: selection.from + insert.length,
    scrollIntoView: true,
    userEvent,
  });
}

function replaceRange(
  view: EditorView,
  command: Extract<EditorCommand, { kind: "replaceRange" }>,
): boolean {
  const change: ChangeSpec = {
    from: command.from,
    to: command.to,
    insert: command.insert,
  };
  view.dispatch({
    changes: change,
    selection: {
      anchor: command.selectionAnchor ?? command.from + command.insert.length,
    },
    scrollIntoView: command.scrollIntoView ?? true,
    userEvent: command.userEvent,
    annotations: isolateHistory.of("full"),
  });
  syncStructuralCursorFromSelection(view);
  return true;
}

function replaceWholeDocument(view: EditorView, text: string): boolean {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    selection: { anchor: text.length },
    scrollIntoView: true,
    userEvent: "input.replaceDocument",
    annotations: isolateHistory.of("full"),
  });
  syncStructuralCursorFromSelection(view);
  return true;
}

function syncStructuralCursorFromSelection(view: EditorView): void {
  const value = view.state.field(structField, false);
  if (!value) return;
  const pos = view.state.selection.main.head;
  const enclosingId = findSmallestEnclosingAddressableNode(
    value.state.tree.root,
    value.idIndex,
    pos,
  );
  if (enclosingId === null) return;
  const primary = value.state.cursors.primary;
  if (primary.kind === "node" && primary.target === enclosingId) return;
  const cs = singleCursor(nodeCursor(enclosingId));
  const newState: State = { tree: value.state.tree, cursors: cs };
  view.dispatch({
    effects: setStructState.of({
      state: newState,
      idIndex: value.idIndex,
      cursorPaths: pathsFromCursorSet(cs, value.state.tree),
    }),
    annotations: Transaction.addToHistory.of(false),
  });
}

function findSmallestEnclosingAddressableNode(
  root: DocumentNode,
  idIndex: ReadonlyMap<NodeId, { from: number; to: number }>,
  pos: number,
): NodeId | null {
  let best: NodeId | null = null;
  const visit = (node: Node): void => {
    const range = idIndex.get(node.id);
    if (!range) return;
    if (range.from > pos || range.to < pos) return;
    if (node.kind !== "document") best = node.id;
    for (const child of childrenOf(node)) visit(child);
  };
  visit(root);
  return best;
}

function getCursorNode(view: EditorView): SyntaxNode | null {
  const selection = view.state.selection.main;
  return typedFindNodeAt(view.state, selection.from, selection.to);
}

function isNumberNode(node: SyntaxNode | null): boolean {
  return (
    node != null &&
    (node.type?.name === "Number" || (node.type as unknown) === "Number")
  );
}

function getNumberNodeValue(
  node: SyntaxNode,
  state: EditorState,
): number | null {
  if (typeof node.from !== "number" || typeof node.to !== "number") return null;
  const text = state.doc.sliceString(node.from, node.to);
  const num = Number(text);
  return Number.isNaN(num) ? null : num;
}

function adjustNumberAtCursor(view: EditorView, delta: number): boolean {
  const node = getCursorNode(view);
  if (!node || !isNumberNode(node)) return false;
  const currentValue = getNumberNodeValue(node, view.state);
  if (currentValue === null) return false;

  const originalText = view.state.doc.sliceString(node.from, node.to);
  const match = originalText.match(/^(\s*)(.*?)(\s*)$/);
  const leading = match ? match[1] : "";
  const trailing = match ? match[3] : "";
  const newText = `${leading}${currentValue + delta}${trailing}`;

  return replaceRange(view, {
    kind: "replaceRange",
    from: node.from,
    to: node.to,
    insert: newText,
    selectionAnchor: node.from + leading.length,
    scrollIntoView: true,
    userEvent: "edit.number",
  });
}

function getNodeRangeAtCursor(
  view: EditorView,
): { from: number; to: number } | null {
  const node = getCursorNode(view);
  if (!node) return null;
  const range = typedGetTrimmedRange(node, view.state) || node;
  if (typeof range?.from !== "number" || typeof range?.to !== "number") {
    return null;
  }
  return { from: range.from, to: range.to };
}

function getNumericSeedFromText(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : null;
}

function toggleManualControl(view: EditorView, stick: "left" | "right"): boolean {
  const existing = getManualControlBinding(stick);
  if (existing) {
    clearManualControlBinding(stick);
    return true;
  }

  const range = getNodeRangeAtCursor(view);
  if (!range) return false;

  const originalText = view.state.doc.sliceString(range.from, range.to);
  const seed = getNumericSeedFromText(originalText);
  const value = seed ?? 0;
  const slot = slotForStick(stick);
  const text = formatManualControlNumber(value);

  replaceRange(view, {
    kind: "replaceRange",
    from: range.from,
    to: range.to,
    insert: text,
    selectionAnchor: range.from + text.length,
    scrollIntoView: true,
    userEvent: "manualControl.bind",
  });

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
  sendManualControlValue(slot, value);
  return true;
}

function updateManualControlAxis(
  view: EditorView,
  stick: "left" | "right",
  x: number,
  y: number,
  nowMs: number,
): boolean {
  const binding = getManualControlBinding(stick);
  if (!binding) return false;

  if (
    binding.lastSentAt &&
    nowMs - binding.lastSentAt < MANUAL_CONTROL_SEND_INTERVAL_MS
  ) {
    return false;
  }

  if (x === 0 && y === 0) {
    binding.lastSentAt = nowMs;
    return false;
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
    return false;
  }

  binding.value = nextValue;
  binding.lastSentValue = nextValue;
  binding.lastSentAt = nowMs;

  const text = formatManualControlNumber(nextValue);
  replaceRange(view, {
    kind: "replaceRange",
    from: binding.from,
    to: binding.to,
    insert: text,
    selectionAnchor: binding.from + text.length,
    scrollIntoView: false,
    userEvent: "manualControl.update",
  });
  binding.to = binding.from + text.length;

  sendManualControlValue(binding.slot, nextValue);
  return true;
}

function sendManualControlValue(slot: number, value: number): void {
  void import("../../transport/json-protocol.ts")
    .then((mod) => mod.sendSerialInputStreamValue(slot, value))
    .catch(() => {});
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
