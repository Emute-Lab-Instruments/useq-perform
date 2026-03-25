import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

import { findNodeAt } from "./structure/new-structure.ts";
import { getTrimmedRange } from "./structure/ast.ts";

export type ProbeMode = "raw" | "contextual";

export interface ProbeRange {
  from: number;
  to: number;
}

export interface TemporalWrapper {
  operatorName: string;
  beforeArgs: string[];
  afterArgs: string[];
}

export interface BuiltProbeExpression {
  code: string;
  maxDepth: number;
  appliedDepth: number;
  temporalScale: number;
}

export interface IndexedFormTarget {
  kind: "call" | "shorthand";
  formRange: ProbeRange;
  listRange: ProbeRange;
  phasorRange: ProbeRange;
  elementRanges: ProbeRange[];
  operatorName: string | null;
}

const TEMPORAL_WRAPPER_TARGET_INDEX = new Map<string, number>([
  ["slow", 2],
  ["fast", 2],
  ["offset", 2],
  ["shift", 2],
]);

const INDEXED_LIST_OPERATORS = new Set([
  "from-list",
  "from-flat-list",
  "seq",
]);

function intersectsRange(
  node: { from: number; to: number },
  visibleRanges: readonly ProbeRange[],
): boolean {
  return visibleRanges.some(
    (range) => node.from < range.to && node.to > range.from,
  );
}

export function getNodeText(
  state: EditorState,
  range: ProbeRange,
): string {
  return state.sliceDoc(range.from, range.to);
}

export function getListChildren(node: SyntaxNode | null): SyntaxNode[] {
  if (!node) return [];
  const children: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (
      child.type.name === "(" ||
      child.type.name === ")" ||
      child.type.name === "[" ||
      child.type.name === "]" ||
      child.type.name === "{" ||
      child.type.name === "}"
    ) {
      continue;
    }
    children.push(child);
  }
  return children;
}

export function getOperatorName(node: SyntaxNode | null, state: EditorState): string | null {
  if (!node || node.type.name !== "List") return null;
  const children = getListChildren(node);
  if (children.length === 0) return null;
  const first = children[0];
  if (first.type.name === "Operator" || first.type.name === "Symbol") {
    return state.sliceDoc(first.from, first.to).trim() || null;
  }
  return null;
}

function findExactNodeForRange(
  state: EditorState,
  range: ProbeRange,
): SyntaxNode | null {
  let node = findNodeAt(state, range.from, range.to);
  while (node) {
    if (node.from === range.from && node.to === range.to) {
      return node;
    }
    node = node.parent;
  }

  const tree = syntaxTree(state);
  node = tree.resolveInner(range.from, 1);
  while (node) {
    if (node.from === range.from && node.to === range.to) {
      return node;
    }
    node = node.parent;
  }
  return null;
}

export function getCurrentProbeRange(state: EditorState): ProbeRange | null {
  const selection = state.selection.main;
  const node = findNodeAt(state, selection.from, selection.to);
  const range = getTrimmedRange(node, state);
  return range ? { from: range.from, to: range.to } : null;
}

function buildWrapperExpression(
  wrapper: TemporalWrapper,
  innerCode: string,
): string {
  const parts = [wrapper.operatorName, ...wrapper.beforeArgs, innerCode, ...wrapper.afterArgs];
  return `(${parts.join(" ")})`;
}

/**
 * Compute the effective temporal scale multiplier from a wrapper chain.
 * `slow N` multiplies the period by N; `fast N` divides it by N.
 * Only literal numeric factors are recognised; complex expressions fall
 * back to a neutral 1× multiplier for that wrapper.
 */
function computeTemporalScale(
  wrappers: TemporalWrapper[],
  appliedDepth: number,
): number {
  let multiplier = 1;
  for (let index = 0; index < appliedDepth && index < wrappers.length; index++) {
    const wrapper = wrappers[index];
    const factor = Number.parseFloat(wrapper.beforeArgs[0] ?? "");
    if (!Number.isFinite(factor) || factor <= 0) continue;
    if (wrapper.operatorName === "slow") {
      multiplier *= factor;
    } else if (wrapper.operatorName === "fast") {
      multiplier /= factor;
    }
  }
  return Math.max(0.1, Math.min(multiplier, 32));
}

function collectTemporalWrappers(
  state: EditorState,
  range: ProbeRange,
): TemporalWrapper[] {
  const exactNode = findExactNodeForRange(state, range);
  if (!exactNode) return [];

  const wrappers: TemporalWrapper[] = [];
  let node: SyntaxNode | null = exactNode;

  while (node?.parent) {
    const parent: SyntaxNode = node.parent;
    if (parent.type.name !== "List") {
      node = parent;
      continue;
    }

    const operatorName = getOperatorName(parent, state);
    const targetIndex = operatorName
      ? TEMPORAL_WRAPPER_TARGET_INDEX.get(operatorName)
      : undefined;

    if (operatorName && typeof targetIndex === "number") {
      const children = getListChildren(parent);
      const targetChild = children[targetIndex];
      if (
        targetChild &&
        targetChild.from <= node.from &&
        targetChild.to >= node.to
      ) {
        wrappers.push({
          operatorName,
          beforeArgs: children
            .slice(1, targetIndex)
            .map((child) => state.sliceDoc(child.from, child.to)),
          afterArgs: children
            .slice(targetIndex + 1)
            .map((child) => state.sliceDoc(child.from, child.to)),
        });
      }
    }

    node = parent;
  }

  return wrappers;
}

export function buildProbeExpression(
  state: EditorState,
  range: ProbeRange,
  mode: ProbeMode,
  depthOverride?: number,
): BuiltProbeExpression | null {
  const trimmed = getTrimmedRange(range, state);
  if (!trimmed) return null;

  const innerCode = state.sliceDoc(trimmed.from, trimmed.to).trim();
  if (!innerCode) return null;

  const wrappers = collectTemporalWrappers(state, trimmed);
  const maxDepth = wrappers.length;
  const appliedDepth = mode === "raw"
    ? 0
    : Math.max(0, Math.min(depthOverride ?? maxDepth, maxDepth));

  let code = innerCode;
  for (let index = 0; index < appliedDepth; index++) {
    code = buildWrapperExpression(wrappers[index], code);
  }

  const temporalScale = computeTemporalScale(wrappers, appliedDepth);

  return { code, maxDepth, appliedDepth, temporalScale };
}

function readTrimmedRange(
  node: SyntaxNode | null,
  state: EditorState,
): ProbeRange | null {
  const trimmed = getTrimmedRange(node, state);
  return trimmed ? { from: trimmed.from, to: trimmed.to } : null;
}

function toIndexedFormTarget(
  state: EditorState,
  listNode: SyntaxNode,
): IndexedFormTarget | null {
  const children = getListChildren(listNode);
  if (children.length < 2) return null;

  const operatorName = getOperatorName(listNode, state);

  if (children[0].type.name === "Vector" && children[1]) {
    const listRange = readTrimmedRange(children[0], state);
    const phasorRange = readTrimmedRange(children[1], state);
    if (!listRange || !phasorRange) return null;

    const elementRanges = getListChildren(children[0])
      .map((child) => readTrimmedRange(child, state))
      .filter((range): range is ProbeRange => Boolean(range));

    if (elementRanges.length === 0) return null;

    return {
      kind: "shorthand",
      formRange: { from: listNode.from, to: listNode.to },
      listRange,
      phasorRange,
      elementRanges,
      operatorName: null,
    };
  }

  if (!operatorName || !INDEXED_LIST_OPERATORS.has(operatorName) || children.length < 3) {
    return null;
  }

  const listArg = children[1];
  if (listArg.type.name !== "Vector" && listArg.type.name !== "List") {
    return null;
  }

  const listRange = readTrimmedRange(listArg, state);
  const phasorRange = readTrimmedRange(children[2], state);
  if (!listRange || !phasorRange) return null;

  const elementRanges = getListChildren(listArg)
    .map((child) => readTrimmedRange(child, state))
    .filter((range): range is ProbeRange => Boolean(range));

  if (elementRanges.length === 0) return null;

  return {
    kind: "call",
    formRange: { from: listNode.from, to: listNode.to },
    listRange,
    phasorRange,
    elementRanges,
    operatorName,
  };
}

export function collectVisibleIndexedForms(
  state: EditorState,
  visibleRanges: readonly ProbeRange[],
): IndexedFormTarget[] {
  const tree = syntaxTree(state);
  const seen = new Set<string>();
  const results: IndexedFormTarget[] = [];

  function visit(node: SyntaxNode | null): void {
    if (!node || !intersectsRange(node, visibleRanges)) return;

    if (node.type.name === "List") {
      const target = toIndexedFormTarget(state, node);
      if (target) {
        const key = `${target.formRange.from}:${target.formRange.to}`;
        if (!seen.has(key)) {
          seen.add(key);
          results.push(target);
        }
      }
    }

    for (let child = node.firstChild; child; child = child.nextSibling) {
      visit(child);
    }
  }

  visit(tree.topNode);
  results.sort((left, right) => left.formRange.from - right.formRange.from);
  return results;
}

export function computeFromListIndex(
  elementCount: number,
  phasorValue: number,
): number | null {
  if (!Number.isFinite(phasorValue) || elementCount <= 0) {
    return null;
  }

  let phasor = phasorValue;
  if (phasor < 0) {
    phasor = 0;
  } else if (phasor > 1) {
    phasor = 1;
  }

  let index = Math.floor(elementCount * phasor);
  if (index >= elementCount) {
    index = elementCount - 1;
  }
  if (index < 0) {
    index = 0;
  }
  return index;
}
