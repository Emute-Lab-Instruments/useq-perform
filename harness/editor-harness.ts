/**
 * Editor harness — creates a CodeMirror editor from declarative setup.
 *
 * This is the imperative API. For Storybook/Inspector, use <ScenarioEditor> instead.
 */
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, lineNumbers, drawSelection } from '@codemirror/view';
import { history } from '@codemirror/commands';
import { foldGutter, bracketMatching } from '@codemirror/language';
// @ts-expect-error — @nextjournal/clojure-mode has no type declarations
import { default_extensions as clojureMode } from '@nextjournal/clojure-mode';
import { editorBaseTheme, themes } from '@src/editors/themes';
import { extensionRegistry } from './extension-registry';
import type { EditorSetup } from './types';

export interface EditorHandle {
  view: EditorView;
  dispose: () => void;
}

/**
 * Create a CodeMirror editor from a declarative EditorSetup.
 *
 * Loads only requested extensions (lazy), then pushes seed data (diagnostics,
 * eval highlights, inline results, gutter markers) post-mount.
 */
export async function createScenarioEditor(
  container: HTMLElement,
  setup: EditorSetup,
): Promise<EditorHandle> {
  const {
    theme = 'useq-dark',
    fontSize = 16,
    readOnly = true,
  } = setup;

  const selectedTheme = themes[theme] ?? Object.values(themes)[0];
  const intervals: ReturnType<typeof setInterval>[] = [];

  const extensions: Extension[] = [
    editorBaseTheme,
    ...selectedTheme,
    EditorView.theme({ '.cm-content': { fontSize: `${fontSize}px` } }),
    lineNumbers(),
    bracketMatching(),
    drawSelection(),
    history(),
    foldGutter(),
    ...clojureMode,
  ];

  // Load requested extensions from registry
  if (setup.extensions) {
    for (const name of setup.extensions) {
      const factory = extensionRegistry[name];
      if (factory) {
        const ext = await factory();
        if (Array.isArray(ext)) extensions.push(...ext);
        else extensions.push(ext);
      }
    }
  }

  if (readOnly) {
    extensions.push(EditorState.readOnly.of(true));
  }

  const state = EditorState.create({ doc: setup.editorContent, extensions });
  const view = new EditorView({ state, parent: container });

  // Cursor
  if (setup.cursorPosition !== undefined) {
    const pos = Math.min(setup.cursorPosition, view.state.doc.length);
    view.dispatch({ selection: { anchor: pos } });
    view.focus();
  }

  // --- Seed data ---

  if (setup.diagnostics?.length) {
    const { pushDiagnostics } = await import('@src/editors/extensions/diagnostics');
    pushDiagnostics(view, setup.diagnostics, 0, 0, view.state.doc.length);
  }

  if (setup.evalHighlight) {
    const { flashEvalHighlight } = await import('@src/editors/extensions/evalHighlight');
    const { from, to, isPreview } = setup.evalHighlight;
    flashEvalHighlight(view, from, to, { isPreview: isPreview ?? false });

    if (setup.evalHighlightIntervalMs && setup.evalHighlightIntervalMs > 0) {
      intervals.push(setInterval(() => {
        flashEvalHighlight(view, from, to, { isPreview: isPreview ?? false });
      }, setup.evalHighlightIntervalMs));
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
      '@src/editors/extensions/structure/eval-state'
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

  return {
    view,
    dispose: () => {
      intervals.forEach(clearInterval);
      view.destroy();
    },
  };
}
