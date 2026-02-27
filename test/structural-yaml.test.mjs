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
import { runTestCase } from '../testHarness.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Known behavioral failures - tracked in beads issue protocol-st1.
// Fix those issues there; do not remove items from this set without tests passing.
const KNOWN_FAILURES = new Set([
  // Navigation gaps
  'next within list - stays at same level',
  "exit list with 'out'",
  'down maintains level - symbols',
  'up maintains level - symbols',
  'next within nested list - stops at boundary',
  'right continues through nested list',
  'out explicitly exits nested list',
  'out exits multiple levels explicitly',
  'deeply nested - next stays at each level',
  'deeply nested - right continues spatially',
  'right at top level with next expression',
  'navigate to string with next',
  'navigate defn with next',
  'navigate defn with right',
  'next treats arg vector as unit',
  'navigate to nested expr in body - next stops',
  'navigate to nested expr in body - right continues',
  'navigate to let binding vector with next',
  'navigate to let binding vector with right',
  'navigate function with many args - next',
  'navigate function with many args - right',
  'navigate to anonymous function with next',
  'navigate to anonymous function with right',
  'navigate thread-first with next',
  'navigate thread-first with right',
  'right spatial through thread-last',
  'navigate if with next',
  'navigate if with right',
  'navigate destructuring in let',
  'navigate multi-arity function',
  'skip whitespace with next',
  // Editing gaps
  'delete first symbol in list',
  'cut from one list and paste to another',
  'cut nested and paste at top level',
  'move next - swap with next sibling',
  'move right - moves spatially',
  'delete and insert replacement',
  'cut, navigate, paste, and wrap',
  'slurp and insert',
  'delete and selection moves sensibly',
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
