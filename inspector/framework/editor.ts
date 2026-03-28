/**
 * Inspector editor harness — thin wrapper over the shared harness.
 *
 * Re-exports the shared createScenarioEditor under the old name for backward compat.
 */
import { createScenarioEditor } from '../../harness/editor-harness';
import type { EditorSetup } from './scenario';

export { extensionRegistry } from '../../harness/extension-registry';

export interface EditorConfig {
  theme?: string;
  fontSize?: number;
  readOnly?: boolean;
}

/**
 * Create a CodeMirror EditorView for an Inspector scenario.
 * Delegates to the shared harness.
 */
export async function createInspectorEditor(
  container: HTMLElement,
  setup: EditorSetup,
  config: EditorConfig = {},
) {
  return (await createScenarioEditor(container, {
    ...setup,
    theme: config.theme ?? 'useq-dark',
    fontSize: config.fontSize ?? 16,
    readOnly: config.readOnly ?? true,
  })).view;
}
