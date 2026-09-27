// Radial-menu adapter for the structural editor. This module owns translating
// between CodeMirror state/source ranges and structural menu targets.

import type { EditorView } from "@codemirror/view";

import type { HoleNode, NodeId } from "../extensions/structure/core/types";
import { findById } from "../extensions/structure/core/traversal";
import { structField } from "../extensions/structure/adapter/stateField";
import { cycleSymbol } from "../extensions/structure/core/cycleGroups";
import type { ApplyTarget, HoleType } from "../../lib/menu/types";

export function currentApplyTarget(view: EditorView, side?: "before" | "after"): ApplyTarget | null {
  const structValue = view.state.field(structField, false);
  if (!structValue) return null;
  const primary = structValue.state.cursors.primary;
  const targetId = primary.kind === "node" ? primary.target : primary.start;
  return { __brand: "ApplyTarget", nodeId: targetId, side } as unknown as ApplyTarget;
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

export function quickReplaceCategoryIndex(view: EditorView, target: ApplyTarget, manifest: import("../../lib/menu/types").Manifest): number | undefined {
  const structValue = view.state.field(structField, false);
  if (!structValue) return undefined;
  const nodeId = (target as unknown as { nodeId: NodeId }).nodeId;
  const node = findById(structValue.state.tree.root, nodeId);
  if (!node) return undefined;
  const label = node.kind === "number" ? "number"
    : node.kind === "symbol" ? "symbol"
    : node.kind === "keyword" ? "keyword"
    : node.kind === "string" ? "string"
    : node.kind === "hole" ? (node as HoleNode).holeType
    : "function";
  const categories = manifest.tabs[0]?.categories ?? [];
  const index = categories.findIndex((category) => category.label.toLowerCase().includes(label));
  if (index >= 0) return index;
  const itemKind = label === "function" ? "function" : label === "symbol" ? "symbol" : label === "number" ? "literal" : null;
  const fallback = itemKind === null ? -1 : categories.findIndex((category) =>
    category.items.some((item) => item.kind === itemKind &&
      (label !== "number" || (item.kind === "literal" && item.literalKind === "number"))),
  );
  return fallback < 0 ? undefined : fallback;
}

export function quickReplaceIsNumber(view: EditorView, target: ApplyTarget): boolean {
  const structValue = view.state.field(structField, false);
  if (!structValue) return false;
  const nodeId = (target as unknown as { nodeId: NodeId }).nodeId;
  const node = findById(structValue.state.tree.root, nodeId);
  return node?.kind === "number" || (node?.kind === "hole" && (node as HoleNode).holeType === "number");
}

export function quickReplaceIsCompound(view: EditorView, target: ApplyTarget): boolean {
  const structValue = view.state.field(structField, false);
  if (!structValue) return false;
  const nodeId = (target as unknown as { nodeId: NodeId }).nodeId;
  const node = findById(structValue.state.tree.root, nodeId);
  return node !== null && ["list", "vector", "map", "set"].includes(node.kind);
}

export function quickReplaceManifestForTarget(
  view: EditorView,
  target: ApplyTarget,
  manifest: import("../../lib/menu/types").Manifest,
): import("../../lib/menu/types").Manifest {
  const structValue = view.state.field(structField, false);
  if (!structValue) return manifest;
  const nodeId = (target as unknown as { nodeId: NodeId }).nodeId;
  const node = findById(structValue.state.tree.root, nodeId);
  if (node?.kind !== "symbol") return manifest;
  const cycle = cycleSymbol(node.text, 1);
  if (cycle.kind === "no-group") return manifest;
  return {
    ...manifest,
    tabs: manifest.tabs.map((tab) => ({
      ...tab,
      categories: tab.categories.map((category) => {
        if (!category.items.some((item) => item.kind === "symbol" && cycle.members.includes(item.text))) return category;
        return {
          ...category,
          items: category.items.filter((item) => item.kind !== "symbol" || cycle.members.includes(item.text)),
        };
      }),
    })),
  };
}
