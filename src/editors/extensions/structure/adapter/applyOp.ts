/**
 * Application API for pure AST operations. Keyboard, gamepad and menu operations
 * all commit through commitMutation: one source change with intended focus,
 * formatting and undo ownership. The CodeMirror document remains canonical.
 */

import { Transaction, type ChangeSpec } from "@codemirror/state";
import { isolateHistory } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";

import { findById } from "../core/index.ts";
import type { Cursor, OpResult, State, Tree } from "../core/index.ts";
import { pathOf } from "../core/traversal.ts";
import { getAppSettings } from "../../../../runtime/appSettingsRepository.ts";
import { captureStructuralFocus } from "./cursorPath.ts";
import { formatNode, printNode, printNodeWithBreaks } from "./printTree.ts";
import { planIndentation } from "./indentFixedPoint.ts";
import { setIntendedFocus, structField, type StructFieldValue } from "./stateField.ts";
import type { IdIndex } from "./treeFromLezer.ts";

interface NoOpEntry {
  cursor: Cursor;
  reason: string;
}

type NodePrinter = (n: import("../core/index.ts").Node) => string;

type AutoFormatStrategy = "off" | "reflow" | "indent-fixed-point";

function getAutoFormatStrategy(): AutoFormatStrategy {
  return getAppSettings().format.autoFormatStrategy;
}

function getNodePrinter(strategy: AutoFormatStrategy): NodePrinter {
  switch (strategy) {
    case "reflow":
      return (n) => formatNode(n, getAppSettings().format);
    case "indent-fixed-point":
      return printNodeWithBreaks;
    case "off":
    default:
      return printNode;
  }
}

/**
 * Run an op and dispatch the result. Returns true iff the editor changed
 * (cursor moved or doc edited).
 */
export function applyOp(
  view: EditorView,
  op: (s: State) => OpResult,
  userEvent = "structure.mutate",
): boolean {
  const value = view.state.field(structField, false);
  if (!value) return false;

  const before = value.state;
  const result = op(before);

  // Surface no-ops to the console (UI flash is nice-to-have).
  if (result.noOps.length > 0) {
    for (const entry of result.noOps as ReadonlyArray<NoOpEntry>) {
      console.warn(
        "[structure] no-op:",
        entry.reason,
        "cursor:",
        entry.cursor,
      );
    }
  }

  return commitMutation(view, value, result.state, userEvent);
}

/** The sole commit boundary for AST operations, including menu verbs. */
function commitMutation(
  view: EditorView,
  value: StructFieldValue,
  after: State,
  userEvent: string,
): boolean {
  const before = value.state;
  if (after.tree === before.tree && cursorsEqual(after.cursors, before.cursors)) return false;

  const focus = setIntendedFocus.of(captureStructuralFocus(after));
  if (after.tree === before.tree) {
    view.dispatch({ effects: focus, annotations: Transaction.addToHistory.of(false), scrollIntoView: true });
    scrollPrimaryIntoView(view);
    return true;
  }

  const index = findAffectedTopLevelIndex(before.tree, after.tree);
  const range = index === null ? undefined : value.idIndex.get(before.tree.root.children[index].id);
  const strategy = getAutoFormatStrategy();
  const print = getNodePrinter(strategy);
  const changes = range && index !== null
    ? { from: range.from, to: range.to, insert: print(after.tree.root.children[index]) }
    : planWholeDocChange(view, before, value.idIndex, after, print);

  let changeSet = view.state.changes(changes);
  if (strategy === "indent-fixed-point") {
    const draft = view.state.update({ changes: changeSet, filter: false }).state;
    const lo = range ? changeSet.mapPos(range.from, -1) : 0;
    const hi = range ? changeSet.mapPos(range.to, 1) : draft.doc.length;
    changeSet = changeSet.compose(planIndentation(draft, lo, hi));
  }
  view.dispatch({
    changes: changeSet,
    effects: focus,
    // The AST printer owns formatting; clojure-mode must not replace this transaction.
    filter: false,
    userEvent,
    annotations: isolateHistory.of("full"),
    scrollIntoView: true,
  });
  scrollPrimaryIntoView(view);
  return true;
}

/**
 * Build the new document text for a whole-doc replace, preserving the
 * inter-top-level whitespace from the original document (spec §2.1).
 *
 * Strategy:
 *   - Extract the original gaps (text between top-level form ranges) from the
 *     current doc using the `before` tree's idIndex.
 *   - Print each new top-level form individually.
 *   - Stitch the printed forms back together with the original gaps.
 *
 * When the number of top-level forms changes (e.g. splice, raise, enclose),
 * gaps are handled as follows:
 *   - If there are fewer new forms than old, trailing gaps are dropped.
 *   - If there are more new forms than old (e.g. barf/splice), the gap before
 *     each newly-created sibling form defaults to a single space — the sibling
 *     is released into the same line context as its origin (per §5.2.3).
 *
 * The text before the first form and after the last form is always preserved
 * from the original document.
 */
function buildDocWithPreservedGaps(
  docText: string,
  before: State,
  beforeIdIndex: IdIndex,
  after: State,
  print: NodePrinter,
): string {
  const oldChildren = before.tree.root.children;
  const newChildren = after.tree.root.children;

  // Collect original source ranges for the old top-level forms.
  const oldRanges: Array<{ from: number; to: number }> = [];
  for (const child of oldChildren) {
    const range = beforeIdIndex.get(child.id);
    if (range) {
      oldRanges.push(range);
    }
  }

  // Extract leading text (before the first old form).
  const leadingText =
    oldRanges.length > 0 ? docText.slice(0, oldRanges[0].from) : "";

  // Extract gaps between consecutive old forms.
  const gaps: string[] = [];
  for (let i = 0; i + 1 < oldRanges.length; i++) {
    gaps.push(docText.slice(oldRanges[i].to, oldRanges[i + 1].from));
  }

  // Extract trailing text (after the last old form).
  const trailingText =
    oldRanges.length > 0
      ? docText.slice(oldRanges[oldRanges.length - 1].to)
      : "";

  // If we couldn't resolve any old ranges, fall back to flat join.
  if (oldRanges.length === 0 || newChildren.length === 0) {
    return newChildren.map(print).join("\n");
  }

  // Print each new top-level form.
  const printed = newChildren.map(print);

  // Stitch: leading + form0 + gap0 + form1 + gap1 + … + formN + trailing.
  //
  // When a mutation creates a NEW top-level sibling (more new forms than old —
  // e.g. barf/splice/raise expelling a node to the top level) there is no
  // recorded inter-node gap for it. Such a sibling is released into the same
  // line context as its origin form, so the separator is a single space
  // (matching `(a b) c`, per structural-editing.md §5.2.3). We must NOT use the
  // double-newline default here, which would wrongly split a barfed node onto
  // its own paragraph. Genuine pre-existing gaps between distinct top-level
  // definitions are still preserved verbatim via `gaps[]`.
  const NEW_SIBLING_GAP = " ";
  let result = leadingText + printed[0];
  for (let i = 1; i < printed.length; i++) {
    // Use original gap when available; fall back to a single space for
    // newly-created siblings.
    const gap = i - 1 < gaps.length ? gaps[i - 1] : NEW_SIBLING_GAP;
    result += gap + printed[i];
  }
  result += trailingText;
  return result;
}

/**
 * Structural alignment between the old top-level forms and the printed new
 * top-level forms, used by {@link buildSurgicalChanges} to emit identity-
 * preserving surgical CodeMirror changes instead of a wholesale document
 * replacement.
 */
interface SegmentAlignment {
  /** Original source ranges of the OLD top-level forms, in order. */
  readonly oldRanges: ReadonlyArray<{ from: number; to: number }>;
  /** OLD top-level form node ids, aligned with {@link oldRanges}. */
  readonly oldNodeIds: ReadonlyArray<string>;
  /** NEW top-level form node ids, aligned with {@link printed}. */
  readonly newNodeIds: ReadonlyArray<string>;
  /** Printed text of each NEW top-level form, in order. */
  readonly printed: ReadonlyArray<string>;
  /** Original source text before the first old form. */
  readonly leadingText: string;
  /**
   * Original source text between consecutive old top-level forms
   * (inter-top-level whitespace; spec §2.1 — sacred).
   */
  readonly gaps: ReadonlyArray<string>;
  /** Original source text after the last old form. */
  readonly trailingText: string;
}

/**
 * Build a list of surgical CodeMirror `ChangeSpec`s that, applied together,
 * reproduce the same final document as a single wholesale replace would —
 * but emit a change for each surviving top-level form so the state-identity
 * sidecar can preserve stateful-form identity through range continuity
 * (state-identity.md §7.2 / VAL-ID-004 / VAL-ID-005).
 *
 * **Alignment model.** Each old top-level form carries a stable structural
 * node id (see `core/types.ts` — `withChildren` and other in-place mutators
 * preserve node ids across mutations). We align each new top-level form
 * with the old form carrying the same node id. Aligned forms are surviving
 * forms: they get a per-form surgical change so their identity is preserved.
 * Unaligned forms (new forms with no matching old id, or old forms whose
 * id vanished) live in the "divergent middle" and are consolidated into one
 * wholesale change. Only the divergent middle loses range continuity; that
 * is correct because those forms were structurally destroyed or replaced.
 *
 * **Identity preservation mechanism.** A surgical change
 * `{from: oldRange.from, to: oldRange.to, insert: printed[i]}` maps the
 * prior identity entry's range through the ChangeSet to a range whose `from`
 * stays at `oldRange.from` (the start of the form is preserved). The
 * reconciler's overlap check then sees a non-zero overlap with the new
 * form's range, so preserve semantics fire (identityReconcile.ts §2).
 *
 * Returns `null` when the alignment is degenerate (no old ranges, or no new
 * forms, or no old node ids available), in which case the caller falls back
 * to a single whole-document change.
 */
function buildSurgicalChanges(seg: SegmentAlignment, docText: string): ChangeSpec[] | null {
  const { oldRanges, oldNodeIds, newNodeIds, printed, gaps, leadingText, trailingText } = seg;
  if (!oldRanges.length || !printed.length) return null;

  // Retain source-range continuity for the surviving prefix and suffix.
  let prefix = 0;
  while (prefix < Math.min(oldNodeIds.length, newNodeIds.length) && oldNodeIds[prefix] === newNodeIds[prefix]) prefix++;
  let suffix = 0;
  while (suffix < Math.min(oldNodeIds.length - prefix, newNodeIds.length - prefix) &&
    oldNodeIds[oldNodeIds.length - 1 - suffix] === newNodeIds[newNodeIds.length - 1 - suffix]) suffix++;
  if (prefix + suffix === 0) return null;

  // The surgical edits must reproduce exactly the same source as the full
  // printer, including separators when forms are inserted or removed.
  let text = leadingText;
  const newRanges = printed.map((form, index) => {
    if (index) text += gaps[index - 1] ?? " ";
    const from = text.length;
    text += form;
    return { from, to: text.length };
  });
  text += trailingText;
  const changes: ChangeSpec[] = [];
  const replace = (from: number, to: number, insert: string) => {
    if (docText.slice(from, to) !== insert) changes.push({ from, to, insert });
  };
  let oldEnd = 0;
  let newEnd = 0;
  const keep = (oldIndex: number, newIndex: number) => {
    const oldRange = oldRanges[oldIndex];
    const newRange = newRanges[newIndex];
    replace(oldEnd, oldRange.from, text.slice(newEnd, newRange.from));
    replace(oldRange.from, oldRange.to, printed[newIndex]);
    oldEnd = oldRange.to;
    newEnd = newRange.to;
  };
  for (let i = 0; i < prefix; i++) keep(i, i);
  for (let i = suffix; i > 0; i--) keep(oldRanges.length - i, newRanges.length - i);
  replace(oldEnd, docText.length, text.slice(newEnd));
  return changes;
}

function planWholeDocChange(
  view: EditorView,
  before: State,
  beforeIdIndex: IdIndex,
  after: State,
  print: NodePrinter,
): ChangeSpec {
  const docText = view.state.doc.toString();
  const text = buildDocWithPreservedGaps(docText, before, beforeIdIndex, after, print);

  // Build the structural alignment between old and new top-level forms.
  // We use node ids (preserved by the structural core across in-place
  // mutations) to recognise which forms survived. This is the basis for
  // emitting surgical per-form changes instead of a wholesale replace.
  const oldChildren = before.tree.root.children;
  const newChildren = after.tree.root.children;
  const oldRanges: Array<{ from: number; to: number }> = [];
  const oldNodeIds: string[] = [];
  for (const child of oldChildren) {
    const range = beforeIdIndex.get(child.id);
    if (range) {
      oldRanges.push(range);
      oldNodeIds.push(child.id);
    }
  }
  const newNodeIds = newChildren.map((c) => c.id);
  const printed = newChildren.map(print);
  // Recompute gaps/leading/trailing from the alignment so the surgical
  // builder has everything it needs in one place.
  const leadingText =
    oldRanges.length > 0 ? docText.slice(0, oldRanges[0]!.from) : "";
  const gaps: string[] = [];
  for (let i = 0; i + 1 < oldRanges.length; i++) {
    gaps.push(docText.slice(oldRanges[i]!.to, oldRanges[i + 1]!.from));
  }
  const trailingText =
    oldRanges.length > 0
      ? docText.slice(oldRanges[oldRanges.length - 1]!.to)
      : "";

  const seg: SegmentAlignment = {
    oldRanges,
    oldNodeIds,
    newNodeIds,
    printed,
    leadingText,
    gaps,
    trailingText,
  };

  // Try to emit surgical per-form changes so the state-identity sidecar
  // can preserve stateful-form identity through range continuity
  // (VAL-ID-004 / VAL-ID-005). Falls back to a single whole-doc change
  // when the alignment is degenerate.
  const surgical = buildSurgicalChanges(seg, docText);
  const changeSpec: ChangeSpec =
    surgical !== null && surgical.length > 0
      ? surgical
      : { from: 0, to: view.state.doc.length, insert: text };

  return surgical !== null && surgical.length === 0 && text === docText ? [] : changeSpec;
}

/**
 * Shallow semantic equality for CursorSets. Avoids dispatching a spurious
 * "cursor update" when the core returned a new object with the same content
 * (e.g. on a no-op mutation where the lift rebuilds the set from survivors).
 */
function cursorsEqual(
  a: import("../core/index.ts").CursorSet,
  b: import("../core/index.ts").CursorSet,
): boolean {
  if (!cursorEqual(a.primary, b.primary)) return false;
  if (a.secondaries.length !== b.secondaries.length) return false;
  for (let i = 0; i < a.secondaries.length; i++) {
    if (!cursorEqual(a.secondaries[i], b.secondaries[i])) return false;
  }
  return true;
}

function cursorEqual(a: Cursor, b: Cursor): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "node" && b.kind === "node") return a.target === b.target && (a.phase ?? "pre") === (b.phase ?? "pre");
  if (a.kind === "range" && b.kind === "range") {
    return a.parent === b.parent && a.start === b.start && a.end === b.end && a.anchor === b.anchor;
  }
  return false;
}

/**
 * Find the index (within the document's children) of the top-level form that
 * differs between `before` and `after`. Returns null if multiple top-level
 * forms differ (whole-doc fallback) or if the lengths differ (insertion or
 * deletion at top level).
 */
function findAffectedTopLevelIndex(before: Tree, after: Tree): number | null {
  const a = before.root.children;
  const b = after.root.children;
  if (a.length !== b.length) return null;
  let differing = -1;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      if (differing !== -1) return null; // more than one differs
      differing = i;
    }
  }
  return differing === -1 ? null : differing;
}

/**
 * Move the CodeMirror selection to the start of the primary cursor's source
 * range so the user sees it in view. We re-read from the freshly updated
 * state field.
 */
function scrollPrimaryIntoView(view: EditorView): void {
  const value = view.state.field(structField, false);
  if (!value) return;
  const c = value.state.cursors.primary;
  const id = c.kind === "node" ? c.target : c.start;
  const range = value.idIndex.get(id);
  if (!range) return;
  const docLen = view.state.doc.length;
  const anchor = Math.max(0, Math.min(range.from, docLen));
  // Only move the selection if it isn't already inside the range, to avoid
  // spurious selection churn during keyboard typing.
  const sel = view.state.selection.main;
  const isHole = c.kind === "node" && findById(value.state.tree.root, c.target)?.kind === "hole";
  if (isHole ? sel.from !== range.from || sel.to !== range.to : sel.from < range.from || sel.from > range.to) {
    view.dispatch({
      selection: { anchor, head: isHole ? range.to : anchor },
      annotations: Transaction.addToHistory.of(false),
      effects: setIntendedFocus.of(captureStructuralFocus(value.state)),
      scrollIntoView: true,
    });
  }
}

// Exported for tests / debugging.
export const _internals = {
  findAffectedTopLevelIndex,
  pathFor: pathOf,
};
