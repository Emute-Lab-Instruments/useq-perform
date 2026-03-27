/**
 * Runtime scenario validator — loads every Inspector scenario in a real
 * Chromium browser to catch import-chain failures, missing exports, and
 * runtime errors that the jsdom test can't detect.
 *
 * Usage:
 *   npm run inspector:validate-runtime          # human-readable
 *   npm run inspector:validate-runtime -- --json # structured JSON for AI agents
 *
 * How it works:
 * 1. Starts the Inspector's Vite dev server on a random port
 * 2. Opens validate.html in headless Chromium (via Playwright)
 * 3. validate-client.ts uses import.meta.glob to load every scenario
 * 4. Results are read from window.__validationReport
 * 5. Outputs structured results to stdout
 */

import { createServer, type ViteDevServer } from 'vite';
import { chromium, type Browser } from 'playwright';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const jsonMode = process.argv.includes('--json');

interface ScenarioResult {
  id: string;
  status: 'ok' | 'error';
  error?: string;
  sourceFiles?: string[];
  name?: string;
  category?: string;
  type?: string;
  summary?: string;
}

interface ValidationReport {
  total: number;
  passed: number;
  failed: number;
  results: ScenarioResult[];
  errors?: ScenarioResult[];
}

/** Extract a one-line summary from an error message */
function summarize(msg: string): string {
  const exportMatch = msg.match(/does not provide an export named '(\w+)'/);
  if (exportMatch) return `Missing export: '${exportMatch[1]}'`;

  const moduleMatch = msg.match(/Cannot find module '([^']+)'/);
  if (moduleMatch) return `Missing module: '${moduleMatch[1]}'`;

  const fnMatch = msg.match(/(\w+) is not a function/);
  if (fnMatch) return `${fnMatch[1]} is not a function`;

  const failedFetch = msg.match(/Failed to fetch dynamically imported module: (.+)/);
  if (failedFetch) return `Failed dynamic import: ${failedFetch[1]}`;

  return msg.split('\n')[0].slice(0, 150);
}

async function main() {
  // 1. Start Vite dev server on random port
  const server: ViteDevServer = await createServer({
    root: resolve(__dirname),
    configFile: resolve(__dirname, 'vite.config.ts'),
    server: { port: 0, strictPort: false },
    logLevel: 'warn',
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to start Vite dev server');
  }
  const baseUrl = `http://localhost:${address.port}`;

  // 2. Launch headless browser
  const browser: Browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    // 3. Navigate to validation page
    await page.goto(`${baseUrl}/validate.html`, { waitUntil: 'networkidle' });

    // 4. Wait for validation to complete (poll window.__validationReport)
    const report: ValidationReport = await page.evaluate(() => {
      return new Promise<ValidationReport>((resolve) => {
        const check = () => {
          const r = (window as any).__validationReport;
          if (r) resolve(r);
          else setTimeout(check, 100);
        };
        check();
      });
    });

    // 5. Post-process: add summaries and extract errors
    const errors: ScenarioResult[] = [];
    for (const r of report.results) {
      if (r.status === 'error' && r.error) {
        r.summary = summarize(r.error);
        errors.push(r);
      }
    }
    report.errors = errors;

    // 6. Output
    if (jsonMode) {
      // Clean output: only errors array (not full results) to keep it concise
      console.log(
        JSON.stringify(
          {
            total: report.total,
            passed: report.passed,
            failed: report.failed,
            errors: report.errors,
          },
          null,
          2,
        ),
      );
    } else {
      if (errors.length === 0) {
        console.log(`\n✓ All ${report.total} scenarios load successfully\n`);
      } else {
        console.log(
          `\n✗ ${errors.length}/${report.total} scenarios failed to load:\n`,
        );
        for (const e of errors) {
          console.log(`  ${e.id}`);
          console.log(`    ${e.summary}`);
          if (e.error && e.error !== e.summary) {
            const lines = e.error.split('\n').slice(0, 3);
            for (const line of lines) {
              console.log(`    ${line.slice(0, 200)}`);
            }
          }
          console.log();
        }
      }
    }

    process.exit(errors.length > 0 ? 1 : 0);
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((err) => {
  console.error('Validator crashed:', err);
  process.exit(2);
});
