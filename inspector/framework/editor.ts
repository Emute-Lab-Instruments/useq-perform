import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, lineNumbers, drawSelection } from '@codemirror/view';
import { history } from '@codemirror/commands';
import { foldGutter, bracketMatching } from '@codemirror/language';
// @ts-expect-error — @nextjournal/clojure-mode has no type declarations
import { default_extensions as clojureMode } from '@nextjournal/clojure-mode';
import { editorBaseTheme, themes } from '@src/editors/themes';
import { evalHighlightField } from '@src/editors/extensions/evalHighlight';
import { diagnosticField } from '@src/editors/extensions/diagnostics';
import { navigationMetaField } from '@src/editors/extensions/structure/ast';
import { nodeHighlightPlugin } from '@src/editors/extensions/structure/decorations';
import {
  lastEvaluatedExpressionField,
  createExpressionGutter,
} from '@src/editors/extensions/structure/eval-integration';
import {
  createInlineResultsField,
  type InlineResultsConfig,
} from '@src/editors/extensions/inlineResults';
import type { EditorSetup } from './scenario';

/**
 * Registry of named extensions that scenarios can opt into.
 * Each entry returns one or more CodeMirror extensions.
 */
const extensionRegistry: Record<string, () => Extension | Extension[]> = {
  'structure-highlight': () => [navigationMetaField, nodeHighlightPlugin],
  'eval-highlight': () => evalHighlightField,
  'diagnostics': () => diagnosticField,
  'gutter': () => [
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
  ],
  'inline-results': () => createInlineResultsField({
    getMode: () => 'inline',
    getMaxChars: () => 200,
    getShowTimestamp: () => false,
    getAutoDismissMs: () => 0,
  } as InlineResultsConfig),
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
export function createInspectorEditor(
  container: HTMLElement,
  setup: EditorSetup,
  config: EditorConfig = {},
): EditorView {
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

  // Add only the requested optional extensions
  if (setup.extensions) {
    for (const name of setup.extensions) {
      const factory = extensionRegistry[name];
      if (factory) {
        const ext = factory();
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

  return view;
}
