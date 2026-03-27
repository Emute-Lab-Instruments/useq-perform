/**
 * Client-side scenario validator — runs in the browser via Vite dev server.
 * Loads every scenario module and reports pass/fail with error details.
 * Results are exposed on window.__validationResults for Playwright to read.
 */

interface ScenarioResult {
  id: string;
  status: 'ok' | 'error';
  error?: string;
  sourceFiles?: string[];
  name?: string;
  category?: string;
  type?: string;
}

interface ValidationReport {
  total: number;
  passed: number;
  failed: number;
  results: ScenarioResult[];
}

// Vite resolves these at compile time
const scenarioModules = {
  ...import.meta.glob('./scenarios/**/*.ts'),
  ...import.meta.glob('./scenarios/**/*.tsx'),
};

function modulePathToId(modulePath: string): string {
  return modulePath.replace('./scenarios/', '').replace(/\.tsx?$/, '');
}

async function validateAll(): Promise<ValidationReport> {
  const entries = Object.entries(scenarioModules);
  const results: ScenarioResult[] = [];

  for (const [modulePath, loader] of entries) {
    const id = modulePathToId(modulePath);
    try {
      const mod = await (loader as () => Promise<{ default: any }>)();
      const def = mod.default;
      if (!def || !def.name || !def.category) {
        results.push({
          id,
          status: 'error',
          error: 'Missing default export or required fields (name, category)',
        });
      } else {
        results.push({
          id,
          status: 'ok',
          sourceFiles: def.sourceFiles,
          name: def.name,
          category: def.category,
          type: def.type,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ id, status: 'error', error: msg });
    }
  }

  const failures = results.filter((r) => r.status === 'error');
  return {
    total: results.length,
    passed: results.length - failures.length,
    failed: failures.length,
    results,
  };
}

// Run validation and expose results
validateAll().then((report) => {
  (window as any).__validationReport = report;

  // Also render to the page for manual viewing
  const el = document.getElementById('output');
  if (el) {
    el.textContent = JSON.stringify(report, null, 2);
  }
});
