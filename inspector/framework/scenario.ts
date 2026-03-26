/** Scenario type determines review behavior */
export type ScenarioType = 'canary' | 'contract';

/** What kind of app slice this scenario needs */
export type ScenarioMode = 'editor' | 'component';

/** Editor-specific setup */
export interface EditorSetup {
  /** Code to put in the editor */
  editorContent: string;
  /** Extensions to enable (by name) */
  extensions?: string[];
  /** Cursor position (character offset) */
  cursorPosition?: number;
}

/** Component-specific setup */
export interface ComponentSetup {
  /** The component to render — a function returning a JSX element */
  component: () => any;
  /** Container dimensions */
  width?: number;
  height?: number;
}

/** Settings overrides applied to the scenario */
export type SettingsOverrides = Record<string, unknown>;

/** Complete scenario definition */
export interface ScenarioDefinition {
  /** Display name */
  name: string;
  /** Category path using ' / ' as separator (e.g., 'Editor Decorations / Structure Highlights') */
  category: string;
  /** canary = visual edge case, contract = core behavior */
  type: ScenarioType;
  /** Source files relevant to this scenario (for context copying) */
  sourceFiles: string[];
  /** Optional longer description */
  description?: string;
  /** Settings overrides to apply */
  settings?: SettingsOverrides;
  /** Editor setup (for editor scenarios) */
  editor?: EditorSetup;
  /** Component setup (for component scenarios) */
  component?: ComponentSetup;
}

/** A resolved scenario with its module path */
export interface ResolvedScenario extends ScenarioDefinition {
  /** Auto-generated ID from file path (e.g., 'editor/structure-highlights-nested') */
  id: string;
  /** Original module path */
  modulePath: string;
}

/**
 * Define a scenario. This is the main authoring API.
 *
 * Usage:
 * ```ts
 * export default defineScenario({
 *   category: 'Editor Decorations / Structure Highlights',
 *   name: 'Nested expression highlighting',
 *   type: 'canary',
 *   sourceFiles: ['src/editors/extensions/structure.ts'],
 *   editor: {
 *     editorContent: '(+ (* 2 3) (- 10 (/ 8 4)))',
 *     cursorPosition: 4,
 *   },
 * });
 * ```
 */
export function defineScenario(definition: ScenarioDefinition): ScenarioDefinition {
  return definition;
}
