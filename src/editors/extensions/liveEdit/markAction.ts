/**
 * `liveEdit.mark` action — mark/unmark a literal for live editing.
 *
 * Spec: docs/specs/live-edit.md §3
 *
 * Behaviour per context (§3.1):
 *   - Structural mode, cursor on a markable leaf literal: mark.
 *   - Cursor on node with existing `live-edit` Meta: unmark.
 *   - Otherwise: no-op (console toast).
 *
 * This module handles the text-replacement mechanics only. Eval triggers and
 * store registration are deferred to gii8.39/gii8.45.
 */

import type { EditorView } from "@codemirror/view";

import type { DocumentNode } from "../structure/core/index.ts";
import { structField } from "../structure/adapter/stateField.ts";
import { findById, parentOf, isLeaf, type Node, type Meta } from "../structure/core/index.ts";
import type { LiveEditMetaPayload } from "../structure/adapter/treeFromLezer.ts";
import { printNode } from "../structure/adapter/printTree.ts";
import { executeEditorCommand } from "../../commands/editorCommandRouter.ts";
import { inferRange } from "./rangeInference.ts";

// ── ID generation (§3.2) ──────────────────────────────────────────────────

export const ID_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export const ID_LENGTH = 4;

/**
 * Generate a short random ID from a reduced-ambiguity alphabet.
 * Retries on collision with existing IDs in the document.
 */
export function generateId(existingIds: Set<string>): string {
  for (let attempt = 0; attempt < 100; attempt++) {
    let id = "";
    for (let i = 0; i < ID_LENGTH; i++) {
      id += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)];
    }
    if (!existingIds.has(id)) return id;
  }
  // Extremely unlikely fallback: 5-char id
  let id = "";
  for (let i = 0; i < ID_LENGTH + 1; i++) {
    id += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)];
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

// ── Main action ───────────────────────────────────────────────────────────

/**
 * Execute `liveEdit.mark` on the editor.
 *
 * Returns true if the action did something (mark or unmark), false if no-op.
 */
export function executeLiveEditMark(view: EditorView): boolean {
  const structValue = view.state.field(structField, false);
  if (!structValue) return false;

  const { state: structState, idIndex } = structValue;
  const cursor = structState.cursors.primary;
  if (cursor.kind !== "node") return false;

  const targetNode = findById(structState.tree.root, cursor.target);
  if (!targetNode || targetNode.kind === "document") return false;

  // ── Check for existing live-edit Meta → unmark ──────────────────────────
  const liveEditMeta = targetNode.metas.find(
    (m: Meta) => m.kind === "live-edit",
  );

  if (liveEditMeta) {
    return executeUnmark(view, targetNode, idIndex);
  }

  // ── Check markability → mark ────────────────────────────────────────────
  if (!isMarkableLiteral(targetNode)) {
    console.warn("[liveEdit.mark] cursor is not on a markable literal");
    return false;
  }

  // Rejection checks (§3.5)
  if (isInsideDefstateInitial(structState.tree.root, targetNode.id)) {
    console.warn("[liveEdit.mark] cannot mark inside defstate :initial");
    return false;
  }
  if (isInsideQuote(structState.tree.root, targetNode.id)) {
    console.warn("[liveEdit.mark] cannot mark inside quote");
    return false;
  }
  // TODO: "eagerly-consumed top-level position" check (needs firmware spec authoritative list)

  return executeMark(view, targetNode, structState.tree.root, idIndex);
}

// ── Mark ──────────────────────────────────────────────────────────────────

function executeMark(
  view: EditorView,
  targetNode: Node,
  root: DocumentNode,
  idIndex: ReadonlyMap<string, { from: number; to: number }>,
): boolean {
  const range = idIndex.get(targetNode.id);
  if (!range) return false;

  // Generate a fresh ID
  const existingIds = collectExistingIds(root);
  const id = generateId(existingIds);

  // Infer range defaults
  const seed = parseSeedValue(targetNode);
  const parentHead = getParentHead(root, targetNode.id);
  const inferred = inferRange(seed, parentHead);

  // Get the literal text from the document (preserves original formatting)
  const literalText = view.state.doc.sliceString(range.from, range.to);

  // Build the wrapper text
  let wrapper = `(live-edit ${literalText} :id "${id}"`;
  if (inferred) {
    wrapper += ` :min ${inferred.min} :max ${inferred.max}`;
  }
  wrapper += ")";

  // Replace the literal's source range with the wrapper
  executeEditorCommand(view, {
    kind: "replaceRange",
    from: range.from,
    to: range.to,
    insert: wrapper,
    userEvent: "liveEdit.mark",
    source: "keyboard",
  });

  return true;
}

// ── Unmark ────────────────────────────────────────────────────────────────

function executeUnmark(
  view: EditorView,
  targetNode: Node,
  idIndex: ReadonlyMap<string, { from: number; to: number }>,
): boolean {
  // The idIndex maps the host node's id to the wrapper's full source range
  // (set by treeFromLezer during wrapper recognition).
  const wrapperRange = idIndex.get(targetNode.id);
  if (!wrapperRange) return false;

  // Get the inner literal text. For leaf nodes this is node.text.
  let innerText: string;
  if (
    targetNode.kind === "number" ||
    targetNode.kind === "symbol" ||
    targetNode.kind === "keyword" ||
    targetNode.kind === "string"
  ) {
    innerText = targetNode.text;
  } else {
    // Should not happen for live-edit hosts, but fall back to the printNode approach
    innerText = printNode(targetNode);
  }

  // Replace the wrapper's source range with just the inner literal text
  executeEditorCommand(view, {
    kind: "replaceRange",
    from: wrapperRange.from,
    to: wrapperRange.to,
    insert: innerText,
    userEvent: "liveEdit.unmark",
    source: "keyboard",
  });

  return true;
}
