import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const projectRoot = path.resolve(__dirname, '..');
const scenariosDir = path.resolve(__dirname, 'scenarios');

const VALID_EXTENSIONS = [
  'structure-highlight',
  'eval-highlight',
  'diagnostics',
  'gutter',
  'inline-results',
  'probes',
];

const VALID_SEVERITIES = ['error', 'warning', 'info', 'hint'];

/**
 * Recursively collect all .ts and .tsx scenario files.
 */
function collectScenarioFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectScenarioFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Try to import a scenario module with a timeout. TSX component scenarios
 * may fail or hang in jsdom because they pull in UI components that depend
 * on browser/runtime globals.
 */
async function tryImport(absPath: string): Promise<{ mod: any; error: string | null }> {
  try {
    const result = await Promise.race([
      import(absPath),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Import timed out (5s)')), 5000),
      ),
    ]);
    return { mod: result, error: null };
  } catch (e) {
    return { mod: null, error: (e as Error).message };
  }
}

const scenarioFiles = collectScenarioFiles(scenariosDir);

describe('Inspector scenarios', () => {
  it('discovers at least one scenario file', () => {
    expect(scenarioFiles.length).toBeGreaterThan(0);
  });

  describe.each(scenarioFiles.map((f) => [path.relative(scenariosDir, f), f]))(
    '%s',
    (_relPath, absPath) => {
      const isTsx = absPath.endsWith('.tsx');
      let imported: { mod: any; error: string | null } | null = null;

      async function getImport() {
        if (isTsx) return { mod: null, error: 'TSX skipped in jsdom' };
        if (!imported) imported = await tryImport(absPath);
        return imported;
      }

      it('loads without error', async () => {
        if (isTsx) {
          // TSX component scenarios import real SolidJS components via @src
          // aliases that only resolve in Vite. Skip in jsdom test runner.
          return;
        }
        const { mod, error } = await getImport();
        if (error) throw new Error(error);
        expect(mod.default).toBeDefined();
      });

      it('has required top-level fields', async () => {
        if (isTsx) return; // TSX scenarios can't be imported in jsdom
        const { mod } = await getImport();
        if (isTsx || !mod) return;
        const s = mod.default;

        expect(s).toHaveProperty('name');
        expect(typeof s.name).toBe('string');
        expect(s.name.length).toBeGreaterThan(0);

        expect(s).toHaveProperty('category');
        expect(typeof s.category).toBe('string');
        expect(s.category.length).toBeGreaterThan(0);

        expect(s).toHaveProperty('type');
        expect(['canary', 'contract']).toContain(s.type);

        expect(s).toHaveProperty('sourceFiles');
        expect(Array.isArray(s.sourceFiles)).toBe(true);
        for (const sf of s.sourceFiles) {
          expect(typeof sf).toBe('string');
        }
      });

      it('has at least one of editor or component', async () => {
        const { mod } = await getImport();
        if (isTsx || !mod) return;
        const s = mod.default;
        expect(
          s.editor !== undefined || s.component !== undefined,
          'scenario must define at least one of editor or component',
        ).toBe(true);
      });

      it('editor setup is valid (if present)', async () => {
        const { mod } = await getImport();
        if (isTsx || !mod) return;
        const s = mod.default;
        if (!s.editor) return;

        const e = s.editor;

        // editorContent must be a non-empty string
        expect(typeof e.editorContent).toBe('string');
        expect(e.editorContent.length).toBeGreaterThan(0);

        // cursorPosition
        if (e.cursorPosition !== undefined) {
          expect(typeof e.cursorPosition).toBe('number');
          expect(e.cursorPosition).toBeLessThanOrEqual(e.editorContent.length);
        }

        // extensions
        if (e.extensions !== undefined) {
          expect(Array.isArray(e.extensions)).toBe(true);
          for (const ext of e.extensions) {
            expect(VALID_EXTENSIONS).toContain(ext);
          }
        }

        // diagnostics
        if (e.diagnostics !== undefined) {
          expect(Array.isArray(e.diagnostics)).toBe(true);
          for (const d of e.diagnostics) {
            expect(d.start).toBeGreaterThanOrEqual(0);
            expect(d.end).toBeGreaterThan(d.start);
            expect(VALID_SEVERITIES).toContain(d.severity);
          }
        }

        // evalHighlight
        if (e.evalHighlight !== undefined) {
          expect(e.evalHighlight.from).toBeGreaterThanOrEqual(0);
          expect(e.evalHighlight.to).toBeGreaterThan(e.evalHighlight.from);
        }

        // inlineResults
        if (e.inlineResults !== undefined) {
          expect(Array.isArray(e.inlineResults)).toBe(true);
          for (const r of e.inlineResults) {
            expect(r.pos).toBeGreaterThanOrEqual(0);
            expect(typeof r.text).toBe('string');
            expect(r.text.length).toBeGreaterThan(0);
          }
        }
      });

      it('component setup is valid (if present)', async () => {
        const { mod } = await getImport();
        if (isTsx || !mod) return;
        const s = mod.default;
        if (!s.component) return;

        const c = s.component;
        const hasRender = typeof c.render === 'function';
        const hasComponent = typeof c.component === 'function';
        expect(hasRender || hasComponent).toBe(true);
      });

      it('sourceFiles paths exist on disk', async () => {
        const { mod } = await getImport();
        if (isTsx || !mod) return;
        const s = mod.default;
        for (const sf of s.sourceFiles) {
          const resolved = path.resolve(projectRoot, sf);
          expect(
            fs.existsSync(resolved),
            `sourceFile "${sf}" does not exist at ${resolved}`,
          ).toBe(true);
        }
      });
    },
  );
});
