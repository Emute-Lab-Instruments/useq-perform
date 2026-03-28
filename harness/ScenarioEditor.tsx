/**
 * <ScenarioEditor> — declarative CodeMirror editor for Storybook stories.
 *
 * Accepts EditorSetup as props. Internally creates a CodeMirror editor,
 * loads extensions from the registry, and pushes seed data post-mount.
 *
 * Usage in a Storybook story:
 *   export const Default: Story = {
 *     args: {
 *       editorContent: '(+ 1 2)',
 *       extensions: ['diagnostics'],
 *       diagnostics: [{ start: 0, end: 7, severity: 'error', message: '...' }],
 *     },
 *   };
 */
import { onMount, onCleanup } from 'solid-js';
import { createScenarioEditor, type EditorHandle } from './editor-harness';
import type { EditorSetup } from './types';

export function ScenarioEditor(props: EditorSetup) {
  let ref!: HTMLDivElement;
  let handle: EditorHandle | undefined;

  onMount(async () => {
    handle = await createScenarioEditor(ref, props);
  });

  onCleanup(() => handle?.dispose());

  return (
    <div
      ref={ref}
      style={{
        height: '100%',
        width: '100%',
        'min-height': '200px',
        background: '#0b1220',
      }}
    />
  );
}
