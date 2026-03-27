import type { ScenarioDefinition, ResolvedScenario } from './scenario';

/** Nav tree node — either a category (branch) or a scenario (leaf) */
export interface NavTreeNode {
  label: string;
  /** Full category path for branches, scenario ID for leaves */
  id: string;
  children?: NavTreeNode[];
  scenario?: ResolvedScenario;
}

// Auto-discover all scenario files (.ts and .tsx) using Vite's glob import
const scenarioModules = {
  ...import.meta.glob('../scenarios/**/*.ts'),
  ...import.meta.glob('../scenarios/**/*.tsx'),
};

/**
 * Derive a scenario ID from its module path.
 * '../scenarios/editor/structure-highlights-nested.ts' → 'editor/structure-highlights-nested'
 */
function modulePathToId(modulePath: string): string {
  return modulePath
    .replace('../scenarios/', '')
    .replace(/\.tsx?$/, '');
}

/**
 * Load all scenarios and build the registry.
 * Returns resolved scenarios with IDs and module paths.
 */
export async function loadScenarios(): Promise<ResolvedScenario[]> {
  const entries = Object.entries(scenarioModules);
  const scenarios: ResolvedScenario[] = [];

  for (const [modulePath, loader] of entries) {
    try {
      const mod = await (loader as () => Promise<{ default: ScenarioDefinition }>)();
      const definition = mod.default;
      if (definition && definition.name && definition.category) {
        scenarios.push({
          ...definition,
          id: modulePathToId(modulePath),
          modulePath,
        });
      }
    } catch (err) {
      // Scenario failed to load — likely a transitive import crash in the iframe.
      // Extract an ID so it still appears in the nav tree as broken.
      const id = modulePathToId(modulePath);
      console.warn(`[Inspector] Failed to load scenario ${id}:`, (err as Error).message);
      scenarios.push({
        name: `⚠ ${id.split('/').pop() ?? id}`,
        category: id.includes('/') ? id.split('/').slice(0, -1).join(' / ') : 'Broken',
        type: 'canary',
        sourceFiles: [],
        description: `Failed to load: ${(err as Error).message}`,
        id,
        modulePath,
      });
    }
  }

  return scenarios;
}

/**
 * Build a nav tree from resolved scenarios.
 * Categories are split on ' / ' separator.
 */
export function buildNavTree(scenarios: ResolvedScenario[]): NavTreeNode[] {
  const root: NavTreeNode[] = [];

  for (const scenario of scenarios) {
    const parts = scenario.category.split(' / ');
    let currentLevel = root;

    // Walk/create category branches
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      let existing = currentLevel.find(
        (node) => node.label === part && node.children !== undefined
      );
      if (!existing) {
        existing = {
          label: part,
          id: parts.slice(0, i + 1).join('/'),
          children: [],
        };
        currentLevel.push(existing);
      }
      currentLevel = existing.children!;
    }

    // Add scenario as leaf node
    currentLevel.push({
      label: scenario.name,
      id: scenario.id,
      scenario,
    });
  }

  return root;
}

/** Flat list of all scenario IDs */
export function getAllScenarioIds(scenarios: ResolvedScenario[]): string[] {
  return scenarios.map((s) => s.id);
}
