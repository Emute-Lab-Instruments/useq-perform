// Radial-menu adapter for the structural editor. This module owns translating
// between CodeMirror state/source ranges and structural menu targets.

import type { ChangeSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

import { executeEditorCommand } from "../../editors/commands/editorCommandRouter";
import type { HoleNode, NodeId, Tree } from "../../editors/extensions/structure/core/types";
import { findById } from "../../editors/extensions/structure/core/traversal";
import { printNode } from "../../editors/extensions/structure/adapter/printTree";
import { structField, type StructFieldValue } from "../../editors/extensions/structure/adapter/stateField";
import type { ApplyTarget, HoleType } from "./types";

export function currentApplyTarget(view: EditorView): ApplyTarget | null {
  const structValue = view.state.field(structField, false);
  if (!structValue) return null;
  const primary = structValue.state.cursors.primary;
  const targetId = primary.kind === "node" ? primary.target : primary.start;
  return { __brand: "ApplyTarget", nodeId: targetId } as unknown as ApplyTarget;
}

export function resolveHoleType(view: EditorView, target: ApplyTarget): HoleType | null {
  const structValue = view.state.field(structField, false);
  if (!structValue) return null;
  const nodeId = (target as unknown as { nodeId: NodeId }).nodeId;
  if (nodeId === undefined) return null;
  const node = findById(structValue.state.tree.root, nodeId);
  if (node === null || node.kind !== "hole") return null;
  return (node as HoleNode).holeType ?? null;
}

/** Replace the smallest changed top-level form, falling back to the document. */
export function applyTreeMutation(
  view: EditorView,
  structValue: StructFieldValue,
  oldTree: Tree,
  newTree: Tree,
): void {
  const oldChildren = oldTree.root.children;
  const newChildren = newTree.root.children;

  if (oldChildren.length !== newChildren.length) {
    replaceDocument(view, newTree);
    return;
  }

  let differingIdx = -1;
  for (let i = 0; i < oldChildren.length; i++) {
    if (oldChildren[i] === newChildren[i]) continue;
    if (differingIdx !== -1) {
      replaceDocument(view, newTree);
      return;
    }
    differingIdx = i;
  }

  if (differingIdx === -1) return;

  const oldChild = oldChildren[differingIdx];
  const oldRange = structValue.idIndex.get(oldChild.id);
  if (!oldRange) {
    replaceDocument(view, newTree);
    return;
  }

  const changes: ChangeSpec = {
    from: oldRange.from,
    to: oldRange.to,
    insert: printNode(newChildren[differingIdx]),
  };
  executeEditorCommand(view, {
    kind: "applyChanges",
    changes,
    scrollIntoView: true,
    userEvent: "menu.verb",
    source: "menu",
  });
}

function replaceDocument(view: EditorView, tree: Tree): void {
  executeEditorCommand(view, {
    kind: "replaceDocument",
    text: tree.root.children.map((node) => printNode(node)).join("\n"),
    source: "menu",
  });
}
