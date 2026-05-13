#!/usr/bin/env node
/**
 * Standalone runner for grab-mode YAML tests.
 *
 * Avoids importing the dispatcher/applyOp chain (which transitively pulls in
 * appSettingsRepository → perfTrace → import.meta.env.DEV crash outside Vite).
 * Instead we drive the core ops + stateField directly.
 */
import './setup.mjs';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));

import {
  startGrab, endGrab, isGrabActive,
  recordGrabMove, getGrabMoveCount, getGrabSnapshot,
} from '../src/lib/gamepad/grabState.ts';

import { EditorState, Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { default_extensions } from '@nextjournal/clojure-mode';
import { history, undo } from '@codemirror/commands';

import {
  structField, setStructState, grabModeField, setGrabMode,
} from '../src/editors/extensions/structure/adapter/stateField.ts';
import { pathsFromCursorSet } from '../src/editors/extensions/structure/adapter/cursorPath.ts';
import { treeFromLezer } from '../src/editors/extensions/structure/adapter/treeFromLezer.ts';
import { printNode } from '../src/editors/extensions/structure/adapter/printTree.ts';

import {
  makeMutators, defaultIdGen, nodeCursor, singleCursor,
  findById, parentOf, isCompound,
} from '../src/editors/extensions/structure/core/index.ts';
import { pathOf } from '../src/editors/extensions/structure/core/traversal.ts';

const mutators = makeMutators({ ids: defaultIdGen('t'), atomSlurpBehaviour: 'promote-to-vector' });

function createView(doc) {
  return new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      extensions: [...default_extensions, history(), structField, grabModeField],
    }),
  });
}

function findNodeIdByRange(value, from, to) {
  let bestId = null;
  let bestSize = Infinity;
  const visit = (node) => {
    const range = value.idIndex.get(node.id);
    if (range && node.kind !== 'document' && range.from === from && range.to === to) {
      const size = range.to - range.from;
      if (size < bestSize) { bestSize = size; bestId = node.id; }
    }
    if (['document','list','vector','map','set'].includes(node.kind)) {
      for (const child of node.children) visit(child);
    }
  };
  visit(value.state.tree.root);
  return bestId;
}

function seedCursorAtRange(view, from, to) {
  const value = view.state.field(structField);
  const nodeId = findNodeIdByRange(value, from, to) || value.state.tree.root.id;
  const newCursors = singleCursor(nodeCursor(nodeId));
  const newState = { tree: value.state.tree, cursors: newCursors };
  view.dispatch({
    effects: setStructState.of({
      state: newState,
      idIndex: value.idIndex,
      cursorPaths: pathsFromCursorSet(newCursors, newState.tree),
    }),
  });
}

function getSelectedText(view) {
  const value = view.state.field(structField);
  const cursor = value.state.cursors.primary;
  const docText = view.state.doc.toString();
  if (cursor.kind === 'node') {
    const range = value.idIndex.get(cursor.target);
    if (!range) return '';
    return docText.slice(range.from, range.to);
  }
  return '';
}

/**
 * Apply a core op against the editor and sync the result back.
 * Mirrors what applyOp does but without importing appSettingsRepository.
 */
function runOp(view, op) {
  const value = view.state.field(structField, false);
  if (!value) return false;
  const before = value.state;
  const result = op(before);
  const after = result.state;

  // Cursor-only update
  if (after.tree === before.tree) {
    if (after.cursors === before.cursors) return false;
    view.dispatch({
      effects: setStructState.of({
        state: after,
        idIndex: value.idIndex,
        cursorPaths: pathsFromCursorSet(after.cursors, after.tree),
      }),
      scrollIntoView: true,
    });
    return true;
  }

  // Tree changed — print the new tree and replace the doc
  const newChildren = after.tree.root.children;
  const text = newChildren.map(printNode).join('\n');
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    userEvent: 'structure.mutate',
  });

  // Re-parse and set cursor
  const { tree, idIndex } = treeFromLezer(view.state);
  const intendedPaths = pathsFromCursorSet(after.cursors, after.tree);
  const cursors = redoCursorsFromPaths(intendedPaths, tree);
  view.dispatch({
    effects: setStructState.of({
      state: { tree, cursors },
      idIndex,
      cursorPaths: pathsFromCursorSet(cursors, tree),
    }),
  });
  return true;
}

function redoCursorsFromPaths(paths, tree) {
  const out = paths.map((p) => {
    let cur = tree.root;
    for (const i of p) {
      if (['list','vector','map','set','document'].includes(cur.kind)) {
        const next = cur.children[i];
        if (!next) { cur = tree.root; break; }
        cur = next;
      } else {
        cur = tree.root;
        break;
      }
    }
    return nodeCursor(cur.id);
  });
  if (out.length === 0) return singleCursor(nodeCursor(tree.root.id));
  return { primary: out[0], secondaries: out.slice(1) };
}

function applyGrabAction(view, action) {
  if (action === 'grab') {
    if (!isGrabActive()) {
      const value = view.state.field(structField);
      const doc = view.state.doc.toString();
      const paths = pathsFromCursorSet(value.state.cursors, value.state.tree);
      startGrab(doc, paths);
      view.dispatch({ effects: setGrabMode.of(true) });
    }
    return;
  }
  if (action === 'drop') {
    if (isGrabActive()) {
      endGrab();
      view.dispatch({ effects: setGrabMode.of(false) });
    }
    return;
  }
  if (action === 'cancel_grab') {
    if (isGrabActive()) {
      const snapshot = getGrabSnapshot();
      const count = getGrabMoveCount();
      endGrab();
      for (let i = 0; i < count; i++) undo(view);
      // Re-derive cursor from saved snapshot paths against the restored tree
      if (snapshot) {
        const { tree, idIndex } = treeFromLezer(view.state);
        const cursors = redoCursorsFromPaths(snapshot.cursorPaths, tree);
        view.dispatch({
          effects: setStructState.of({
            state: { tree, cursors },
            idIndex,
            cursorPaths: snapshot.cursorPaths,
          }),
        });
      }
      view.dispatch({ effects: setGrabMode.of(false) });
    }
    return;
  }

  const opMap = {
    'grab_move_left':  (s) => mutators.transposePrev(s),
    'grab_move_right': (s) => mutators.transposeNext(s),
    'grab_move_up':    (s) => mutators.raise(s),
    'grab_move_down':  (s) => mutators.enclose.list(s),
  };

  const op = opMap[action];
  if (op && isGrabActive()) {
    const ok = runOp(view, op);
    if (ok) recordGrabMove();
  }
}

function runTest(tc) {
  if (isGrabActive()) endGrab();
  const view = createView(tc.code);
  try {
    const selStart = tc.code.indexOf(tc.selection);
    if (selStart === -1) return { name: tc.name, passed: false, error: `Selection "${tc.selection}" not found` };
    seedCursorAtRange(view, selStart, selStart + tc.selection.length);

    const actual = getSelectedText(view);
    if (actual !== tc.selection) {
      return { name: tc.name, passed: false, error: `Seed failed: got "${actual}"`, expected: tc.selection, actual };
    }

    const actions = Array.isArray(tc.actions) ? tc.actions : [tc.actions];
    for (const a of actions) applyGrabAction(view, a);

    const finalCode = view.state.doc.toString();
    if (tc.new_code !== undefined && finalCode !== tc.new_code) {
      return { name: tc.name, passed: false, error: 'Code mismatch', expected: tc.new_code, actual: finalCode };
    }

    if (tc.new_selection !== undefined) {
      const finalSel = getSelectedText(view);
      if (finalSel !== tc.new_selection) {
        return { name: tc.name, passed: false, error: 'Selection mismatch', expected: tc.new_selection, actual: finalSel };
      }
    }

    return { name: tc.name, passed: true };
  } finally {
    try { view.destroy(); } catch {}
  }
}

// Load and run
const content = readFileSync(join(__dirname, 'new_structural/grab_mode_tests.yaml'), 'utf8');
const cases = yaml.load(content);

let passed = 0, failed = 0;
const failures = [];
for (const tc of cases) {
  if (!tc.name) continue;
  const result = runTest(tc);
  if (result.passed) {
    process.stderr.write(`  ✓ ${result.name}\n`);
    passed++;
  } else {
    process.stderr.write(`  ✗ ${result.name}\n`);
    process.stderr.write(`    ${result.error}\n`);
    if (result.expected !== undefined) {
      process.stderr.write(`    expected: ${JSON.stringify(result.expected)}\n`);
      process.stderr.write(`    actual:   ${JSON.stringify(result.actual)}\n`);
    }
    failed++;
    failures.push(result);
  }
}

process.stderr.write(`\n${passed} passing, ${failed} failing\n`);
process.exit(failed > 0 ? 1 : 0);
