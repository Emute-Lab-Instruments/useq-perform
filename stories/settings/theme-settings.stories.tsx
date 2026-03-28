import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { For, onMount, onCleanup } from 'solid-js';
import { EditorView, drawSelection } from '@codemirror/view';
import { EditorState, type Extension } from '@codemirror/state';
import { bracketMatching } from '@codemirror/language';
import { default_extensions as clojureExtensions } from '@nextjournal/clojure-mode';
import { themes } from '@src/editors/themes';
import { defaultThemeEditorStartingCode } from '@src/lib/editorDefaults';

/** Lightweight read-only extensions for theme preview cards. */
const previewBaseExtensions: Extension[] = [
  EditorView.theme({
    '&': { height: 'auto' },
    '.cm-content': { fontSize: '13px', padding: '4px 0' },
    '.cm-scroller': { overflow: 'hidden' },
    '.cm-gutters': { display: 'none' },
    '&.cm-focused': { outline: '0 !important' },
    '.cm-line': { padding: '0 6px', lineHeight: '1.5' },
    '.cm-cursor': { display: 'none' },
    '.cm-activeLine': { backgroundColor: 'transparent' },
  }),
  bracketMatching(),
  drawSelection(),
  ...clojureExtensions,
  EditorState.readOnly.of(true),
];

function ThemePreviewCard(props: { themeName: string; themeExtension: Extension }) {
  let editorParent: HTMLDivElement | undefined;
  let view: EditorView | undefined;

  onMount(() => {
    if (editorParent) {
      const state = EditorState.create({
        doc: defaultThemeEditorStartingCode,
        extensions: [...previewBaseExtensions, props.themeExtension],
      });
      view = new EditorView({ state, parent: editorParent });
    }
  });

  onCleanup(() => {
    view?.destroy();
  });

  return (
    <div class="theme-preview panel-section">
      <div class="theme-name">{props.themeName}</div>
      <div
        ref={editorParent}
        style={{ 'max-height': '180px', overflow: 'hidden', 'border-radius': '4px' }}
      />
    </div>
  );
}

function ThemeSettingsWrapper() {
  return (
    <div class="panel-tab-content themes-container" id="panel-settings-themes">
      <h2 class="panel-section-title">Select a Theme</h2>
      <For each={Object.entries(themes)}>
        {([themeName, themeExtension]) => (
          <ThemePreviewCard themeName={themeName} themeExtension={themeExtension} />
        )}
      </For>
    </div>
  );
}

const meta: Meta = {
  title: 'Settings/Theme',
  component: ThemeSettingsWrapper,
};
export default meta;
type Story = StoryObj;

export const Default: Story = {};
