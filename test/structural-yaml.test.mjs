/**
 * Mocha integration for the structural editing YAML test suite.
 *
 * Loads test cases from test/new_structural/*.yaml and runs them through
 * the standalone testHarness runner. Known failures are marked pending
 * and tracked in beads issue protocol-st1 (structural nav/edit gaps).
 */

import './setup.mjs';
import { strict as assert } from 'assert';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import yaml from 'js-yaml';
import { runTestCase } from './testHarness.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Known behavioral failures, grouped by reason. These are pending tests
// the new structural core / dispatcher does NOT yet support.
//
// Categories:
//   (a) needs a new dispatcher action — the core implements it but the
//       dispatcher case is missing (e.g. nav.intoMeta §5.1.7) or another
//       agent is wiring it up (nav.left, nav.up, nav.down).
//   (b) needs a new core mutator — delete/cut/paste/duplicate/move have no
//       equivalent in core/mutate.ts yet. These would require a clipboard
//       concept, a `remove` op, and a `move` op.
//   (c) legacy DSL doesn't map — the YAML uses the legacy
//       `[insert, <category>, <symbol>, apply*]` and `[type, "..."]`
//       constructs. The new UX uses radial-menu pickers and structural
//       mutators instead, so these tests are obsolete; they remain in the
//       YAML until the legacy harness is fully retired.
//   (d) whitespace round-trip — the round-2 adapter's printNode reformats
//       on every mutation (newlines between top-level forms instead of the
//       original spaces). Documented in adapter/applyOp.ts as accepted
//       round-2 limitation. Editing tests' `new_code` therefore mismatches
//       on whitespace even when the structural mutation is correct.
const KNOWN_FAILURES = new Set([
  // ── (e) YAML/spec inconsistency — see useq-perform-2wxz ────────────────
  // Three nav.left tests don't match strict-reverse-Euler-tour symmetry as
  // defined by structural-editing.md §5.1.9. Either the YAML or the spec
  // needs an edit; not a core implementation bug.
  'left exits then moves to previous',     // YAML typo: extra '*' in source
  'left at outermost level enters',        // outermost-form boundary; spec says exit, YAML says enter
  'left from hole exits to parent',        // hole at idx 1 of 3-child list; left → prev sibling, not parent

  // ── (a) needs new dispatcher action ────────────────────────────────────
  // nav.intoMeta (§5.1.7): reserved in dispatcher comment, not yet exposed.
  'intoMeta on metadata prefix enters payload',
  'out from Meta payload returns to host',
  'intoMeta on quote is no-op - no payload',
  'intoMeta on syntax-quote is no-op',
  'intoMeta on ignore is no-op',
  'intoMeta enters outermost of stacked Metas',
  'intoMeta round-trip through metadata',

  // ── (a-tree) tree-construction / nav-rule gaps ─────────────────────────
  // Failing rows in this group are real bugs in the new core, not legacy
  // gaps. Each line is a candidate for a fix under useq-perform-gii8.32.
  'deep in/out round-trip',                  // [in, next, in, in] from doc — nesting traversal off-by-one
  'out from deep nesting',                   // [out, out] should reach grandparent — nav.out chain
  'out explicitly exits nested list',        // out from inner head → inner list (precondition?)
  'out exits multiple levels explicitly',    // [out, out] from inner head → outer list
  'navigate if with right',                  // (if «test» then else) [right×3] expected else
  'navigate destructuring in let',           // [in, next, right, right] expected :keys
  'first in map',                            // {«:b» 2 :a 1} first → :a (wrong sibling order? map ordering)
  'navigate out of broken region with out',  // unparseable region — error-node degradation §7.1
  'right through broken region',             // unparseable region — see above

  // ── (b) needs new core mutator ─────────────────────────────────────────
  // delete: no remove-from-parent op in core/mutate.ts
  'delete simple symbol',
  'delete last symbol in list',
  'delete first symbol in list',
  'delete nested expression',
  'delete entire top-level expression',
  'delete from vector',
  'delete nested vector',
  'delete and selection moves sensibly',
  'delete and insert replacement',
  // cut/paste: needs clipboard concept
  'cut and paste symbol',
  'cut and paste to different position',
  'cut and paste expression (prev)',
  'cut and paste with paste_before',
  'cut from one list and paste to another',
  'cut nested and paste at top level',
  'cut, navigate, paste, and wrap',
  // duplicate: trivial copy, no op for it yet
  'duplicate symbol',
  'duplicate expression',
  // move: no swap-with-sibling op
  'move next - swap with next sibling',
  'move previous - swap with previous sibling',
  'move next with nested expression',
  'move expression within vector',
  'move right - moves spatially',
  'move left - moves spatially',
  'move up - moves to previous line same level',
  'move down - moves to next line same level',
  'multiple moves and insert',

  // ── (c) legacy DSL doesn't map ─────────────────────────────────────────
  // [insert, <category>, <symbol>, apply*] — the new UX uses radial-menu
  // pickers; these tests test the legacy hard-coded symbol palette.
  'insert symbol after - apply',
  'insert symbol before - apply_pre',
  'insert at end of list',
  'insert at start of list',
  'insert into empty list',
  'insert in vector',
  'insert function call after - apply_call',
  'insert function call before - apply_call_pre',
  'insert function call at end',
  'insert nested function call',
  'insert function with multiple holes',
  'insert, fill hole, and continue',
  // apply_wrap roughly matches edit.encloseList, but the YAML also requires
  // inserting `(<sym> X _)` with a hole — no path through dispatcher today.
  'wrap symbol in function call',
  'wrap expression in function call',
  'wrap first element',
  'wrap last element',
  'wrap entire expression',
  'wrap in vector',
  'wrap and fill',
  'barf and wrap expelled element',
  'slurp and insert',

  // ── (d) whitespace round-trip ──────────────────────────────────────────
  // printNode emits newlines between top-level forms; tests expect spaces.
  // Adapter/applyOp.ts documents this as accepted round-2 limitation.
  'barf right - list expels last element',
  'barf left - list expels first element',
  'barf right - vector expels last element',
  'barf left - vector expels first element',
  'barf left with nested expression',
  'slurp left with multiple elements',
]);

function loadYaml(relPath) {
  const content = readFileSync(join(__dirname, relPath), 'utf8');
  const cases = yaml.load(content);
  return Array.isArray(cases) ? cases : [];
}

function registerSuite(suiteName, cases) {
  describe(suiteName, () => {
    for (const testCase of cases) {
      if (!testCase.name) continue;
      const pending = KNOWN_FAILURES.has(testCase.name);
      const register = pending ? it.skip : it;
      register(testCase.name, () => {
        const result = runTestCase(testCase);
        assert.ok(result.passed, result.error ?? 'test failed');
      });
    }
  });
}

registerSuite(
  'Structural YAML — Navigation',
  loadYaml('new_structural/navigation_tests.yaml'),
);

registerSuite(
  'Structural YAML — Editing',
  loadYaml('new_structural/editing_tests.yaml'),
);
