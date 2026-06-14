/**
 * Deterministic structural editor fuzzing.
 *
 * The fuzz worker runs in a subprocess so a command-router or focus-resolution
 * tight loop is reported as a timeout instead of freezing the whole Mocha run.
 */

import { strict as assert } from 'assert';
import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workerPath = join(__dirname, 'helpers', 'structural-fuzz-worker.js');
const repoRoot = join(__dirname, '..');
const DEFAULT_SEEDS = ['12648430', '305419896', '3735928559', '4277009102'];

function seedsFromEnv() {
  const raw = process.env.STRUCTURAL_FUZZ_SEEDS;
  if (!raw) return DEFAULT_SEEDS;
  const seeds = raw.split(',').map((seed) => seed.trim()).filter(Boolean);
  return seeds.length > 0 ? seeds : DEFAULT_SEEDS;
}

function runWorker(envOverrides, timeoutMs) {
  return new Promise((resolve, reject) => {
    // The worker imports app source modules (extensionless TS/ESM specifiers
    // like `./runtimeSessionService`). The rest of the mocha suite resolves
    // these via the tsx ESM loader (see .mocharc `node-option: import=tsx/esm`).
    // The worker is a fresh `node` subprocess, so it must load tsx the same way
    // or those imports throw ERR_MODULE_NOT_FOUND before any fuzzing runs.
    const child = spawn(process.execPath, ['--import', 'tsx/esm', workerPath], {
      cwd: repoRoot,
      env: { ...process.env, ...envOverrides },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(
          new Error(
            `structural fuzz worker timed out after ${timeoutMs}ms` +
              `\nstdout:\n${stdout}\nstderr:\n${stderr}`,
          ),
        );
        return;
      }
      resolve({ code, signal, stdout, stderr });
    });
  });
}

describe('Structural fuzz', function () {
  this.timeout(30000);

  for (const seed of seedsFromEnv()) {
    it(`keeps focus, ranges, and selection resolvable across random edits (seed ${seed})`, async () => {
      const result = await runWorker(
        {
          STRUCTURAL_FUZZ_SEED: seed,
          STRUCTURAL_FUZZ_CASES: process.env.STRUCTURAL_FUZZ_CASES ?? '8',
          STRUCTURAL_FUZZ_STEPS: process.env.STRUCTURAL_FUZZ_STEPS ?? '80',
        },
        12000,
      );

      assert.equal(
        result.code,
        0,
        `structural fuzz worker exited with ${result.code ?? result.signal}` +
          `\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
      );
    });
  }
});
