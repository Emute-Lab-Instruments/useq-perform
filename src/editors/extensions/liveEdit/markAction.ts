/**
 * `liveEdit.mark` action — mark/unmark a literal for live editing.
 *
 * Spec: docs/specs/live-edit.md §3
 *
 * Behaviour per context (§3.1):
 *   - Structural mode, cursor on a markable leaf literal: mark.
 *   - Structural mode, cursor on a vector compound: enter vector-mark sub-mode.
 *   - Insertion mode, text caret near a literal: walk up AST to find smallest
 *     enclosing markable literal; mark/unmark in place (§3.1).
 *   - Cursor on node with existing `live-edit` Meta: unmark.
 *   - Otherwise: no-op (console toast).
 *
 * Multi-cursor support (§3.8): liveEdit.mark applies pointwise per cursor.
 * One eval fires after all wraps are written.
 *
 * This module handles the text-replacement mechanics only. Eval triggers and
 * store registration are handled by the runtime bridge.
 */

import type { EditorView } from "@codemirror/view";
import type { ChangeSpec } from "@codemirror/state";

import type { DocumentNode } from "../structure/core/index.ts";
import { structField } from "../structure/adapter/stateField.ts";
import { findById, parentOf, isLeaf, childrenOf, type Node, type Meta } from "../structure/core/index.ts";
import type { LiveEditMetaPayload } from "../structure/adapter/treeFromLezer.ts";
import { printNode } from "../structure/adapter/printTree.ts";
import {
  executeEditorCommand,
  type EditorCommandSource,
} from "../../commands/editorCommandRouter.ts";
import { inferRange } from "./rangeInference.ts";
import { liveEditPersistence, liveEditOnValueChange, liveEditStore } from "../../../effects/liveEditRuntime.ts";
import type { LiveEditSlot } from "../../../contracts/liveEdit.ts";
import { evaluate } from "../../../effects/editorEvaluation.ts";
import { createVectorMarkController, type VectorMarkController } from "./vectorMarkController.ts";
import { registerContext } from "../../../lib/keybindings/contexts.ts";
import { getAppSettings } from "../../../runtime/appSettingsRepository.ts";

// ── Singleton vector-mark controller ────────────────────────────────────

const vectorController: VectorMarkController = createVectorMarkController({
  defaultMarkState: "all",
});

/** Expose the controller for nav command routing (§3.7.3). */
export { vectorController };

// Register context predicate so keybindings can scope to vector-mark mode.
registerContext("vectorMark.active", () => vectorController.active);

// ── ID generation (§3.2) ──────────────────────────────────────────────────

/** Documented §10.2/§10.3 defaults; used as the fallback when settings are absent. */
export const ID_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export const ID_LENGTH = 4;

/** Read the configured id alphabet/length (§10.2/§10.3), falling back to defaults. */
function idGenConfig(): { alphabet: string; length: number } {
  const liveEdit = getAppSettings().liveEdit;
  const alphabet =
    typeof liveEdit?.idAlphabet === "string" && liveEdit.idAlphabet.length > 0
      ? liveEdit.idAlphabet
      : ID_ALPHABET;
  const length =
    typeof liveEdit?.idLength === "number" && liveEdit.idLength > 0
      ? Math.floor(liveEdit.idLength)
      : ID_LENGTH;
  return { alphabet, length };
}

/**
 * Generate a short random ID from a reduced-ambiguity alphabet.
 * Alphabet and length come from `liveEdit.idAlphabet`/`liveEdit.idLength`
 * (§10.2/§10.3), defaulting to the module constants. Retries on collision;
 * on exhaustion, falls back to a one-character-longer id (§10.3).
 */
export function generateId(existingIds: Set<string>): string {
  const { alphabet, length } = idGenConfig();
  for (let attempt = 0; attempt < 100; attempt++) {
    let id = "";
    for (let i = 0; i < length; i++) {
      id += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    if (!existingIds.has(id)) return id;
  }
  // Extremely unlikely fallback: one extra char.
  let id = "";
  for (let i = 0; i < length + 1; i++) {
    id += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return id;
}

// ── Rejection checks (§3.5) ──────────────────────────────────────────────

/** Check if a node is a markable literal. */
function isMarkableLiteral(node: Node): boolean {
  if (!isLeaf(node)) return false;
  if (node.kind === "number") return true;
  // Boolean literals are parsed as symbols ("true"/"false") in clojure-mode.
  if (node.kind === "symbol" && (node.text === "true" || node.text === "false")) return true;
  // Keywords like :up, :down are markable (enum slots).
  if (node.kind === "keyword") return true;
  return false;
}

/** Check if the node (or an ancestor) is the value of `:initial` in a defstate form. */
function isInsideDefstateInitial(
  root: DocumentNode,
  nodeId: string,
): boolean {
  let currentId: string | null = nodeId;
  while (currentId !== null) {
    const parent = parentOf(root, currentId);
    if (parent === null || parent.kind === "document") break;
    if (parent.kind === "list" && parent.children.length > 0) {
      const head = parent.children[0]!;
      if (head.kind === "symbol" && head.text === "defstate") {
        for (let i = 0; i < parent.children.length - 1; i++) {
          const child = parent.children[i];
          if (child.kind === "keyword" && child.text === ":initial") {
            const initialValue = parent.children[i + 1];
            if (initialValue && isOrContains(initialValue, currentId)) {
              return true;
            }
          }
        }
      }
    }
    currentId = parent.id;
  }
  return false;
}

function isOrContains(node: Node, targetId: string): boolean {
  if (node.id === targetId) return true;
  if ("children" in node) {
    for (const child of (node as { children: readonly Node[] }).children) {
      if (isOrContains(child, targetId)) return true;
    }
  }
  return false;
}

/** Check if any ancestor has a quote-like Meta. */
function isInsideQuote(
  root: DocumentNode,
  nodeId: string,
): boolean {
  let currentId: string | null = nodeId;
  while (currentId !== null) {
    const node = findById(root, currentId);
    if (node === null || node.kind === "document") break;
    for (const meta of node.metas) {
      if (
        meta.kind === "quote" ||
        meta.kind === "syntax-quote" ||
        meta.kind === "unquote" ||
        meta.kind === "unquote-splicing"
      ) {
        return true;
      }
    }
    const parent = parentOf(root, currentId);
    if (parent === null) break;
    currentId = parent.id;
  }
  return false;
}

// ── Collecting existing live-edit IDs ─────────────────────────────────────

function collectExistingIds(root: DocumentNode): Set<string> {
  const ids = new Set<string>();
  function walk(node: Node): void {
    if (node.kind !== "document") {
      for (const meta of node.metas) {
        if (meta.kind === "live-edit") {
          const payload = meta.payload as LiveEditMetaPayload;
          if (payload.id) ids.add(payload.id);
        }
      }
    }
    if (node.kind === "list" || node.kind === "vector" || node.kind === "map" || node.kind === "set" || node.kind === "document") {
      for (const child of node.children) walk(child);
    }
  }
  walk(root);
  return ids;
}

// ── Get parent head symbol ────────────────────────────────────────────────

function getParentHead(
  root: DocumentNode,
  nodeId: string,
): string | undefined {
  const parent = parentOf(root, nodeId);
  if (parent === null || parent.kind === "document") return undefined;
  if (parent.kind === "list" && parent.children.length > 0) {
    const head = parent.children[0]!;
    if (head.kind === "symbol") return head.text;
  }
  return undefined;
}

// ── Value → literal text ──────────────────────────────────────────────────

/**
 * Format a slot's current value as the literal text we paste back into source.
 * Used by toggle-off (replace wrapper with current value) and `liveEdit.commit`.
 */
function formatSlotValueAsLiteral(slot: LiveEditSlot): string {
  const value = slot.value;
  if (typeof value === "number") {
    const precision =
      slot.precision != null && slot.precision >= 0 ? slot.precision : 2;
    let formatted = value.toFixed(Math.min(precision, 8));
    if (formatted.includes(".")) {
      formatted = formatted.replace(/0+$/, "").replace(/\.$/, "");
    }
    return formatted;
  }
  if (typeof value === "boolean") return String(value);
  // keyword: stored without leading colon — restore it
  const s = String(value);
  return s.startsWith(":") ? s : `:${s}`;
}

// ── Seed value extraction ─────────────────────────────────────────────────

function parseSeedValue(node: Node): number | boolean | string {
  if (node.kind === "number") {
    return Number(node.text);
  }
  if (node.kind === "symbol" && node.text === "true") return true;
  if (node.kind === "symbol" && node.text === "false") return false;
  if (node.kind === "keyword") return node.text; // includes leading ":"
  // Fallback — should not normally be reached for markable literals
  return 0;
}

// ── AST walk-up for insertion-mode marking (§3.1) ────────────────────────

/**
 * Walk up the AST from a node to find the smallest enclosing markable
 * literal. Used for insertion-mode marking where the cursor is a text
 * caret inside a literal.
 */
function findEnclosingMarkableLiteral(
  root: DocumentNode,
  nodeId: string,
): Node | null {
  let currentId: string | null = nodeId;
  while (currentId !== null) {
    const node = findById(root, currentId);
    if (node === null || node.kind === "document") return null;
    if (isMarkableLiteral(node)) return node;
    const parent = parentOf(root, currentId);
    if (parent === null) return null;
    currentId = parent.id;
  }
  return null;
}

/**
 * Find the deepest node whose range encloses the given offset.
 * Used for insertion-mode marking where we need to locate a node from
 * a text caret position.
 */
function findSmallestNodeAtOffset(
  root: DocumentNode,
  idIndex: ReadonlyMap<string, { from: number; to: number }>,
  pos: number,
): Node | null {
  let best: Node | null = null;
  const visit = (node: Node): void => {
    const range = idIndex.get(node.id);
    if (!range) return;
    if (range.from > pos || range.to < pos) return;
    if (node.kind !== "document") best = node;
    for (const child of childrenOf(node)) visit(child);
  };
  visit(root);
  return best;
}

// ── Post-mark eval trigger (§3.2 step 4, §3.3 step 2) ─────────────────��

/**
 * Trigger an immediate eval of the current top-level form after
 * a mark/unmark/commit text replacement. Uses the "toplevel" strategy
 * which evaluates the form at the cursor.
 */
function triggerPostMarkEval(view: EditorView): void {
  // Use setTimeout(0) so the eval runs after the current transaction
  // has been fully applied and the document state is consistent.
  setTimeout(() => {
    evaluate(view, "toplevel");
  }, 0);
}

// ── Main action ───────────────────────────────────────────────────────────

/**
 * Execute `liveEdit.mark` on the editor.
 *
 * Returns true if the action did something (mark or unmark), false if no-op.
 *
 * Supports multi-cursor (§3.8): applies pointwise per cursor. All wraps
 * are batched into a single transaction so one eval fires after all changes.
 */
export function executeLiveEditMark(
  view: EditorView,
  source: EditorCommandSource = "system",
): boolean {
  // If the vector-mark sub-mode is already active, the same action
  // toggles the focused element (§3.7.3).
  if (vectorController.active) {
    vectorController.toggle(view);
    return true;
  }

  const structValue = view.state.field(structField, false);
  if (!structValue) return false;

  const { state: structState, idIndex } = structValue;
  const root = structState.tree.root;

  // §3.1 / §3.7: check if the primary cursor is on a vector compound.
  // If so, enter vector-mark sub-mode instead of scalar mark/unmark.
  const primaryCursor = structState.cursors.primary;
  if (primaryCursor.kind === "node") {
    const primaryNode = findById(root, primaryCursor.target);
    if (primaryNode && primaryNode.kind === "vector") {
      // §3.5.1–3.5.3: rejection checks before entering sub-mode
      if (isInsideDefstateInitial(root, primaryNode.id)) {
        console.warn("[liveEdit.mark] cannot mark inside defstate :initial");
        return false;
      }
      if (isInsideQuote(root, primaryNode.id)) {
        console.warn("[liveEdit.mark] cannot mark inside quote");
        return false;
      }
      // Delegate to the vector-mark controller (§3.7)
      return vectorController.enter(view);
    }
  }

  // Collect all cursors: primary + secondaries (§3.8)
  const allCursors = [structState.cursors.primary, ...structState.cursors.secondaries];

  // Collect existing IDs once for the whole batch
  const existingIds = collectExistingIds(root);
  // Also include persisted orphan IDs (§7.3) for collision check
  const persisted = liveEditPersistence.load();
  for (const id of Object.keys(persisted.orphans)) {
    existingIds.add(id);
  }

  const changes: ChangeSpec[] = [];
  let anyAction = false;

  for (const cursor of allCursors) {
    if (cursor.kind !== "node") {
      // Not on a node — try insertion-mode walk-up (§3.1)
      // For range cursors, skip for now (range doesn't map to a single literal)
      continue;
    }

    const targetNode = findById(root, cursor.target);
    if (!targetNode || targetNode.kind === "document") continue;

    // ── Check for existing live-edit Meta → toggle off (commit) ───────
    const liveEditMeta = targetNode.metas.find(
      (m: Meta) => m.kind === "live-edit",
    );

    if (liveEditMeta) {
      const wrapperRange = idIndex.get(targetNode.id);
      if (!wrapperRange) continue;

      // Toggle-off semantics: replace the wrapper with the *current* live
      // value (commit), not the seed. Falls back to the seed source text
      // when the slot isn't allocated yet (e.g., before first eval).
      const payload = liveEditMeta.payload as LiveEditMetaPayload;
      const slotId = payload.id;
      const slot = slotId ? liveEditStore.getSlot(slotId) : undefined;

      let innerText: string;
      if (slot) {
        innerText = formatSlotValueAsLiteral(slot);
      } else if (
        targetNode.kind === "number" ||
        targetNode.kind === "symbol" ||
        targetNode.kind === "keyword" ||
        targetNode.kind === "string"
      ) {
        innerText = targetNode.text;
      } else {
        innerText = printNode(targetNode);
      }

      changes.push({
        from: wrapperRange.from,
        to: wrapperRange.to,
        insert: innerText,
      });
      anyAction = true;
      continue;
    }

    // ── Check markability → mark ──────────────────────────────────────
    if (!isMarkableLiteral(targetNode)) {
      // §3.1: insertion mode — try walking up AST to find enclosing literal
      const enclosing = findEnclosingMarkableLiteral(root, targetNode.id);
      if (enclosing) {
        const result = buildMarkChange(enclosing, root, idIndex, existingIds);
        if (result) {
          changes.push(result);
          anyAction = true;
        }
      } else {
        console.warn("[liveEdit.mark] cursor is not on a markable literal");
      }
      continue;
    }

    // Rejection checks (§3.5)
    if (isInsideDefstateInitial(root, targetNode.id)) {
      console.warn("[liveEdit.mark] cannot mark inside defstate :initial");
      continue;
    }
    if (isInsideQuote(root, targetNode.id)) {
      console.warn("[liveEdit.mark] cannot mark inside quote");
      continue;
    }

    const result = buildMarkChange(targetNode, root, idIndex, existingIds);
    if (result) {
      changes.push(result);
      anyAction = true;
    }
  }

  // Apply all changes in a single transaction (§3.8: one eval after all wraps)
  if (changes.length > 0) {
    executeEditorCommand(view, {
      kind: "applyChanges",
      changes,
      userEvent: "liveEdit.mark",
      source,
    });

    // §3.2 step 4 / §3.3 step 2: trigger an immediate eval of the
    // enclosing top-level form so the compiler allocates/frees slots.
    triggerPostMarkEval(view);

    // §3.2 step 5: push seed to runtime for newly marked slots.
    // The seed values are pushed after the eval discovers them, handled
    // by discoverSlotsAfterEval in liveEditRuntime.ts.
  }

  return anyAction;
}

/**
 * Execute insertion-mode marking: walk up from the text caret to find
 * the smallest enclosing markable literal, then mark/unmark it.
 *
 * §3.1: "Insertion mode, text caret near a literal: walk up the AST from
 * the caret to find the smallest enclosing markable literal; mark/unmark
 * in place. Caret repositions just after the new wrapper or back at the
 * unwrapped literal. User stays in insertion mode."
 */
export function executeLiveEditMarkInsertionMode(view: EditorView): boolean {
  const structValue = view.state.field(structField, false);
  if (!structValue) return false;

  const { state: structState, idIndex } = structValue;
  const root = structState.tree.root;
  const pos = view.state.selection.main.head;

  // Find the deepest node at the caret position
  const deepestNode = findSmallestNodeAtOffset(root, idIndex, pos);
  if (!deepestNode) {
    console.warn("[liveEdit.mark] no node at caret position");
    return false;
  }

  // Check for existing live-edit Meta → toggle off (commit current value)
  if (deepestNode.kind !== "document") {
    const liveEditMeta = deepestNode.metas.find(
      (m: Meta) => m.kind === "live-edit",
    );
    if (liveEditMeta) {
      return executeToggleOff(view, deepestNode, liveEditMeta, idIndex);
    }
  }

  // Walk up to find the smallest enclosing markable literal
  const target = isMarkableLiteral(deepestNode)
    ? deepestNode
    : findEnclosingMarkableLiteral(root, deepestNode.id);

  if (!target) {
    console.warn("[liveEdit.mark] no markable literal at caret position");
    return false;
  }

  // Rejection checks
  if (isInsideDefstateInitial(root, target.id)) {
    console.warn("[liveEdit.mark] cannot mark inside defstate :initial");
    return false;
  }
  if (isInsideQuote(root, target.id)) {
    console.warn("[liveEdit.mark] cannot mark inside quote");
    return false;
  }

  return executeMark(view, target, root, idIndex);
}

// ── Mark ──────────────────────────────────────────────────────────────────

/**
 * Build the wrapper text for a live-edit mark. Includes :precision and :step
 * per §2.1 and §4.5.
 */
export function buildLiveEditWrapper(
  literalText: string,
  id: string,
  inferred: { min: number; max: number; precision: number } | null,
): string {
  let wrapper = `(live-edit ${literalText} :id "${id}"`;
  if (inferred) {
    wrapper += ` :min ${inferred.min} :max ${inferred.max}`;
    wrapper += ` :precision ${inferred.precision}`;
    // §4.5: :step defaults to 10^-precision
    const step = Math.pow(10, -inferred.precision);
    wrapper += ` :step ${step}`;
  }
  wrapper += ")";
  return wrapper;
}

/**
 * Build a ChangeSpec for marking a single node. Returns null if the node
 * can't be resolved in idIndex. Adds the generated ID to existingIds
 * for batch collision avoidance.
 */
function buildMarkChange(
  targetNode: Node,
  root: DocumentNode,
  idIndex: ReadonlyMap<string, { from: number; to: number }>,
  existingIds: Set<string>,
): ChangeSpec | null {
  const range = idIndex.get(targetNode.id);
  if (!range) return null;

  const id = generateId(existingIds);
  existingIds.add(id);

  const seed = parseSeedValue(targetNode);
  const parentHead = getParentHead(root, targetNode.id);
  const inferred = inferRange(seed, parentHead);

  // targetNode is guaranteed to be a leaf with text (by isMarkableLiteral guard)
  const literalText = "text" in targetNode ? (targetNode as { text: string }).text : "";
  const wrapper = buildLiveEditWrapper(literalText, id, inferred);

  return { from: range.from, to: range.to, insert: wrapper };
}

function executeMark(
  view: EditorView,
  targetNode: Node,
  root: DocumentNode,
  idIndex: ReadonlyMap<string, { from: number; to: number }>,
): boolean {
  const range = idIndex.get(targetNode.id);
  if (!range) return false;

  // Generate a fresh ID (include persisted orphan IDs per §7.3)
  const existingIds = collectExistingIds(root);
  const persisted = liveEditPersistence.load();
  for (const id of Object.keys(persisted.orphans)) {
    existingIds.add(id);
  }
  const id = generateId(existingIds);

  // Infer range defaults
  const seed = parseSeedValue(targetNode);
  const parentHead = getParentHead(root, targetNode.id);
  const inferred = inferRange(seed, parentHead);

  // Get the literal text from the document (preserves original formatting)
  const literalText = view.state.doc.sliceString(range.from, range.to);

  // Build the wrapper text (§2.1: include :precision and :step)
  const wrapper = buildLiveEditWrapper(literalText, id, inferred);

  // Replace the literal's source range with the wrapper
  executeEditorCommand(view, {
    kind: "replaceRange",
    from: range.from,
    to: range.to,
    insert: wrapper,
    userEvent: "liveEdit.mark",
    source: "widget",
  });

  // §3.2 step 4: trigger immediate eval to allocate the slot.
  triggerPostMarkEval(view);

  return true;
}

// ── Toggle-off (commit current value) ────────────────────────────────────

/**
 * Toggle a live-edit off by replacing the wrapper with a literal of the
 * slot's current value. Falls back to the seed source text when the slot
 * isn't allocated yet (e.g., before the first eval).
 *
 * §6.1 (commit) semantics, used by the `liveEdit.mark` toggle in both
 * structural and insertion modes.
 */
function executeToggleOff(
  view: EditorView,
  targetNode: Node,
  liveEditMeta: Meta,
  idIndex: ReadonlyMap<string, { from: number; to: number }>,
): boolean {
  const wrapperRange = idIndex.get(targetNode.id);
  if (!wrapperRange) return false;

  const payload = liveEditMeta.payload as LiveEditMetaPayload;
  const slotId = payload.id;
  const slot = slotId ? liveEditStore.getSlot(slotId) : undefined;

  let innerText: string;
  if (slot) {
    innerText = formatSlotValueAsLiteral(slot);
  } else if (
    targetNode.kind === "number" ||
    targetNode.kind === "symbol" ||
    targetNode.kind === "keyword" ||
    targetNode.kind === "string"
  ) {
    innerText = targetNode.text;
  } else {
    innerText = printNode(targetNode);
  }

  executeEditorCommand(view, {
    kind: "replaceRange",
    from: wrapperRange.from,
    to: wrapperRange.to,
    insert: innerText,
    userEvent: "liveEdit.unmark",
    source: "widget",
  });

  triggerPostMarkEval(view);

  return true;
}

// ── Lifecycle actions (§6) ───────────────────────────────────────────────

/**
 * Commit a live-edit: snapshot current value, replace wrapper with formatted
 * literal, trigger eval. §6.1
 *
 * The slot is freed; persisted value enters orphan state; widget vanishes.
 * Multi-cursor: applies pointwise per cursor.
 *
 * `commitInFlight` provides §6.7 atomicity — blocks subsequent commits
 * until the eval round-trips.
 */
const commitInFlight = new Set<string>();

export function executeLiveEditCommit(
  view: EditorView,
  store: { getSlot(id: string): LiveEditSlot | undefined },
): boolean {
  const structValue = view.state.field(structField, false);
  if (!structValue) return false;

  const { state: structState, idIndex } = structValue;
  const root = structState.tree.root;
  const allCursors = [structState.cursors.primary, ...structState.cursors.secondaries];

  const changes: ChangeSpec[] = [];

  for (const cursor of allCursors) {
    if (cursor.kind !== "node") continue;

    const targetNode = findById(root, cursor.target);
    if (!targetNode || targetNode.kind === "document") continue;

    // Must have a live-edit Meta
    const liveEditMeta = targetNode.metas.find(
      (m: Meta) => m.kind === "live-edit",
    );
    if (!liveEditMeta) continue;

    const payload = liveEditMeta.payload as LiveEditMetaPayload;
    const slotId = payload.id;
    if (!slotId) continue;

    // §6.7: atomicity — block if commit already in flight for this slot
    if (commitInFlight.has(slotId)) continue;

    const slot = store.getSlot(slotId);
    if (!slot) continue;

    const wrapperRange = idIndex.get(targetNode.id);
    if (!wrapperRange) continue;

    changes.push({
      from: wrapperRange.from,
      to: wrapperRange.to,
      insert: formatSlotValueAsLiteral(slot),
    });

    commitInFlight.add(slotId);
    // Fallback: release after eval round-trip timeout (500ms is generous for WASM eval)
    setTimeout(() => commitInFlight.delete(slotId), 500);
  }

  if (changes.length > 0) {
    executeEditorCommand(view, {
      kind: "applyChanges",
      changes,
      userEvent: "liveEdit.commit",
      source: "widget",
    });

    // §6.1 step 3: trigger immediate eval to free the slot(s).
    triggerPostMarkEval(view);
    return true;
  }

  return false;
}

/**
 * Mark the commit as complete, releasing the atomicity guard.
 * Called by the eval round-trip handler on success or failure.
 */
export function releaseCommitLock(slotId: string): void {
  commitInFlight.delete(slotId);
}

/**
 * Reset a live-edit slot to its seed value. §6.2
 *
 * Source unchanged; pushes a set-live-inputs update via the provided callback.
 */
export function executeLiveEditResetToSeed(
  view: EditorView,
  store: { getSlot(id: string): { seed: number | boolean | string } | undefined },
  onValueChange: (slotId: string, value: number | boolean | string) => void,
): boolean {
  const structValue = view.state.field(structField, false);
  if (!structValue) return false;

  const { state: structState } = structValue;
  const root = structState.tree.root;
  const allCursors = [structState.cursors.primary, ...structState.cursors.secondaries];

  let anyReset = false;

  for (const cursor of allCursors) {
    if (cursor.kind !== "node") continue;

    const targetNode = findById(root, cursor.target);
    if (!targetNode || targetNode.kind === "document") continue;

    const liveEditMeta = targetNode.metas.find(
      (m: Meta) => m.kind === "live-edit",
    );
    if (!liveEditMeta) continue;

    const payload = liveEditMeta.payload as LiveEditMetaPayload;
    const slotId = payload.id;
    if (!slotId) continue;

    const slot = store.getSlot(slotId);
    if (!slot) continue;

    onValueChange(slotId, slot.seed);
    anyReset = true;
  }

  return anyReset;
}

/**
 * Rename a live-edit: write a new :name keyword into the wrapper. §6.3
 *
 * Rewrites `:name "old"` to `:name "new"`, or inserts `:name "new"` before
 * the closing paren if no :name was present.
 */
export function executeLiveEditRename(
  view: EditorView,
  newName: string,
): boolean {
  const structValue = view.state.field(structField, false);
  if (!structValue) return false;

  const { state: structState, idIndex } = structValue;
  const cursor = structState.cursors.primary;
  if (cursor.kind !== "node") return false;

  const targetNode = findById(structState.tree.root, cursor.target);
  if (!targetNode || targetNode.kind === "document") return false;

  const liveEditMeta = targetNode.metas.find(
    (m: Meta) => m.kind === "live-edit",
  );
  if (!liveEditMeta) return false;

  const wrapperRange = idIndex.get(targetNode.id);
  if (!wrapperRange) return false;

  const wrapperText = view.state.doc.sliceString(wrapperRange.from, wrapperRange.to);

  // Replace existing :name or insert before the closing paren
  const namePattern = /:name\s+"[^"]*"/;
  let newWrapperText: string;
  if (namePattern.test(wrapperText)) {
    newWrapperText = wrapperText.replace(namePattern, `:name "${newName}"`);
  } else {
    // Insert :name before the closing paren
    newWrapperText = wrapperText.slice(0, -1) + ` :name "${newName}")`;
  }

  executeEditorCommand(view, {
    kind: "replaceRange",
    from: wrapperRange.from,
    to: wrapperRange.to,
    insert: newWrapperText,
    userEvent: "liveEdit.rename",
    source: "widget",
  });

  return true;
}

/**
 * Edit a live-edit's range: rewrite :min/:max/:step/:precision in the wrapper.
 * §6.4: validates per §8.1, rewrites wrapper, triggers eval.
 */
export function executeLiveEditEditRange(
  view: EditorView,
  params: { min?: number; max?: number; step?: number; precision?: number },
): boolean {
  const structValue = view.state.field(structField, false);
  if (!structValue) return false;

  const { state: structState, idIndex } = structValue;
  const cursor = structState.cursors.primary;
  if (cursor.kind !== "node") return false;

  const targetNode = findById(structState.tree.root, cursor.target);
  if (!targetNode || targetNode.kind === "document") return false;

  const liveEditMeta = targetNode.metas.find(
    (m: Meta) => m.kind === "live-edit",
  );
  if (!liveEditMeta) return false;

  const wrapperRange = idIndex.get(targetNode.id);
  if (!wrapperRange) return false;

  // §8.1: validate min < max
  if (params.min !== undefined && params.max !== undefined && params.min >= params.max) {
    console.warn("[liveEdit.editRange] :min must be less than :max");
    return false;
  }

  let wrapperText = view.state.doc.sliceString(wrapperRange.from, wrapperRange.to);

  // Replace or insert each parameter
  if (params.min !== undefined) {
    const minPattern = /:min\s+[-\d.e]+/;
    if (minPattern.test(wrapperText)) {
      wrapperText = wrapperText.replace(minPattern, `:min ${params.min}`);
    } else {
      wrapperText = wrapperText.slice(0, -1) + ` :min ${params.min})`;
    }
  }
  if (params.max !== undefined) {
    const maxPattern = /:max\s+[-\d.e]+/;
    if (maxPattern.test(wrapperText)) {
      wrapperText = wrapperText.replace(maxPattern, `:max ${params.max}`);
    } else {
      wrapperText = wrapperText.slice(0, -1) + ` :max ${params.max})`;
    }
  }
  if (params.step !== undefined) {
    const stepPattern = /:step\s+[-\d.e]+/;
    if (stepPattern.test(wrapperText)) {
      wrapperText = wrapperText.replace(stepPattern, `:step ${params.step}`);
    } else {
      wrapperText = wrapperText.slice(0, -1) + ` :step ${params.step})`;
    }
  }
  if (params.precision !== undefined) {
    const precPattern = /:precision\s+\d+/;
    if (precPattern.test(wrapperText)) {
      wrapperText = wrapperText.replace(precPattern, `:precision ${params.precision}`);
    } else {
      wrapperText = wrapperText.slice(0, -1) + ` :precision ${params.precision})`;
    }
  }

  executeEditorCommand(view, {
    kind: "replaceRange",
    from: wrapperRange.from,
    to: wrapperRange.to,
    insert: wrapperText,
    userEvent: "liveEdit.editRange",
    source: "widget",
  });

  return true;
}
