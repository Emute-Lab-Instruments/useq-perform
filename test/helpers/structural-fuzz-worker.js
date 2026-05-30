import "../setup.mjs";

import { strict as assert } from "assert";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
// @ts-expect-error — clojure-mode has no type declarations
import { default_extensions } from "@nextjournal/clojure-mode";
import { history } from "@codemirror/commands";

import { executeEditorCommand } from "../../src/editors/commands/editorCommandRouter.ts";
import {
  KNOWN_ACTIONS,
} from "../../src/editors/extensions/structure/adapter/dispatcher.ts";
import {
  deleteConfirmField,
} from "../../src/editors/extensions/deleteConfirmFlash.ts";
import {
  structField,
} from "../../src/editors/extensions/structure/adapter/stateField.ts";
import {
  childrenOf,
} from "../../src/editors/extensions/structure/core/index.ts";
import {
  pathOf,
} from "../../src/editors/extensions/structure/core/traversal.ts";
import {
  pathsFromCursorSet,
} from "../../src/editors/extensions/structure/adapter/cursorPath.ts";

const STRUCTURAL_ACTIONS = [...KNOWN_ACTIONS];
const KEY_ACTIONS = [
  "Backspace",
  "Delete",
  "Enter",
  "(",
  "[",
  "{",
  "\"",
  ")",
  "]",
  "}",
];
const TYPE_SNIPPETS = [
  "x",
  "foo",
  " 1",
  " :freq",
  "\n",
  "(+ t 1)",
  "[$ bad",
  "live-edit",
  "\"tone\"",
  "; comment with (fake form)\n",
  "#_",
];
const REPLACE_SNIPPETS = [
  "",
  " ",
  "x",
  "42",
  "(+ t 1)",
  "(live-edit 0 :id \"f\" :min 0 :max 1)",
  "($ pitch :number)",
  "[1 2 3]",
  "{:a 1 :b 2}",
  ")))",
  "(a1 (",
  "; (a1 1)\n",
  "\"unterminated",
  "#_{:ignored (bad",
];
const SYMBOLS = ["a1", "t", "foo", "bar", "baz", "+", "*", "sin", "sqr"];
const ROUGH_DOCUMENTS = [
  "",
  "(",
  ")))",
  "(a1 (",
  "(let [x 1 y] (+ x y",
  "; comment only with (a1 1)\n(a1 (+ t 1))",
  "#_(bad [1 2)\n(a1 t)",
  "\"unterminated string\n(+ t 1)",
  "(live-edit :id \"missing-host\")",
  "($ pitch :not-a-real-type)",
];

function envInt(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function envSeed() {
  const raw = process.env.STRUCTURAL_FUZZ_SEED ?? "12648430";
  const parsed = Number(raw);
  if (Number.isFinite(parsed)) return parsed >>> 0;
  let hash = 2166136261;
  for (const ch of raw) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rng, values) {
  return values[Math.floor(rng() * values.length)];
}

function int(rng, maxExclusive) {
  return Math.floor(rng() * maxExclusive);
}

function createView(doc) {
  return new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      extensions: [...default_extensions, history(), structField, deleteConfirmField],
    }),
  });
}

function generateAtom(rng) {
  const roll = rng();
  if (roll < 0.48) return pick(rng, SYMBOLS);
  if (roll < 0.72) return String(int(rng, 16));
  if (roll < 0.88) return pick(rng, [":freq", ":gate", ":amp", ":rate"]);
  return JSON.stringify(pick(rng, ["tone", "gate", "cut"]));
}

function generateExpr(rng, depth) {
  if (depth <= 0 || rng() < 0.42) return generateAtom(rng);

  const kind = pick(rng, ["list", "vector", "map", "hole", "liveEdit"]);
  if (kind === "hole") {
    return `($ ${pick(rng, ["pitch", "rate", "shape"])} ${pick(rng, [":number", ":symbol", ":expr"])})`;
  }
  if (kind === "liveEdit") {
    return `(live-edit ${generateAtom(rng)} :id ${JSON.stringify(`f${int(rng, 20)}`)} :min 0 :max ${int(rng, 8) + 1})`;
  }

  const childCount = kind === "map" ? 2 * (1 + int(rng, 3)) : 1 + int(rng, 4);
  const children = [];
  for (let i = 0; i < childCount; i++) {
    if (kind === "map" && i % 2 === 0) {
      children.push(pick(rng, [":a", ":b", ":c", ":freq"]));
    } else {
      children.push(generateExpr(rng, depth - 1));
    }
  }
  if (kind === "vector") return `[${children.join(" ")}]`;
  if (kind === "map") return `{${children.join(" ")}}`;
  return `(${children.join(" ")})`;
}

function generateDocument(rng) {
  if (rng() < 0.18) return pick(rng, ROUGH_DOCUMENTS);
  const forms = 1 + int(rng, 4);
  const out = [];
  for (let i = 0; i < forms; i++) {
    out.push(generateExpr(rng, 3));
  }
  return out.join(rng() < 0.35 ? "\n" : " ");
}

function randomRange(rng, docLength) {
  if (docLength === 0) return { from: 0, to: 0 };
  const from = int(rng, docLength + 1);
  const width = int(rng, Math.min(18, docLength - from) + 1);
  return { from, to: from + width };
}

function randomSelection(rng, docLength) {
  const range = randomRange(rng, docLength);
  if (rng() < 0.5) return { anchor: range.from, head: range.to };
  return { anchor: range.to, head: range.from };
}

function chooseOperation(rng, view, context) {
  const roll = rng();
  const docLength = view.state.doc.length;

  if (roll < 0.32) {
    return { kind: "structural", action: pick(rng, STRUCTURAL_ACTIONS) };
  }
  if (roll < 0.44) {
    return { kind: "key", key: pick(rng, KEY_ACTIONS) };
  }
  if (roll < 0.56) {
    return { kind: "typeText", text: pick(rng, TYPE_SNIPPETS) };
  }
  if (roll < 0.72) {
    const range = randomRange(rng, docLength);
    return {
      kind: "replaceRange",
      from: range.from,
      to: range.to,
      insert: pick(rng, REPLACE_SNIPPETS),
    };
  }
  if (roll < 0.80) {
    return { kind: "selectRange", ...randomSelection(rng, docLength) };
  }
  if (roll < 0.86) {
    return { kind: pick(rng, ["copySelection", "cutSelection"]) };
  }
  if (roll < 0.91 && context.clipboard.length > 0) {
    return { kind: "pasteClipboard" };
  }
  if (roll < 0.94) {
    return { kind: "deleteNode" };
  }
  if (roll < 0.955) {
    return { kind: "adjustNumber", delta: pick(rng, [-10, -1, -0.1, 0.1, 1, 10]) };
  }
  if (roll < 0.965) {
    // §2.3: kind-dispatched atom adjust (number/symbol/keyword/boolean step).
    return { kind: "atomAdjust", direction: pick(rng, [1, -1]) };
  }
  if (roll < 0.97) {
    // §2.3: polarity flip on the focused atom.
    return { kind: "atomFlipPolarity" };
  }
  if (roll < 0.985) {
    const anchor = docLength === 0 ? 0 : int(rng, docLength + 1);
    return { kind: "select", anchor };
  }
  if (roll < 0.99) {
    return { kind: pick(rng, ["undo", "redo"]) };
  }
  return { kind: "replaceDocument", text: generateDocument(rng) };
}

function applyOperation(view, operation, context) {
  switch (operation.kind) {
    case "select":
      view.dispatch({ selection: { anchor: operation.anchor } });
      return true;
    case "selectRange":
      view.dispatch({
        selection: { anchor: operation.anchor, head: operation.head },
      });
      return true;
    case "copySelection": {
      const sel = selectionRange(view);
      context.clipboard = view.state.doc.sliceString(sel.from, sel.to);
      return true;
    }
    case "cutSelection": {
      const sel = selectionRange(view);
      context.clipboard = view.state.doc.sliceString(sel.from, sel.to);
      return executeEditorCommand(view, {
        kind: "replaceRange",
        from: sel.from,
        to: sel.to,
        insert: "",
        selectionAnchor: sel.from,
        userEvent: "delete.cut",
        source: "test",
      });
    }
    case "pasteClipboard":
      return executeEditorCommand(view, {
        kind: "insertText",
        text: context.clipboard,
        source: "test",
      });
    case "structural":
      return executeEditorCommand(view, {
        kind: "structural",
        action: operation.action,
        source: "test",
      });
    case "key":
      return executeEditorCommand(view, {
        kind: "key",
        key: operation.key,
        source: "test",
      });
    case "typeText":
      return executeEditorCommand(view, {
        kind: "typeText",
        text: operation.text,
        source: "test",
      });
    case "replaceRange":
      return executeEditorCommand(view, {
        kind: "replaceRange",
        from: operation.from,
        to: operation.to,
        insert: operation.insert,
        source: "test",
      });
    case "replaceDocument":
      return executeEditorCommand(view, {
        kind: "replaceDocument",
        text: operation.text,
        source: "test",
      });
    case "deleteNode":
      return executeEditorCommand(view, { kind: "deleteNode", source: "test" });
    case "adjustNumber":
      return executeEditorCommand(view, {
        kind: "adjustNumber",
        delta: operation.delta,
        source: "test",
      });
    case "atomAdjust":
      return executeEditorCommand(view, {
        kind: "atomAdjust",
        direction: operation.direction,
        source: "test",
      });
    case "atomFlipPolarity":
      return executeEditorCommand(view, {
        kind: "atomFlipPolarity",
        source: "test",
      });
    case "undo":
      return executeEditorCommand(view, { kind: "undo", source: "test" });
    case "redo":
      return executeEditorCommand(view, { kind: "redo", source: "test" });
    default:
      throw new Error(`Unknown fuzz operation ${JSON.stringify(operation)}`);
  }
}

function selectionRange(view) {
  const sel = view.state.selection.main;
  const docLength = view.state.doc.length;
  const anchor = Math.max(0, Math.min(sel.anchor, docLength));
  const head = Math.max(0, Math.min(sel.head, docLength));
  return {
    from: Math.min(anchor, head),
    to: Math.max(anchor, head),
  };
}

function assertCursor(cursor, context, ids, parents, childIndexes, idIndex) {
  if (cursor.kind === "node") {
    assert(ids.has(cursor.target), `${context}: node cursor target not in tree`);
    assert(idIndex.has(cursor.target), `${context}: node cursor target has no source range`);
    return;
  }

  assert(ids.has(cursor.parent), `${context}: range cursor parent not in tree`);
  assert(ids.has(cursor.start), `${context}: range cursor start not in tree`);
  assert(ids.has(cursor.end), `${context}: range cursor end not in tree`);
  assert(idIndex.has(cursor.start), `${context}: range cursor start has no source range`);
  assert(idIndex.has(cursor.end), `${context}: range cursor end has no source range`);
  assert.equal(
    parents.get(cursor.start),
    cursor.parent,
    `${context}: range start is not a child of range parent`,
  );
  assert.equal(
    parents.get(cursor.end),
    cursor.parent,
    `${context}: range end is not a child of range parent`,
  );
  assert(
    childIndexes.get(cursor.start) <= childIndexes.get(cursor.end),
    `${context}: range cursor endpoints are inverted`,
  );
}

function assertStructuralInvariants(view, context) {
  const doc = view.state.doc.toString();
  const selection = view.state.selection.main;
  assert(selection.from >= 0, `${context}: selection starts before document`);
  assert(selection.to <= doc.length, `${context}: selection ends after document`);

  const value = view.state.field(structField, false);
  assert(value, `${context}: structural state field missing`);

  const ids = new Set();
  const parents = new Map();
  const childIndexes = new Map();
  const visit = (node, parentId = null) => {
    assert(!ids.has(node.id), `${context}: duplicate structural node id ${node.id}`);
    ids.add(node.id);
    if (parentId !== null) parents.set(node.id, parentId);

    const range = value.idIndex.get(node.id);
    assert(range, `${context}: node ${node.id} (${node.kind}) has no source range`);
    assert(Number.isInteger(range.from), `${context}: node ${node.id} range.from is not an integer`);
    assert(Number.isInteger(range.to), `${context}: node ${node.id} range.to is not an integer`);
    assert(range.from >= 0, `${context}: node ${node.id} range starts before document`);
    assert(range.to <= doc.length, `${context}: node ${node.id} range ends after document`);
    assert(range.from <= range.to, `${context}: node ${node.id} range is inverted`);

    const children = childrenOf(node);
    if (node.kind === "document") {
      assert.equal(range.from, 0, `${context}: document range does not start at 0`);
      assert.equal(range.to, doc.length, `${context}: document range does not end at doc length`);
    }
    let previousChildStart = -1;
    children.forEach((child, index) => {
      const childRange = value.idIndex.get(child.id);
      assert(childRange, `${context}: child ${child.id} has no source range before visit`);
      assert(
        childRange.from >= range.from && childRange.to <= range.to,
        `${context}: child ${child.id} range is outside parent ${node.id}`,
      );
      assert(
        childRange.from >= previousChildStart,
        `${context}: child ${child.id} range is before previous sibling`,
      );
      previousChildStart = childRange.from;
      childIndexes.set(child.id, index);
      visit(child, node.id);
    });
  };
  visit(value.state.tree.root);

  assert.equal(value.idIndex.size, ids.size, `${context}: idIndex has stale or missing entries`);

  assertCursor(value.state.cursors.primary, `${context}: primary`, ids, parents, childIndexes, value.idIndex);
  value.state.cursors.secondaries.forEach((cursor, index) => {
    assertCursor(cursor, `${context}: secondary ${index}`, ids, parents, childIndexes, value.idIndex);
  });

  const primaryId = value.state.cursors.primary.kind === "node"
    ? value.state.cursors.primary.target
    : value.state.cursors.primary.start;
  assert(pathOf(value.state.tree.root, primaryId), `${context}: primary cursor has no path`);
  assert.doesNotThrow(
    () => pathsFromCursorSet(value.state.cursors, value.state.tree),
    `${context}: cursor paths cannot be derived`,
  );
}

function formatReplay(seed, caseIndex, stepIndex, replay, docBefore, docAfter, cause) {
  return [
    `Structural fuzz failure`,
    `seed=${seed} case=${caseIndex} step=${stepIndex}`,
    `operation=${JSON.stringify(replay.at(-1))}`,
    `docBefore=${JSON.stringify(docBefore)}`,
    `docAfter=${JSON.stringify(docAfter)}`,
    `replay=${JSON.stringify(replay)}`,
    cause?.stack ?? String(cause),
  ].join("\n");
}

export function runStructuralFuzz() {
  const seed = envSeed();
  const rng = mulberry32(seed);
  const cases = envInt("STRUCTURAL_FUZZ_CASES", 16);
  const steps = envInt("STRUCTURAL_FUZZ_STEPS", 100);
  const maxDocLength = envInt("STRUCTURAL_FUZZ_MAX_DOC_LENGTH", 700);

  for (let caseIndex = 0; caseIndex < cases; caseIndex++) {
    const replay = [];
    const context = { clipboard: "" };
    let view = null;

    try {
      view = createView(generateDocument(rng));
      assertStructuralInvariants(view, `seed=${seed} case=${caseIndex} initial`);

      for (let stepIndex = 0; stepIndex < steps; stepIndex++) {
        if (view.state.doc.length > maxDocLength) {
          const resetOperation = { kind: "replaceDocument", text: generateDocument(rng) };
          replay.push(resetOperation);
          applyOperation(view, resetOperation, context);
          assertStructuralInvariants(
            view,
            `seed=${seed} case=${caseIndex} step=${stepIndex} reset`,
          );
        }

        const operation = chooseOperation(rng, view, context);
        replay.push(operation);
        const docBefore = view.state.doc.toString();

        try {
          applyOperation(view, operation, context);
          assertStructuralInvariants(
            view,
            `seed=${seed} case=${caseIndex} step=${stepIndex}`,
          );
        } catch (error) {
          throw new Error(
            formatReplay(
              seed,
              caseIndex,
              stepIndex,
              replay,
              docBefore,
              view.state.doc.toString(),
              error,
            ),
          );
        }
      }
    } finally {
      if (view) view.destroy();
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runStructuralFuzz();
}
