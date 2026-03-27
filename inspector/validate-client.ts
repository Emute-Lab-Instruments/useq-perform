/**
 * Client-side scenario validator — runs in the browser via Vite dev server.
 * Imports every scenario module AND attempts to render it, catching both
 * import-chain failures and runtime rendering errors.
 * Results are exposed on window.__validationReport for Playwright to read.
 */

import { render as solidRender } from 'solid-js/web';
import { createInspectorEditor } from './framework/editor';

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

/**
 * Try to render a scenario, catching runtime errors that only
 * manifest when the extensions/components actually initialize.
 */
async function tryRender(
  definition: any,
): Promise<string | null> {
  const container = document.createElement('div');
  container.style.cssText =
    'position:absolute;left:-9999px;top:-9999px;width:800px;height:600px;overflow:hidden';
  document.body.appendChild(container);

  try {
    // Apply CSS variable overrides
    if (definition.cssVariables) {
      for (const [prop, value] of Object.entries(definition.cssVariables)) {
        document.documentElement.style.setProperty(prop, value as string);
      }
    }

    if (definition.component) {
      if (definition.component.loadAppStyles) {
        await import('@src/ui/styles/index.css');
      }

      if (definition.component.render) {
        solidRender(() => definition.component.render(), container);
      } else if (definition.component.component) {
        const el = definition.component.component();
        if (el instanceof HTMLElement) container.appendChild(el);
      }
    } else if (definition.editor) {
      if (definition.editor.loadAppStyles) {
        await import('@src/ui/styles/index.css');
      }

      await createInspectorEditor(container, definition.editor, {
        theme: (definition.settings?.['editor.theme'] as string) ?? undefined,
        fontSize: (definition.settings?.['editor.fontSize'] as number) ?? undefined,
        readOnly: true,
      });
    }

    return null; // success
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  } finally {
    // Clean up: remove the off-screen container
    container.remove();
  }
}

async function validateAll(): Promise<ValidationReport> {
  const entries = Object.entries(scenarioModules);
  const results: ScenarioResult[] = [];

  for (const [modulePath, loader] of entries) {
    const id = modulePathToId(modulePath);
    try {
      // Phase 1: import the module
      const mod = await (loader as () => Promise<{ default: any }>)();
      const def = mod.default;
      if (!def || !def.name || !def.category) {
        results.push({
          id,
          status: 'error',
          error: 'Missing default export or required fields (name, category)',
        });
        continue;
      }

      // Phase 2: try to render it
      const renderError = await tryRender(def);
      if (renderError) {
        results.push({
          id,
          status: 'error',
          error: `Render failed: ${renderError}`,
          name: def.name,
          category: def.category,
          type: def.type,
          sourceFiles: def.sourceFiles,
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
