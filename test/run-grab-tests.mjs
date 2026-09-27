#!/usr/bin/env node
// Standalone entry to the same production-path YAML harness used by Mocha.
import './setup.mjs';
import './helpers/register-css-loader.mjs';
import { fileURLToPath } from 'node:url';
const { runTestFile } = await import('./testHarness.mjs');
const result = runTestFile(fileURLToPath(new URL('./new_structural/grab_mode_tests.yaml', import.meta.url)));
process.exit(result.failed ? 1 : 0);
