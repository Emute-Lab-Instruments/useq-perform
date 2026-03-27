/** Scenario type determines review behavior */
export type ScenarioType = 'canary' | 'contract';

/** What kind of app slice this scenario needs */
export type ScenarioMode = 'editor' | 'component';

// ---------------------------------------------------------------------------
// Seed data types — initial state pushed into the editor after creation
// ---------------------------------------------------------------------------

/** A diagnostic to display in the editor */
export interface ScenarioDiagnostic {
  /** Start character offset in the document */
  start: number;
  /** End character offset in the document */
  end: number;
  /** Severity level */
  severity: 'error' | 'warning' | 'info' | 'hint';
  /** Diagnostic message */
  message: string;
  /** Optional suggestion text */
  suggestion?: string;
  /** Optional example text */
  example?: string;
}

/** An eval highlight flash to display */
export interface ScenarioEvalHighlight {
  /** Start character offset */
  from: number;
  /** End character offset */
  to: number;
  /** True for cyan preview flash, false/omit for yellow connected flash */
  isPreview?: boolean;
}

/** An inline result to display after an expression */
export interface ScenarioInlineResult {
  /** The result text to show (e.g., "3", "440.0", "{error}") */
  text: string;
  /** Character offset where the result should appear (end of expression) */
  pos: number;
  /** True to show as error (red styling) */
  isError?: boolean;
}

/** An expression to mark as "last evaluated" in the gutter */
export interface ScenarioEvaluatedExpression {
  /** Expression type (e.g., 'a1', 'd2', 's3') */
  expressionType: string;
  /** Position of the evaluated expression */
  position?: { from: number; to: number; line: number };
}

// ---------------------------------------------------------------------------
// Editor setup
// ---------------------------------------------------------------------------

/** Editor-specific setup */
export interface EditorSetup {
  /** Code to put in the editor */
  editorContent: string;
  /** Extensions to enable (by name) */
  extensions?: string[];
  /** Cursor position (character offset) */
  cursorPosition?: number;

  // --- Seed data (pushed after editor creation) ---

  /** Diagnostics to display (squiggly underlines) */
  diagnostics?: ScenarioDiagnostic[];
  /** Eval highlight flash to trigger */
  evalHighlight?: ScenarioEvalHighlight;
  /** Inline results to display after expressions */
  inlineResults?: ScenarioInlineResult[];
  /** Expressions to mark as "last evaluated" in the gutter */
  evaluatedExpressions?: ScenarioEvaluatedExpression[];
}

/** Component-specific setup */
export interface ComponentSetup {
  /** Legacy: returns a raw DOM element (for placeholder scenarios) */
  component?: () => HTMLElement;
  /** Preferred: returns SolidJS JSX. Use for real component rendering. */
  render?: () => any;
  /** Whether to load the main app's CSS (src/ui/styles/index.css) */
  loadAppStyles?: boolean;
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
  /** Greppable terms for agent context: function names, class names, CSS classes, prop names */
  grepTerms?: string[];
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
