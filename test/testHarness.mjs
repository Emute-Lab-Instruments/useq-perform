/**
 * Test Harness for the new Structural Editing core (Phase 2.12).
 *
 * Drives the YAML acceptance suite through the new dispatcher in
 * `src/editors/extensions/structure/adapter/dispatcher.ts`. All actions are
 * routed through `dispatchAction(view, "nav.*"/"edit.*")` against a real
 * headless `EditorView` (jsdom is wired in `test/setup.mjs`).
 *
 * Supports two YAML formats:
 *
 * Legacy (editing_tests.yaml):
 *   code, selection, new_selection, new_code, actions, steps, selection_cursor, cursor_char
 *
 * Guillemet (navigation_tests.yaml):
 *   code with «» marking initial selection, expected, actions
 *
 * Public API kept compatible with `test/structural-yaml.test.mjs`:
 *   runTestCase, loadTestFile, runTestFile, runAllTests
 *
 * Many YAML actions don't have a 1:1 dispatcher equivalent yet (cut/paste/
 * type/insert/move/duplicate/delete are legacy-only — the new core uses
 * radial-menu pickers and structural mutators instead). Those tests will fail;
 * the failure list is categorised in `structural-yaml.test.mjs` KNOWN_FAILURES.
 */

import fs from 'fs';
import yaml from 'js-yaml';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
// @ts-expect-error — clojure-mode has no type declarations
import { default_extensions } from '@nextjournal/clojure-mode';

// We deliberately do NOT import the bundled `structuralCoreExtensions()` here.
// That bundle pulls in `holeWidget.ts` → `appSettingsRepository.ts` →
// `perfTrace.ts`, which references `import.meta.env.DEV` (a Vite construct)
// and crashes outside Vite's loader. The harness only needs the state field
// for cursor reads; visual decorations don't affect dispatcher behaviour.
import { dispatchAction } from '../src/editors/extensions/structure/adapter/dispatcher.ts';
import { structField, setStructState } from '../src/editors/extensions/structure/adapter/stateField.ts';
import { pathsFromCursorSet } from '../src/editors/extensions/structure/adapter/cursorPath.ts';

// ── Action mapping ──────────────────────────────────────────────────────────
//
// Every entry maps a YAML action name to a dispatcher action string. Actions
// the new core does not (yet) implement are recorded as "legacy" — they are
// intentional gaps and the corresponding tests will fail until either:
//   (a) a new dispatcher action lands (e.g. nav.left/right are in flight),
//   (b) the new core grows the corresponding mutator, or
//   (c) the legacy DSL is dropped from the YAML (cut/paste/type/insert have
//       no equivalent in the radial-menu UX).

/** Actions with a working 1:1 dispatcher equivalent. */
const ACTION_MAP = {
  // sibling navigation (§5.1.3, §5.1.4)
  'next': 'nav.next',
  'previous': 'nav.prev',
  'prev': 'nav.prev',
  'first': 'nav.first',
  'last': 'nav.last',

  // structural level (§5.1.1, §5.1.2) — names follow spec's in/out
  'in': 'nav.in',
  'out': 'nav.out',

  // horizontal spatial (§5.1.9) — Euler-tour, may be in flight in another
  // subagent. If the dispatcher doesn't know these yet, dispatchAction()
  // returns false and the test fails with no state change.
  'right': 'nav.right',
  'left': 'nav.left',

  // vertical spatial (§5.1.10) — pending implementation. Same treatment.
  'up': 'nav.up',
  'down': 'nav.down',

  // range cursor (§5.1.5, §5.1.6)
  'extendNext': 'nav.extendNext',
  'extendPrev': 'nav.extendPrev',
  'shrink': 'nav.shrink',

  // hole stepping (§5.1.8)
  'nextHole': 'nav.nextHole',
  'prevHole': 'nav.prevHole',
  'previousHole': 'nav.prevHole',

  // mutators
  'slurp_right': 'edit.slurpForward',
  'slurp_left': 'edit.slurpBackward',
  'barf_right': 'edit.barfForward',
  'barf_left': 'edit.barfBackward',
};

/**
 * Actions with no dispatcher equivalent. Tests using these will fail; the
 * KNOWN_FAILURES list in structural-yaml.test.mjs explains why each fails.
 *
 * Categorisation:
 *   (a) needs a new dispatcher action (e.g. nav.intoMeta — exists in spec
 *       §5.1.7 but dispatcher doesn't expose it yet)
 *   (b) needs a new core mutator (e.g. delete/cut/paste/duplicate — would
 *       require a clipboard concept and a `remove` op in core/mutate.ts)
 *   (c) legacy DSL doesn't map to the new model (insert+symbol+apply* — the
 *       new UX uses radial-menu pickers; type:"x" — there is no character-
 *       level typing in structural mode; right_char — explicit caret-level
 *       motion isn't part of the structural vocabulary)
 */
const LEGACY_ACTIONS = new Set([
  'delete',
  'cut',
  'paste',
  'paste_before',
  'duplicate',
  'move_next',
  'move_previous',
  'move_right',
  'move_left',
  'move_up',
  'move_down',
  'right_char',
  'intoMeta',
]);

// Tokens that show up inside compound `actions:` arrays as part of an
// `insert <category> <symbol> <applyType>` legacy construct. We swallow them
// without warning so the harness output stays useful.
const LEGACY_COMPOUND_TOKENS = new Set([
  'insert',
  'maths',
  'apply',
  'apply_pre',
  'apply_call',
  'apply_call_pre',
  'apply_wrap',
  'type',
  'let',
  'navigate_to_hole',
  'navigate_to_binding',
  'navigate_to_usage',
]);

// ── Guillemet («») parsing ──────────────────────────────────────────────────

const GUIIL_OPEN = '«';
const GUIIL_CLOSE = '»';

function parseGuillemets(raw) {
  if (typeof raw !== 'string') return null;
  const openIdx = raw.indexOf(GUIIL_OPEN);
  if (openIdx === -1) return null;
  const closeIdx = raw.indexOf(GUIIL_CLOSE, openIdx);
  if (closeIdx === -1) return null;
  return {
    code: raw.slice(0, openIdx) + raw.slice(openIdx + 1, closeIdx) + raw.slice(closeIdx + 1),
    selectionText: raw.slice(openIdx + 1, closeIdx),
    selectionStart: openIdx,
  };
}

// ── Legacy helpers (kept for editing_tests.yaml) ────────────────────────────

function parseCaretString(value) {
  if (typeof value !== 'string') {
    return { text: value, caretOffset: null };
  }
  const index = value.indexOf('^');
  if (index === -1) {
    return { text: value, caretOffset: null };
  }
  return {
    text: value.slice(0, index) + value.slice(index + 1),
    caretOffset: index
  };
}

function normalizeSelectionSpec(value) {
  if (value == null) return null;
  if (Array.isArray(value)) {
    const [text, occurrence] = value;
    const normalizedOccurrence = Number.isInteger(occurrence) && occurrence > 0 ? occurrence : 1;
    if (typeof text !== 'string') return null;
    const parsed = parseCaretString(text);
    return { text: parsed.text, occurrence: normalizedOccurrence, caretOffset: parsed.caretOffset };
  }
  if (typeof value === 'string') {
    const parsed = parseCaretString(value);
    return { text: parsed.text, occurrence: 1, caretOffset: parsed.caretOffset };
  }
  return null;
}

function parseStepSelection(value) {
  if (value === undefined) return null;
  if (value === null) return { text: '', caretOffset: null };
  return parseCaretString(value);
}

function findNthOccurrence(haystack, needle, occurrence) {
  if (!haystack || !needle) return -1;
  const desired = Number.isInteger(occurrence) && occurrence > 0 ? occurrence : 1;
  let start = 0;
  let count = 0;
  while (count < desired) {
    const index = haystack.indexOf(needle, start);
    if (index === -1) return -1;
    count++;
    if (count === desired) {
      return index;
    }
    start = index + needle.length;
  }
  return -1;
}

// ── EditorView setup ────────────────────────────────────────────────────────

/**
 * Build a fresh headless EditorView with the new structural-core extensions
 * mounted on top of clojure-mode. jsdom is provided by test/setup.mjs.
 */
function createView(doc) {
  return new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      // Only the state field is required — decorations are visual-only.
      extensions: [...default_extensions, structField],
    }),
  });
}

// ── Selection seeding & extraction ──────────────────────────────────────────

/**
 * Find the addressable core node whose source range exactly matches [from, to].
 *
 * The document root ALSO has a range (0..docLength), so when the desired
 * region is the entire doc, it can collide with a top-level form's range.
 * We prefer non-document nodes when ranges tie (a guillemet selection on
 * the only top-level form should land on the form, not the doc root).
 *
 * The tree-walk is the authoritative iteration order — we descend depth-first
 * and return the smallest exact match, skipping the document root.
 */
function findNodeIdByRange(value, from, to) {
  const tree = value.state.tree;
  let bestId = null;
  let bestSize = Infinity;

  const visit = (node) => {
    const range = value.idIndex.get(node.id);
    if (range && node.kind !== 'document' && range.from === from && range.to === to) {
      const size = range.to - range.from;
      if (size < bestSize) {
        bestSize = size;
        bestId = node.id;
      }
    }
    if (
      node.kind === 'document' || node.kind === 'list' ||
      node.kind === 'vector' || node.kind === 'map' || node.kind === 'set'
    ) {
      for (const child of node.children) visit(child);
    }
  };
  visit(tree.root);

  // Last-resort fallback: the document range itself (e.g. empty doc).
  if (bestId === null) {
    const rootRange = value.idIndex.get(tree.root.id);
    if (rootRange && rootRange.from === from && rootRange.to === to) {
      bestId = tree.root.id;
    }
  }
  return bestId;
}

/**
 * Find the smallest non-document core node whose source range encloses
 * [from, to]. Fallback when no exact match exists (e.g. selecting whitespace-
 * padded text). Prefers the deepest enclosing node.
 */
function findEnclosingNodeId(value, from, to) {
  const tree = value.state.tree;
  let bestId = null;
  let bestSize = Infinity;

  const visit = (node) => {
    const range = value.idIndex.get(node.id);
    if (range && node.kind !== 'document' && range.from <= from && range.to >= to) {
      const size = range.to - range.from;
      if (size < bestSize) {
        bestSize = size;
        bestId = node.id;
      }
    }
    if (
      node.kind === 'document' || node.kind === 'list' ||
      node.kind === 'vector' || node.kind === 'map' || node.kind === 'set'
    ) {
      for (const child of node.children) visit(child);
    }
  };
  visit(tree.root);
  return bestId;
}

/**
 * Place the structural cursor on the node whose source range matches the
 * given [from, to]. Falls back to enclosing node, then to the document root.
 */
function seedCursorAtRange(view, from, to) {
  const value = view.state.field(structField);
  let nodeId = findNodeIdByRange(value, from, to);
  if (nodeId === null) {
    nodeId = findEnclosingNodeId(value, from, to);
  }
  if (nodeId === null) {
    nodeId = value.state.tree.root.id;
  }
  const newCursors = { primary: { kind: 'node', target: nodeId }, secondaries: [] };
  const newState = { tree: value.state.tree, cursors: newCursors };
  view.dispatch({
    effects: setStructState.of({
      state: newState,
      idIndex: value.idIndex,
      cursorPaths: pathsFromCursorSet(newCursors, newState.tree),
    }),
  });
}

/**
 * Extract the textual content of the primary cursor's "focused" end.
 *
 * For a node cursor: the node's source range.
 *
 * For a range cursor: the anchor end's range. The YAML tests treat range
 * cursors as still "focused" on their anchor (e.g. `extendNext` from `«a»`
 * extends to `[a, b]` but `expected: "a"` because the focus stays on `a`).
 * This matches the core's `focusedId` helper used by navigation ops.
 */
function getSelectedText(view) {
  const value = view.state.field(structField);
  const cursor = value.state.cursors.primary;
  const docText = view.state.doc.toString();
  if (cursor.kind === 'node') {
    const range = value.idIndex.get(cursor.target);
    if (!range) return '';
    return docText.slice(range.from, range.to);
  }
  // Range cursor: read the anchor end's range, mirroring core/nav.ts
  // `focusedId(c)` semantics.
  const focusedId = cursor.anchor === 'start' ? cursor.start : cursor.end;
  const range = value.idIndex.get(focusedId);
  if (!range) return '';
  return docText.slice(range.from, range.to);
}

/** Doc offset of the start of the primary cursor's focused end. */
function getSelectionStart(view) {
  const value = view.state.field(structField);
  const cursor = value.state.cursors.primary;
  const focusedId = cursor.kind === 'node'
    ? cursor.target
    : (cursor.anchor === 'start' ? cursor.start : cursor.end);
  const range = value.idIndex.get(focusedId);
  return range ? range.from : 0;
}

// ── Action application ──────────────────────────────────────────────────────

/**
 * Apply a single YAML action to the view. Returns nothing — the view mutates
 * in place via dispatcher → applyOp → CodeMirror transactions.
 *
 * Compound actions (arrays) are flattened into a sequence of dispatches.
 * Legacy compound constructs `[insert, <cat>, <sym>, <applyType>]` and
 * `[type, <text>]` are skipped silently — see LEGACY_COMPOUND_TOKENS above.
 */
function applyAction(view, action) {
  if (Array.isArray(action)) {
    for (let i = 0; i < action.length; i++) {
      const cur = action[i];

      // Legacy `insert <category> <symbol> <applyType>`: skip 3 tokens.
      if (cur === 'insert' && i + 3 < action.length) {
        i += 3;
        continue;
      }
      // Legacy `type "..."`: skip 1 token.
      if (cur === 'type' && i + 1 < action.length) {
        i += 1;
        continue;
      }

      applyAction(view, cur);
    }
    return;
  }

  if (typeof action !== 'string') return;

  // Skip the prefixed type form `type:"..."` (legacy).
  if (action.startsWith('type:')) return;

  // Mapped action — translate and dispatch.
  const dispatcherAction = ACTION_MAP[action];
  if (dispatcherAction) {
    dispatchAction(view, dispatcherAction);
    return;
  }

  // Known legacy actions: silently skip; tests using them are expected to
  // appear in KNOWN_FAILURES (or to be marked unimplemented).
  if (LEGACY_ACTIONS.has(action) || LEGACY_COMPOUND_TOKENS.has(action)) {
    return;
  }

  // Unrecognised pattern (literal symbol arguments to `insert`, e.g. "+")
  // — treat as data, not as an op. Match the legacy harness's tolerance.
  if (action.match(/^[+\-*/=<>!&|0-9xy[\]_()]+$/)) {
    return;
  }

  // Anything else is genuinely unknown.
  console.warn(`[testHarness] unknown YAML action: ${action}`);
}

// ── Test runner ─────────────────────────────────────────────────────────────

function runTestCase(testCase) {
  let view = null;
  try {
    // Detect format
    const guil = parseGuillemets(testCase.code);
    const isGuillemetFormat = guil !== null;

    const rawCode = isGuillemetFormat
      ? guil.code
      : (parseCaretString(testCase.code || '')).text;
    view = createView(rawCode);
    const initialCode = view.state.doc.toString();

    // ── Set initial selection ──────────────────────────────────────────
    if (isGuillemetFormat) {
      const selStart = guil.selectionStart;
      const selText = guil.selectionText;
      if (selText.length > 0) {
        seedCursorAtRange(view, selStart, selStart + selText.length);
        const actual = getSelectedText(view);
        if (actual !== selText) {
          return {
            passed: false,
            name: testCase.name,
            error: `Guillemet selection failed: expected "${selText}", got "${actual}"`,
            expected: selText,
            actual,
          };
        }
      }
    } else {
      // Legacy: separate selection field.
      const selectionSpec = normalizeSelectionSpec(testCase.selection);
      if (selectionSpec) {
        const selectionStart = findNthOccurrence(initialCode, selectionSpec.text, selectionSpec.occurrence);
        if (selectionStart === -1) {
          return {
            passed: false,
            name: testCase.name,
            error: `Could not find occurrence ${selectionSpec.occurrence} of "${selectionSpec.text}" in initial code`,
            expected: selectionSpec.text,
            actual: initialCode,
          };
        }
        seedCursorAtRange(view, selectionStart, selectionStart + selectionSpec.text.length);

        const selectedText = getSelectedText(view);
        if (selectedText !== selectionSpec.text) {
          return {
            passed: false,
            name: testCase.name,
            error: `Failed to select "${selectionSpec.text}". Got "${selectedText}" instead.`,
            expected: selectionSpec.text,
            actual: selectedText,
          };
        }
      }
    }

    // ── Apply actions ──────────────────────────────────────────────────
    if (testCase.steps) {
      for (let i = 0; i < testCase.steps.length; i++) {
        const step = testCase.steps[i];
        applyAction(view, step.action);

        const stepSelectionSpec = parseStepSelection(step.new_selection);
        if (stepSelectionSpec) {
          const currentSelection = getSelectedText(view);
          const expectedSelection = stepSelectionSpec.text ?? '';
          if (currentSelection !== expectedSelection) {
            return {
              passed: false,
              name: `${testCase.name} (step ${i + 1})`,
              error: `Selection mismatch after action '${step.action}'`,
              expected: expectedSelection,
              actual: currentSelection,
            };
          }
        }
      }
    } else if (testCase.actions) {
      applyAction(view, testCase.actions);
    }

    // ── Check final code (legacy only) ─────────────────────────────────
    const finalCode = view.state.doc.toString();
    const expectedCode = testCase.new_code;
    if (expectedCode !== undefined && finalCode !== expectedCode) {
      return {
        passed: false,
        name: testCase.name,
        error: `Code mismatch after actions`,
        expected: expectedCode,
        actual: finalCode,
        initialCode: testCase.code,
        actions: testCase.actions,
      };
    }

    // ── Check final selection ──────────────────────────────────────────
    const expectedText = isGuillemetFormat ? testCase.expected : null;
    const legacySpec = isGuillemetFormat ? null : normalizeSelectionSpec(testCase.new_selection);

    if (expectedText !== undefined && expectedText !== null) {
      const finalSelection = getSelectedText(view);
      if (finalSelection !== expectedText) {
        return {
          passed: false,
          name: testCase.name,
          error: `Selection mismatch after actions`,
          expected: expectedText,
          actual: finalSelection,
          finalCode,
        };
      }
    } else if (legacySpec) {
      const finalSelection = getSelectedText(view);
      if (finalSelection !== legacySpec.text) {
        return {
          passed: false,
          name: testCase.name,
          error: `Selection mismatch after actions`,
          expected: legacySpec.text,
          actual: finalSelection,
          finalCode,
        };
      }

      const expectedFinalStart = findNthOccurrence(finalCode, legacySpec.text, legacySpec.occurrence);
      if (expectedFinalStart === -1) {
        return {
          passed: false,
          name: testCase.name,
          error: `Could not find occurrence ${legacySpec.occurrence} of "${legacySpec.text}" in final code`,
          expected: legacySpec.text,
          actual: finalCode,
        };
      }

      const actualFinalStart = getSelectionStart(view);
      if (actualFinalStart !== expectedFinalStart) {
        return {
          passed: false,
          name: testCase.name,
          error: `Final selection occurrence mismatch for "${legacySpec.text}"`,
          expected: expectedFinalStart,
          actual: actualFinalStart,
        };
      }
    }

    return { passed: true, name: testCase.name };
  } catch (error) {
    return {
      passed: false,
      name: testCase.name,
      error: `Exception: ${error.message}`,
      stack: error.stack,
    };
  } finally {
    if (view) {
      try { view.destroy(); } catch { /* ignore */ }
    }
  }
}

/** Load and parse a YAML test file. */
function loadTestFile(filePath) {
  try {
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const testCases = yaml.load(fileContent);
    return Array.isArray(testCases) ? testCases : [];
  } catch (error) {
    console.error(`Error loading test file ${filePath}:`, error.message);
    return [];
  }
}

/** Run all tests from a file. */
function runTestFile(filePath) {
  console.log(`\n=== Running tests from ${filePath} ===`);

  const testCases = loadTestFile(filePath);
  if (testCases.length === 0) {
    console.log('No test cases found');
    return { passed: 0, failed: 0, total: 0 };
  }

  let passed = 0;
  let failed = 0;
  const failures = [];

  for (const testCase of testCases) {
    if (!testCase.name) {
      console.log('Skipping test case without name');
      continue;
    }

    const result = runTestCase(testCase);

    if (result.passed) {
      console.log(`✓ ${result.name}`);
      passed++;
    } else {
      console.log(`✗ ${result.name}`);
      console.log(`  Error: ${result.error}`);
      if (result.expected !== undefined) {
        console.log(`  Expected: "${result.expected}"`);
        console.log(`  Actual:   "${result.actual}"`);
      }
      if (result.stack) {
        console.log(`  Stack: ${result.stack}`);
      }
      failures.push(result);
      failed++;
    }
  }

  const total = passed + failed;
  console.log(`\nResults: ${passed}/${total} passed, ${failed} failed`);

  return { passed, failed, total, failures };
}

/** Main test runner. */
function runAllTests() {
  console.log('Structural Editing Extensions Test Harness (new core)');
  console.log('======================================================');

  const testFiles = [
    './test/new_structural/navigation_tests.yaml',
    './test/new_structural/editing_tests.yaml',
  ];

  let totalPassed = 0;
  let totalFailed = 0;
  let totalTests = 0;
  const allFailures = [];

  for (const testFile of testFiles) {
    const results = runTestFile(testFile);
    totalPassed += results.passed;
    totalFailed += results.failed;
    totalTests += results.total;
    allFailures.push(...(results.failures || []));
  }

  console.log('\n======================================================');
  console.log('FINAL RESULTS');
  console.log('======================================================');
  console.log(`Total tests: ${totalTests}`);
  console.log(`Passed: ${totalPassed}`);
  console.log(`Failed: ${totalFailed}`);
  console.log(`Success rate: ${totalTests > 0 ? Math.round((totalPassed / totalTests) * 100) : 0}%`);

  if (allFailures.length > 0) {
    console.log('\n=== FAILURE SUMMARY ===');
    for (const failure of allFailures) {
      console.log(`- ${failure.name}: ${failure.error}`);
    }
  }

  return totalFailed === 0;
}

// Run tests if this module is executed directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  const success = runAllTests();
  process.exit(success ? 0 : 1);
}

export { runAllTests, runTestFile, runTestCase, loadTestFile };
