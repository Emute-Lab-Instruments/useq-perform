import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, lineNumbers, drawSelection } from '@codemirror/view';
import { history } from '@codemirror/commands';
import { foldGutter, bracketMatching } from '@codemirror/language';
// @ts-expect-error — @nextjournal/clojure-mode has no type declarations
import { default_extensions as clojureMode } from '@nextjournal/clojure-mode';
import { editorBaseTheme, themes } from '@src/editors/themes';
import type { EditorSetup } from './scenario';

/**
 * Registry of named extensions that scenarios can opt into.
 * Uses dynamic imports to avoid pulling in runtime dependencies at module load.
 */
const extensionRegistry: Record<string, () => Promise<Extension | Extension[]>> = {
  'structure-highlight': async () => {
    const { navigationMetaField } = await import('@src/editors/extensions/structure/ast');
    const { nodeHighlightPlugin } = await import('@src/editors/extensions/structure/decorations');
    return [navigationMetaField, nodeHighlightPlugin];
  },
  'eval-highlight': async () => {
    const { evalHighlightField } = await import('@src/editors/extensions/evalHighlight');
    return evalHighlightField;
  },
  'diagnostics': async () => {
    const { diagnosticField } = await import('@src/editors/extensions/diagnostics');
    return diagnosticField;
  },
  'gutter': async () => {
    const { lastEvaluatedExpressionField, createExpressionGutter } =
      await import('@src/editors/extensions/structure/eval-integration');
    return [
      lastEvaluatedExpressionField,
      ...createExpressionGutter({
        isGutterEnabled: () => true,
        isClearButtonEnabled: () => false,
        isLastTrackingEnabled: () => true,
        getExpressionColor: () => '#00ff41',
        isVisualised: () => false,
        reportColor: () => {},
        onPlayExpression: () => {},
        onExternalChange: () => () => {},
      }),
    ];
  },
  'inline-results': async () => {
    const { createInlineResultsField } = await import('@src/editors/extensions/inlineResults');
    return createInlineResultsField({
      getMode: () => 'inline' as const,
      getMaxChars: () => 200,
      getShowTimestamp: () => false,
      getAutoDismissMs: () => 0,
    });
  },
};

export interface EditorConfig {
  /** Which theme to use (key from themes object). Defaults to first available. */
  theme?: string;
  /** Font size in pixels. Defaults to 16. */
  fontSize?: number;
  /** Whether the editor is read-only. Defaults to true for scenarios. */
  readOnly?: boolean;
}

/**
 * Create a CodeMirror EditorView for an Inspector scenario.
 *
 * Only loads extensions listed in setup.extensions (by name from the registry).
 * If setup.extensions is omitted, no optional extensions are loaded — just the
 * base editor with syntax highlighting.
 */
export async function createInspectorEditor(
  container: HTMLElement,
  setup: EditorSetup,
  config: EditorConfig = {},
): Promise<EditorView> {
  const {
    theme = 'useq-dark',
    fontSize = 16,
    readOnly = true,
  } = config;

  const selectedTheme = themes[theme] ?? Object.values(themes)[0];

  // Base extensions: theme, syntax, line numbers — always loaded
  const extensions: Extension[] = [
    editorBaseTheme,
    ...selectedTheme,
    EditorView.theme({
      '.cm-content': { fontSize: `${fontSize}px` },
    }),
    lineNumbers(),
    bracketMatching(),
    drawSelection(),
    history(),
    foldGutter(),
    ...clojureMode,
  ];

  // Dynamically load only the requested optional extensions
  if (setup.extensions) {
    for (const name of setup.extensions) {
      const factory = extensionRegistry[name];
      if (factory) {
        const ext = await factory();
        if (Array.isArray(ext)) {
          extensions.push(...ext);
        } else {
          extensions.push(ext);
        }
      }
    }
  }

  if (readOnly) {
    extensions.push(EditorState.readOnly.of(true));
  }

  const state = EditorState.create({
    doc: setup.editorContent,
    extensions,
  });

  const view = new EditorView({
    state,
    parent: container,
  });

  // Set cursor position if specified
  if (setup.cursorPosition !== undefined) {
    const pos = Math.min(setup.cursorPosition, view.state.doc.length);
    view.dispatch({
      selection: { anchor: pos },
    });
    view.focus();
  }

  // --- Push seed data ---

  if (setup.diagnostics?.length) {
    const { pushDiagnostics } = await import('@src/editors/extensions/diagnostics');
    pushDiagnostics(view, setup.diagnostics, 0, 0, view.state.doc.length);
  }

  if (setup.evalHighlight) {
    const { flashEvalHighlight } = await import('@src/editors/extensions/evalHighlight');
    const { from, to, isPreview } = setup.evalHighlight;
    flashEvalHighlight(view, from, to, { isPreview: isPreview ?? false });

    // Periodic re-trigger so the reviewer can see the full animation cycle
    if (setup.evalHighlightIntervalMs && setup.evalHighlightIntervalMs > 0) {
      setInterval(() => {
        flashEvalHighlight(view, from, to, { isPreview: isPreview ?? false });
      }, setup.evalHighlightIntervalMs);
    }
  }

  if (setup.inlineResults?.length) {
    const { showInlineResult } = await import('@src/editors/extensions/inlineResults');
    view.dispatch({
      effects: setup.inlineResults.map(r => showInlineResult.of({
        text: r.text,
        pos: r.pos,
        isError: r.isError,
      })),
    });
  }

  if (setup.evaluatedExpressions?.length) {
    const { expressionEvaluatedAnnotation } = await import(
      '@src/editors/extensions/structure/eval-integration'
    );
    for (const expr of setup.evaluatedExpressions) {
      view.dispatch({
        annotations: expressionEvaluatedAnnotation.of({
          expressionType: expr.expressionType,
          position: expr.position,
        }),
      });
    }
  }

  return view;
}
