/**
 * Mocha integration for the structural editing YAML test suite.
 *
 * Loads test cases from test/new_structural/*.yaml and runs them through
 * the standalone testHarness runner. All tests run; failures are real.
 */

import './setup.mjs';
import { strict as assert } from 'assert';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import yaml from 'js-yaml';
import { runTestCase } from './testHarness.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadYaml(relPath) {
  const content = readFileSync(join(__dirname, relPath), 'utf8');
  const cases = yaml.load(content);
  return Array.isArray(cases) ? cases : [];
}

function registerSuite(suiteName, cases) {
  describe(suiteName, () => {
    for (const testCase of cases) {
      if (!testCase.name) continue;
      it(testCase.name, () => {
        const result = runTestCase(testCase);
        if (!result.passed) {
          const detail = result.expected !== undefined
            ? `\n  expected: ${JSON.stringify(result.expected)}\n  actual:   ${JSON.stringify(result.actual)}`
            : '';
          assert.fail(`${result.error}${detail}`);
        }
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

registerSuite(
  'Structural YAML — Clipboard',
  loadYaml('new_structural/clipboard_tests.yaml'),
);

registerSuite(
  'Structural YAML — Picker/Insert',
  loadYaml('new_structural/picker_tests.yaml'),
);

registerSuite(
  'Structural YAML — Spatial Move',
  loadYaml('new_structural/spatial_move_tests.yaml'),
);

registerSuite(
  'Structural YAML — Misc (keyboard/typing)',
  loadYaml('new_structural/misc_tests.yaml'),
);

registerSuite(
  'Structural YAML — Halo clearing',
  loadYaml('new_structural/halo_clear_on_whitespace.yaml'),
);
