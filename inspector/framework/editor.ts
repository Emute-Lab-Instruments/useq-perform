import { EditorState } from '@codemirror/state';
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
import type { EditorSetup } from './scenario';

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
 * Mounts into the given container element.
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

  const extensions = [
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
    evalHighlightField,
    diagnosticField,
    navigationMetaField,
    nodeHighlightPlugin,
  ];

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
    // Focus to show cursor
    view.focus();
  }

  return view;
}
