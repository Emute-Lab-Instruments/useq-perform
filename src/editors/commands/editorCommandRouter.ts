// src/editors/commands/editorCommandRouter.ts
//
// Typed command router for useq-authored editor edit intents. Keyboard,
// gamepad, menu, and tests should send command objects here instead of
// directly composing CodeMirror transactions.

import { Transaction, findClusterBreak, type ChangeSpec, type EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { runScopeHandlers } from "@codemirror/view";
import {
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
import { resolveLiveSlotIndex } from "../../lib/liveSlotIndex.ts";
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
import { atomAdjust, flipPolarity } from "../extensions/structure/core/atomOps.ts";

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
  | { kind: "atomAdjust"; direction: 1 | -1; source?: EditorCommandSource }
  | { kind: "atomFlipPolarity"; source?: EditorCommandSource }
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

function clampPosition(pos: number, docLength: number): number {
  if (!Number.isFinite(pos)) return 0;
  return Math.max(0, Math.min(Math.trunc(pos), docLength));
}

function normaliseMainSelection(view: EditorView): {
  from: number;
  to: number;
  head: number;
  empty: boolean;
} {
  const selection = view.state.selection.main;
  const docLength = view.state.doc.length;
  const anchor = clampPosition(selection.anchor, docLength);
  const head = clampPosition(selection.head, docLength);
  const from = Math.min(anchor, head);
  const to = Math.max(anchor, head);

  if (selection.anchor !== from || selection.head !== to) {
    view.dispatch({
      selection: { anchor: from, head: to },
      annotations: Transaction.addToHistory.of(false),
    });
  }

  return { from, to, head: to, empty: from === to };
}

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

    case "atomAdjust":
      return atomAdjustAtCursor(view, command.direction);

    case "atomFlipPolarity":
      return atomFlipPolarityAtCursor(view);

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
  normaliseMainSelection(view);
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
    wouldPlainBackspaceDeleteProtectedBracket(view, key)
  ) {
    return structuralBackspace(view);
  }

  if (
    !command.allowBracketUnbalancing &&
    wouldPlainDeleteRemoveProtectedBracket(view, key)
  ) {
    return structuralDelete(view);
  }

  const selection = normaliseMainSelection(view);
  switch (key) {
    case "Backspace":
      if (!selection.empty) return replaceSelection(view, "", "delete");
      if (tryJoinAtLineIndentBackward(view, selection.head)) return true;
      return deleteOneCharBackward(view);
    case "Delete":
      if (!selection.empty) return replaceSelection(view, "", "delete");
      return deleteOneCharForward(view);
    case "Enter":
      if (!selection.empty) return replaceSelection(view, "\n", "input");
      return insertNewline(view);
    default:
      if (key.length === 1) {
        return replaceSelection(view, key, "input");
      }
      return false;
  }
}

function handleBracketKey(view: EditorView, key: string): boolean {
  const selection = normaliseMainSelection(view);

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

  if (CLOSING_BRACKETS.has(key)) {
    return replaceSelection(view, key, "input");
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

function wouldPlainBackspaceDeleteProtectedBracket(
  view: EditorView,
  key: string,
): boolean {
  if (key !== "Backspace") return false;

  const selection = normaliseMainSelection(view);
  if (!selection.empty) return false;

  const before = view.state.doc.sliceString(selection.from - 1, selection.from);
  return CLOSING_BRACKETS.has(before) || before in OPENING_BRACKETS;
}

function wouldPlainDeleteRemoveProtectedBracket(
  view: EditorView,
  key: string,
): boolean {
  if (key !== "Delete") return false;

  const selection = normaliseMainSelection(view);
  if (!selection.empty) return false;

  const after = view.state.doc.sliceString(selection.from, selection.from + 1);
  return CLOSING_BRACKETS.has(after) || after in OPENING_BRACKETS;
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
  const pos = normaliseMainSelection(view).from;
  const tree = syntaxTree(view.state);
  const charBefore = view.state.doc.sliceString(pos - 1, pos);

  let targetNode: SyntaxNode;

  if (charBefore === '"') {
    let node: SyntaxNode | null = tree.resolveInner(pos - 1, 1);
    while (node && node.name !== "String") {
      node = node.parent;
    }
    if (!node) return true;
    // Closing quote: cursor at string end. Opening quote: cursor after string start.
    if (pos !== node.to && pos - 1 !== node.from) return true;
    targetNode = node;
  } else {
    // Cursor is after `)` / `]` / `}` / `(` / `[` / `{` — token's parent is the form.
    const bracketNode = tree.resolveInner(pos - 1, 1);
    const container = bracketNode.parent;
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

function structuralDelete(view: EditorView): boolean {
  const pos = normaliseMainSelection(view).from;
  const tree = syntaxTree(view.state);
  const charAfter = view.state.doc.sliceString(pos, pos + 1);

  let targetNode: SyntaxNode;

  if (charAfter === '"') {
    let node: SyntaxNode | null = tree.resolveInner(pos, 1);
    while (node && node.name !== "String") {
      node = node.parent;
    }
    if (!node) return true;
    // Opening quote: cursor at string start. Closing quote: cursor before string end.
    if (pos !== node.from && pos + 1 !== node.to) return true;
    targetNode = node;
  } else {
    const bracketNode = tree.resolveInner(pos, 1);
    const container = bracketNode.parent;
    if (!container) return true;
    targetNode = container;
  }

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
  const selection = normaliseMainSelection(view);
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

/**
 * Delete one character backward, preserving grapheme-cluster boundaries.
 * Uses userEvent "delete" so the clojure-mode line formatter skips
 * reformatting (it only recognises "delete", not "delete.backward").
 */
/**
 * Smart Backspace at line-start indent: if the cursor is on a non-first line
 * and every character before it on the current line is whitespace, delete
 * back through the preceding newline (joining lines), inserting a single
 * space iff the tokens on either side of the join are both non-whitespace
 * non-bracket characters. Otherwise the join is gapless.
 *
 * Returns false when not at an indent boundary, letting plain Backspace run.
 *
 * The fixed-point indenter (see indentOnNewline.ts) re-runs automatically
 * after the dispatch — this function only owns the join itself.
 */
function tryJoinAtLineIndentBackward(view: EditorView, pos: number): boolean {
  const doc = view.state.doc;
  if (pos <= 0) return false;
  const line = doc.lineAt(pos);
  if (line.number === 1) return false;
  const before = doc.sliceString(line.from, pos);
  if (/\S/.test(before)) return false;

  const prevLineEnd = doc.line(line.number - 1).to;
  const charBefore =
    prevLineEnd > 0 ? doc.sliceString(prevLineEnd - 1, prevLineEnd) : "";
  const charAfter =
    pos < doc.length ? doc.sliceString(pos, pos + 1) : "";
  const isOpen = (c: string) => c === "(" || c === "[" || c === "{";
  const isClose = (c: string) => c === ")" || c === "]" || c === "}";
  const needsSpace =
    charBefore !== "" &&
    charAfter !== "" &&
    !/\s/.test(charBefore) &&
    !/\s/.test(charAfter) &&
    !isOpen(charBefore) &&
    !isClose(charAfter);
  const insert = needsSpace ? " " : "";
  view.dispatch({
    changes: { from: prevLineEnd, to: pos, insert },
    selection: { anchor: prevLineEnd + insert.length },
    userEvent: "delete.joinIndent",
    scrollIntoView: true,
  });
  return true;
}

function deleteOneCharBackward(view: EditorView): boolean {
  const sel = view.state.selection.main;
  if (!sel.empty || sel.from === 0) return false;
  const pos = sel.from;
  const line = view.state.doc.lineAt(pos);
  let target = findClusterBreak(line.text, pos - line.from, false) + line.from;
  if (target === pos && line.number > 1) target = pos - 1;
  if (target === pos) return false;
  view.dispatch({
    changes: { from: target, to: pos },
    selection: { anchor: target },
    userEvent: "delete",
    scrollIntoView: true,
  });
  return true;
}

function deleteOneCharForward(view: EditorView): boolean {
  const sel = view.state.selection.main;
  if (!sel.empty) return false;
  const pos = sel.from;
  const doc = view.state.doc;
  if (pos >= doc.length) return false;
  const line = doc.lineAt(pos);
  let target = findClusterBreak(line.text, pos - line.from, true) + line.from;
  if (target === pos && line.number < doc.lines) target = pos + 1;
  if (target === pos) return false;
  view.dispatch({
    changes: { from: pos, to: target },
    selection: { anchor: pos },
    userEvent: "delete",
    scrollIntoView: true,
  });
  return true;
}

function replaceRange(
  view: EditorView,
  command: Extract<EditorCommand, { kind: "replaceRange" }>,
): boolean {
  const docLength = view.state.doc.length;
  const rawFrom = clampPosition(command.from, docLength);
  const rawTo = clampPosition(command.to, docLength);
  const from = Math.min(rawFrom, rawTo);
  const to = Math.max(rawFrom, rawTo);
  const nextDocLength = docLength - (to - from) + command.insert.length;
  const selectionAnchor = clampPosition(
    command.selectionAnchor ?? from + command.insert.length,
    nextDocLength,
  );
  const change: ChangeSpec = {
    from,
    to,
    insert: command.insert,
  };
  view.dispatch({
    changes: change,
    selection: {
      anchor: selectionAnchor,
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
  // Activating a binding DECLARES the live input via set-live-inputs (§5.8) so
  // the device allocates the slot. This also pushes the initial value.
  declareManualControlSlot(slot, value);
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

  pushManualControlValue(binding.slot, nextValue);
  return true;
}

/** The live-input id a manual-control slot rewrites to: `(ssin N)` → `ssinN`. */
function manualControlInputId(slot: number): string {
  return `ssin${slot}`;
}

/**
 * DECLARE a manual-control live input on the device (wire-protocol.md §5.8).
 * Manual control rewrites the bound number to `(ssin N)`, so we register the
 * matching `ssinN` slot via set-live-inputs. This is the registration step;
 * high-rate scrub updates then go through the §6.5 binary fast-path.
 */
function declareManualControlSlot(slot: number, value: number): void {
  void import("../../transport/json-protocol.ts")
    .then((mod) => mod.sendSetLiveInputs({ [manualControlInputId(slot)]: value }))
    .catch(() => {});
}

/**
 * Push a high-rate manual-control SCRUB value (wire-protocol.md §6.5).
 *
 * Prefers the compact binary INPUT_SET frame (low latency, no JSON per sample),
 * addressing the slot by its synced `slot_index`. If the id→index map has not
 * been synced yet (no get-state since the last eval), it falls back to the JSON
 * set-live-inputs path until the map is rebuilt (§6.5 NOTE).
 */
function pushManualControlValue(slot: number, value: number): void {
  const id = manualControlInputId(slot);
  void import("../../transport/json-protocol.ts")
    .then((mod) => {
      const slotIndex = resolveLiveSlotIndex(id);
      if (slotIndex !== null) {
        return mod.sendBinaryInputSet([{ slotIndex, value }]);
      }
      return mod.sendSetLiveInputs({ [id]: value });
    })
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

// ─── Atom manipulation (atom-manipulation.md §2) ────────────────────────────

function getLezerNodeKind(node: SyntaxNode): string | null {
  const name = node.type?.name;
  if (!name) return null;
  if (name === "Number") return "number";
  if (name === "Symbol") return "symbol";
  if (name === "Keyword") return "keyword";
  if (name === "Boolean") return "symbol";
  if (name === "String") return "string";
  return null;
}

function atomAdjustAtCursor(view: EditorView, direction: 1 | -1): boolean {
  const node = getCursorNode(view);
  if (!node) return false;

  const kind = getLezerNodeKind(node);
  if (!kind) return false;

  const text = view.state.doc.sliceString(node.from, node.to);
  const result = atomAdjust(text, kind, direction);

  if (result.kind === "no-op") return false;

  const newText = result.kind === "adjusted" ? result.newText : result.newText;

  return replaceRange(view, {
    kind: "replaceRange",
    from: node.from,
    to: node.to,
    insert: newText,
    selectionAnchor: node.from,
    scrollIntoView: true,
    userEvent: "edit.atom",
  });
}

function atomFlipPolarityAtCursor(view: EditorView): boolean {
  const node = getCursorNode(view);
  if (!node) return false;

  const kind = getLezerNodeKind(node);
  if (kind !== "number") return false;

  const text = view.state.doc.sliceString(node.from, node.to);
  const result = flipPolarity(text);

  if (result.kind === "no-op") return false;

  return replaceRange(view, {
    kind: "replaceRange",
    from: node.from,
    to: node.to,
    insert: result.newText,
    selectionAnchor: node.from,
    scrollIntoView: true,
    userEvent: "edit.atom",
  });
}
