/**
 * Vector-mark sub-mode controller — gii8.38.
 *
 * Spec: docs/specs/live-edit.md §3.7
 *
 * When `liveEdit.mark` is pressed on a vector compound, the editor enters a
 * transient sub-mode where the user can select which elements to wrap as
 * live-edits before committing. This module implements the controller logic;
 * the visual decorations live in `vectorMarking.ts`.
 *
 * Usage:
 *   const ctrl = createVectorMarkController({ defaultMarkState: "all" });
 *   if (ctrl.enter(view)) {
 *     // sub-mode active — wire nav.next/prev/toggle/commit/cancel
 *   }
 */

import type { ChangeSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

import type {
  VectorMarkDefault,
  VectorMarkElement,
  VectorMarkSession,
  VectorMarkState,
} from "../../../contracts/liveEdit.ts";
import type { LiveEditMetaPayload } from "../structure/adapter/treeFromLezer.ts";
import { structField } from "../structure/adapter/stateField.ts";
import {
  childrenOf,
  findById,
  isCompound,
  isLeaf,
  parentOf,
  type Meta,
  type Node,
} from "../structure/core/index.ts";
import { inferRange } from "./rangeInference.ts";
import { generateId } from "./markAction.ts";
import {
  clearVectorMarkSession,
  setVectorMarkSession,
  vectorMarkSessionField,
} from "./vectorMarking.ts";
import { executeEditorCommand } from "../../commands/editorCommandRouter.ts";

// ── Public interface ──────────────────────────────────────────────────────

export interface VectorMarkController {
  /** True when the sub-mode is active. */
  readonly active: boolean;

  /** Enter the vector-mark sub-mode for the vector at the cursor. Returns false if not a vector or empty. */
  enter(view: EditorView): boolean;

  /** Move focus to the next markable element. */
  next(view: EditorView): void;

  /** Move focus to the previous markable element. */
  prev(view: EditorView): void;

  /** Toggle the focused element's selection state. */
  toggle(view: EditorView): void;

  /** Commit: wrap all selected elements, exit sub-mode. */
  commit(view: EditorView): void;

  /** Cancel: exit sub-mode without changes. */
  cancel(view: EditorView): void;
}

// ── Helpers ──────────────────────────────────────────────────────────────

/** Check if a node is a markable literal (same rules as markAction.ts). */
function isMarkableLiteral(node: Node): boolean {
  if (!isLeaf(node)) return false;
  if (node.kind === "number") return true;
  // Boolean literals are parsed as symbols ("true"/"false") in clojure-mode.
  if (
    node.kind === "symbol" &&
    (node.text === "true" || node.text === "false")
  )
    return true;
  // Keywords like :up, :down are markable (enum slots).
  if (node.kind === "keyword") return true;
  return false;
}

/** Check if a node has a live-edit Meta. */
function hasLiveEditMeta(node: Node): boolean {
  if (node.kind === "document") return false;
  return node.metas.some((m: Meta) => m.kind === "live-edit");
}

/** Parse the seed value from a node's text (same as markAction.ts). */
function parseSeedValue(node: Node): number | boolean | string {
  if (node.kind === "number") return Number(node.text);
  if (node.kind === "symbol" && node.text === "true") return true;
  if (node.kind === "symbol" && node.text === "false") return false;
  if (node.kind === "keyword") return node.text;
  return 0;
}

/**
 * Get the head symbol of the parent list (for range inference context).
 * Walks up from the vector to its parent, checking for a list head.
 */
function getParentHeadOfVector(
  root: Node & { kind: "document" },
  vectorId: string,
): string | undefined {
  const parent = parentOf(root, vectorId);
  if (parent === null || parent.kind === "document") return undefined;
  if (parent.kind === "list" && parent.children.length > 0) {
    const head = parent.children[0]!;
    if (head.kind === "symbol") return head.text;
  }
  return undefined;
}

/**
 * Collect all existing live-edit IDs from the document tree.
 */
function collectExistingIds(root: Node): Set<string> {
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
    if (
      node.kind === "list" ||
      node.kind === "vector" ||
      node.kind === "map" ||
      node.kind === "set" ||
      node.kind === "document"
    ) {
      for (const child of (node as { children: ReadonlyArray<Node> }).children)
        walk(child);
    }
  }
  walk(root);
  return ids;
}

/** Find the first markable element index, or -1. */
function firstMarkableIndex(elements: VectorMarkElement[]): number {
  return elements.findIndex((el) => el.state !== "non-markable");
}

/** Find the next markable element index (wrapping), or -1 if none. */
function nextMarkable(elements: VectorMarkElement[], from: number): number {
  const len = elements.length;
  for (let i = 1; i <= len; i++) {
    const idx = (from + i) % len;
    if (elements[idx].state !== "non-markable") return idx;
  }
  return -1;
}

/** Find the previous markable element index (wrapping), or -1 if none. */
function prevMarkable(elements: VectorMarkElement[], from: number): number {
  const len = elements.length;
  for (let i = 1; i <= len; i++) {
    const idx = (from - i + len) % len;
    if (elements[idx].state !== "non-markable") return idx;
  }
  return -1;
}

// ── Factory ─────────────────────────────────────────────────────────────

export function createVectorMarkController(options?: {
  defaultMarkState?: VectorMarkDefault;
}): VectorMarkController {
  const defaultState: VectorMarkDefault =
    options?.defaultMarkState ?? "all";

  let _active = false;

  const controller: VectorMarkController = {
    get active() {
      return _active;
    },

    enter(view: EditorView): boolean {
      const structValue = view.state.field(structField, false);
      if (!structValue) return false;

      const { state: structState, idIndex } = structValue;
      const cursor = structState.cursors.primary;
      if (cursor.kind !== "node") return false;

      const targetNode = findById(structState.tree.root, cursor.target);
      if (!targetNode) return false;

      // §3.7: must be a vector compound.
      if (targetNode.kind !== "vector") return false;

      const children = childrenOf(targetNode);

      // Build elements array from the vector's children.
      const elements: VectorMarkElement[] = [];
      for (const child of children) {
        const range = idIndex.get(child.id);
        if (!range) continue;

        let state: VectorMarkState;
        if (isMarkableLiteral(child)) {
          // §3.7.5: elements with existing live-edit Meta are pre-selected.
          if (hasLiveEditMeta(child)) {
            state = "selected";
          } else {
            state = defaultState === "all" ? "selected" : "deselected";
          }
        } else {
          state = "non-markable";
        }

        elements.push({ range: { from: range.from, to: range.to }, state });
      }

      // §3.7.4: no markable elements → no-op.
      const firstIdx = firstMarkableIndex(elements);
      if (firstIdx === -1) return false;

      const vectorRange = idIndex.get(targetNode.id);
      if (!vectorRange) return false;

      const session: VectorMarkSession = {
        vectorRange: { from: vectorRange.from, to: vectorRange.to },
        elements,
        focusIndex: firstIdx,
      };

      setVectorMarkSession(view, session);
      _active = true;
      return true;
    },

    next(view: EditorView): void {
      if (!_active) return;
      const session = view.state.field(vectorMarkSessionField, false);
      if (!session) return;

      const nextIdx = nextMarkable(session.elements, session.focusIndex);
      if (nextIdx === -1) return;

      setVectorMarkSession(view, { ...session, focusIndex: nextIdx });
    },

    prev(view: EditorView): void {
      if (!_active) return;
      const session = view.state.field(vectorMarkSessionField, false);
      if (!session) return;

      const prevIdx = prevMarkable(session.elements, session.focusIndex);
      if (prevIdx === -1) return;

      setVectorMarkSession(view, { ...session, focusIndex: prevIdx });
    },

    toggle(view: EditorView): void {
      if (!_active) return;
      const session = view.state.field(vectorMarkSessionField, false);
      if (!session) return;

      const { focusIndex, elements } = session;
      if (focusIndex < 0 || focusIndex >= elements.length) return;

      const current = elements[focusIndex];
      if (current.state === "non-markable") return;

      const newState: VectorMarkState =
        current.state === "selected" ? "deselected" : "selected";
      const newElements = elements.map((el, i) =>
        i === focusIndex ? { ...el, state: newState } : el,
      );

      setVectorMarkSession(view, { ...session, elements: newElements });
    },

    commit(view: EditorView): void {
      if (!_active) return;
      const session = view.state.field(vectorMarkSessionField, false);
      if (!session) return;

      const structValue = view.state.field(structField, false);
      if (!structValue) {
        clearVectorMarkSession(view);
        _active = false;
        return;
      }

      const { state: structState } = structValue;

      // Collect existing IDs for collision avoidance.
      const existingIds = collectExistingIds(structState.tree.root);

      // Find the vector node to get parent head for range inference.
      // Walk to the vector by its range.
      let vectorNodeId: string | null = null;
      const cursor = structState.cursors.primary;
      if (cursor.kind === "node") {
        vectorNodeId = cursor.target;
      }

      const parentHead = vectorNodeId
        ? getParentHeadOfVector(structState.tree.root, vectorNodeId)
        : undefined;

      // Build text replacements for selected elements.
      // We use CodeMirror's ChangeSpec[] which handles offset management.
      const changes: ChangeSpec[] = [];

      for (const el of session.elements) {
        if (el.state !== "selected") continue;

        // Check if this element already has a live-edit wrapper.
        // If it does, we skip it (it's already marked).
        // We detect this by checking if the source text starts with "(live-edit".
        const sourceText = view.state.doc.sliceString(
          el.range.from,
          el.range.to,
        );
        if (sourceText.startsWith("(live-edit")) continue;

        // Generate a fresh ID.
        const id = generateId(existingIds);
        existingIds.add(id);

        // Parse seed and infer range.
        const seed = parseSeedFromText(sourceText);
        const inferred = inferRange(seed, parentHead);

        // Build the wrapper text.
        let wrapper = `(live-edit ${sourceText} :id "${id}"`;
        if (inferred) {
          wrapper += ` :min ${inferred.min} :max ${inferred.max}`;
        }
        wrapper += ")";

        changes.push({
          from: el.range.from,
          to: el.range.to,
          insert: wrapper,
        });
      }

      // Handle unmarking: deselected elements that already have live-edit
      // wrappers should be unwrapped.
      for (const el of session.elements) {
        if (el.state !== "deselected") continue;

        const sourceText = view.state.doc.sliceString(
          el.range.from,
          el.range.to,
        );

        // Find if this node in the structural tree has a live-edit Meta.
        // The idIndex maps node IDs to ranges; walk the tree to find
        // a node whose range matches this element.
        const node = findNodeByRange(
          structState.tree.root,
          structValue.idIndex,
          el.range.from,
          el.range.to,
        );
        if (node && hasLiveEditMeta(node)) {
          // Unwrap: the node text (without the wrapper) is the inner literal.
          // The node.text holds the literal text.
          if (
            node.kind === "number" ||
            node.kind === "symbol" ||
            node.kind === "keyword" ||
            node.kind === "string"
          ) {
            changes.push({
              from: el.range.from,
              to: el.range.to,
              insert: node.text,
            });
          }
        }
      }

      // Apply all changes in a single transaction.
      if (changes.length > 0) {
        executeEditorCommand(view, {
          kind: "applyChanges",
          changes,
          userEvent: "liveEdit.vectorMark",
          source: "keyboard",
        });
      }

      clearVectorMarkSession(view);
      _active = false;
    },

    cancel(view: EditorView): void {
      if (!_active) return;
      clearVectorMarkSession(view);
      _active = false;
    },
  };

  return controller;
}

// ── Internal helpers ────────────────────────────────────────────────────

/** Parse a seed value from raw source text. */
function parseSeedFromText(text: string): number | boolean | string {
  if (text === "true") return true;
  if (text === "false") return false;
  if (text.startsWith(":")) return text;
  const n = Number(text);
  if (!isNaN(n)) return n;
  return text;
}

/**
 * Find a node in the tree whose idIndex range matches the given from/to.
 * This is needed because during the vector-mark session, the session stores
 * ranges (not node IDs), and we need to map back to nodes for unwrap checks.
 */
function findNodeByRange(
  root: Node & { kind: "document" },
  idIndex: ReadonlyMap<string, { from: number; to: number }>,
  from: number,
  to: number,
): Node | null {
  for (const [id, range] of idIndex) {
    if (range.from === from && range.to === to) {
      const node = findById(root, id);
      if (node) return node;
    }
  }
  return null;
}
