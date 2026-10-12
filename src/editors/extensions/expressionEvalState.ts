// Pure expression evaluation state — no runtime dependencies.
// These definitions are safe to import in any context (Storybook, tests, etc.)
// The side-effectful integration code lives in expressionEval.ts.

import type { EditorState } from "@codemirror/state";
import { Annotation, StateField } from "@codemirror/state";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";

// ---------------------------------------------------------------------------
// Shared regex — matches expression references like a1, d2, s3, etc.
// ---------------------------------------------------------------------------

/** Regex matching expression type references (e.g. `a1`, `d3`, `s2`). Uses the
 *  global flag, so always reset `lastIndex` before each scan. */
export const matchPattern = /\b([ads])([1-8])(?=[\s)(]|$)/g;

export interface OutputAssignment {
  expressionType: string;
  /** Exact source offsets of the evaluated top-level form. */
  from: number;
  to: number;
  line: number;
  endLine: number;
}

/** Output calls and sequential do blocks, excluding references and quoted code. */
export function collectOutputAssignments(state: EditorState): OutputAssignment[] {
  const tree = ensureSyntaxTree(state, state.doc.length, 10) ?? syntaxTree(state);
  const assignments: OutputAssignment[] = [];

  function children(node: SyntaxNode): SyntaxNode[] {
    const result: SyntaxNode[] = [];
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (!["(", ")", "LineComment", "BlockComment"].includes(child.name)) result.push(child);
    }
    return result;
  }

  function isComplete(node: SyntaxNode): boolean {
    if (node.type.isError) return false;
    if (node.name === "List") {
      const head = children(node)[0];
      if (head && state.sliceDoc(head.from, head.to) === "$") return false;
    }
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (!isComplete(child)) return false;
    }
    return true;
  }

  function collect(node: SyntaxNode, outputs: Set<string>): void {
    if (node.name !== "List" || node.lastChild?.name !== ")") return;
    const parts = children(node);
    const head = parts[0];
    if (!head || !["Symbol", "Operator"].includes(head.name)) return;
    const name = state.sliceDoc(head.from, head.to);
    if (/^[ads][1-8]$/.test(name) && parts.length === 2) {
      outputs.add(name);
    } else if (name === "do") {
      for (const part of parts.slice(1)) collect(part, outputs);
    }
  }

  for (let form = tree.topNode.firstChild; form; form = form.nextSibling) {
    if (!isComplete(form)) continue;
    const outputs = new Set<string>();
    collect(form, outputs);
    for (const expressionType of outputs) {
      assignments.push({
        expressionType,
        from: form.from,
        to: form.to,
        line: state.doc.lineAt(form.from).number,
        endLine: state.doc.lineAt(form.to).number,
      });
    }
  }
  return assignments;
}

// ---------------------------------------------------------------------------
// Annotations & StateField
// ---------------------------------------------------------------------------

/** Annotation for expression evaluation events. */
export const expressionEvaluatedAnnotation = Annotation.define<{
  expressionType: string;
  position?: { from: number; to: number; line: number };
  clear?: boolean;
}>();

/** StateField tracking the last evaluated expression for each type. */
export const lastEvaluatedExpressionField = StateField.define<
  Map<string, { from: number; to: number; line: number }>
>({
  create() {
    return new Map();
  },
  update(value, tr) {
    const anns: any[] = (tr as any).annotations || [];
    if (anns.length) {
      let updated = false;
      const newMap = new Map(value);
      const docLen = tr.state.doc.length;
      for (const ann of anns) {
        if (ann.type === expressionEvaluatedAnnotation) {
          const meta = ann.value || {};
          if (meta && meta.expressionType) {
            if (meta.clear) {
              newMap.delete(meta.expressionType);
              updated = true;
            } else if (meta.position !== undefined) {
              if (meta.position.from <= docLen && meta.position.to <= docLen) {
                newMap.set(meta.expressionType, {
                  from: meta.position.from,
                  to: meta.position.to,
                  line: meta.position.line,
                });
                updated = true;
              }
            }
          }
        }
      }
      if (updated) return newMap;
    }
    return value;
  },
});

// ---------------------------------------------------------------------------
// Pure helpers for expression detection
// ---------------------------------------------------------------------------

/** Find expression boundaries by walking up the Lezer syntax tree. */
export function findExpressionBounds(
  state: EditorState,
  matchPos: number,
): { from: number; to: number; startPos: number; endPos: number } {
  const doc = state.doc;
  const tree = syntaxTree(state);
  const node = tree.resolveInner(matchPos, 1);

  let current: any = node;
  while (current && !["List", "Vector", "Map"].includes(current.name)) {
    current = current.parent;
  }

  if (current) {
    return {
      from: doc.lineAt(current.from).number,
      to: doc.lineAt(current.to).number,
      startPos: current.from,
      endPos: current.to,
    };
  }

  const line = doc.lineAt(matchPos);
  return {
    from: line.number,
    to: line.number,
    startPos: line.from,
    endPos: line.to,
  };
}

/** Pure: find expression at a cursor position within a line. */
export function findExpressionAtPosition(
  cursor: number,
  lineText: string,
  lineFrom: number,
  findBoundsFn: (pos: number) => { from: number; startPos: number; endPos: number },
): { expressionType: string; position: { from: number; to: number; line: number } } | null {
  let match: RegExpExecArray | null;
  matchPattern.lastIndex = 0;

  while ((match = matchPattern.exec(lineText)) !== null) {
    const matchStart = lineFrom + match.index;
    const bounds = findBoundsFn(matchStart);
    if (cursor >= bounds.startPos && cursor <= bounds.endPos) {
      return {
        expressionType: `${match[1]}${match[2]}`,
        position: {
          from: bounds.startPos,
          to: bounds.endPos,
          line: bounds.from,
        },
      };
    }
  }

  return null;
}

/** Pure: determine if a range is active based on last evaluation. */
export function isRangeActive(
  range: { from: number; to: number; startPos?: number; endPos?: number },
  lastEvaluated: { line: number; from?: number; to?: number } | null | undefined,
): boolean {
  if (!lastEvaluated) return false;
  if (range.startPos !== undefined && range.endPos !== undefined) {
    return lastEvaluated.from === range.startPos && lastEvaluated.to === range.endPos;
  }
  return lastEvaluated.line >= range.from && lastEvaluated.line <= range.to;
}

/** Pure: find all expression ranges in document text. */
export function findExpressionRanges(
  docLines: Array<{ text: string; from: number }>,
  findBoundsFn: (pos: number) => { from: number; to: number },
  getColorFn: (match: RegExpExecArray) => string,
): Map<string, Array<{ color: string; from: number; to: number; matchStart: number }>> {
  const expressionRanges = new Map<
    string,
    Array<{ color: string; from: number; to: number; matchStart: number }>
  >();

  for (let lineNum = 1; lineNum <= docLines.length; lineNum++) {
    const lineText = docLines[lineNum - 1].text;
    const lineFrom = docLines[lineNum - 1].from;
    let match: RegExpExecArray | null;
    matchPattern.lastIndex = 0;

    while ((match = matchPattern.exec(lineText)) !== null) {
      const matchStart = lineFrom + match.index;
      const expressionType = `${match[1]}${match[2]}`;
      const color = getColorFn(match);
      const bounds = findBoundsFn(matchStart);

      if (!expressionRanges.has(expressionType)) {
        expressionRanges.set(expressionType, []);
      }
      expressionRanges.get(expressionType)!.push({
        color,
        from: bounds.from,
        to: bounds.to,
        matchStart,
      });
    }
  }

  return expressionRanges;
}
