// Shared types for scenario harness — used by both Storybook stories and Inspector

import type { LiveEditSlot, VectorMarkSession } from '@src/contracts/liveEdit';
import type { BindingChip } from '@src/contracts/hardware';

// ---------------------------------------------------------------------------
// Seed data types — state pushed into the editor after creation
// ---------------------------------------------------------------------------

/** A diagnostic to display in the editor */
export interface ScenarioDiagnostic {
  start: number;
  end: number;
  severity: 'error' | 'warning' | 'info' | 'hint';
  message: string;
  suggestion?: string;
  example?: string;
}

/** An eval highlight flash to display */
export interface ScenarioEvalHighlight {
  from: number;
  to: number;
  isPreview?: boolean;
}

/** An inline result to display after an expression */
export interface ScenarioInlineResult {
  text: string;
  pos: number;
  isError?: boolean;
}

/** An expression to mark as "last evaluated" in the gutter */
export interface ScenarioEvaluatedExpression {
  expressionType: string;
  position?: { from: number; to: number; line: number };
}

/** A probe to attach to an expression range */
export interface ScenarioProbe {
  /** Start of the expression to probe */
  from: number;
  /** End of the expression to probe */
  to: number;
  /** Probe mode: 'raw' = waveform, 'contextual' = with temporal context */
  mode?: 'raw' | 'contextual';
}

// ---------------------------------------------------------------------------
// Editor setup — declarative description of a CodeMirror editor state
// ---------------------------------------------------------------------------

export interface EditorSetup {
  editorContent: string;
  extensions?: string[];
  cursorPosition?: number;
  loadAppStyles?: boolean;

  // Seed data
  diagnostics?: ScenarioDiagnostic[];
  evalHighlight?: ScenarioEvalHighlight;
  evalHighlightIntervalMs?: number;
  inlineResults?: ScenarioInlineResult[];
  evaluatedExpressions?: ScenarioEvaluatedExpression[];
  /** Probes to attach to expression ranges */
  probes?: ScenarioProbe[];
  /** Live-edit slots to render as inline widgets (gii8.39). */
  liveEditSlots?: LiveEditSlot[];
  /** Vector-mark sub-mode session to render as underlines (gii8.38). */
  vectorMarkSession?: VectorMarkSession;
  /** Hardware-binding chips to render inline for each wrapper (gii8.56). */
  bindingChips?: BindingChip[];

  // Editor config
  theme?: string;
  fontSize?: number;
  readOnly?: boolean;
}
