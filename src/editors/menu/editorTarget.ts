// Radial-menu adapter for the structural editor. This module owns translating
// between CodeMirror state/source ranges and structural menu targets.

import type { EditorView } from "@codemirror/view";

import type { HoleNode, NodeId } from "../extensions/structure/core/types";
import { findById } from "../extensions/structure/core/traversal";
import { structField } from "../extensions/structure/adapter/stateField";
import type { ApplyTarget, HoleType } from "../../lib/menu/types";

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

