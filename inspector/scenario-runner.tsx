// Scenario runner — executes inside the iframe.
// Listens for postMessage from the parent ScenarioViewer and renders the requested scenario.

import { render } from 'solid-js/web';
import { createInspectorEditor } from './framework/editor';

// Auto-discover all scenario modules (.ts and .tsx)
const scenarioModules = {
  ...import.meta.glob('./scenarios/**/*.ts'),
  ...import.meta.glob('./scenarios/**/*.tsx'),
};

interface ScenarioMessage {
  type: 'render-scenario';
  scenario: {
    id: string;
    modulePath: string;
    name: string;
    category: string;
    settings?: Record<string, unknown>;
    editor?: {
      editorContent: string;
      extensions?: string[];
      cursorPosition?: number;
    };
    component?: {
      width?: number;
      height?: number;
    };
  };
}

const root = document.getElementById('scenario-root')!;

// Listen for scenario render requests from parent
window.addEventListener('message', async (event: MessageEvent) => {
  const data = event.data as ScenarioMessage;
  if (data.type !== 'render-scenario') return;

  // Clear previous content
  root.innerHTML = '<div class="scenario-loading">Loading scenario...</div>';

  try {
    // Resolve the module path — try .ts then .tsx
    const tsPath = `./scenarios/${data.scenario.id}.ts`;
    const tsxPath = `./scenarios/${data.scenario.id}.tsx`;
    const loader = scenarioModules[tsPath] || scenarioModules[tsxPath];
    if (!loader) {
      root.innerHTML = `<div class="scenario-loading" style="color: #e06060">Scenario module not found: ${data.scenario.id}</div>`;
      return;
    }

    const mod = await (loader as () => Promise<{ default: any }>)();
    const definition = mod.default;

    // Clear root for rendering
    root.innerHTML = '';

    if (definition.component) {
      // Load app CSS if requested
      if (definition.component.loadAppStyles) {
        await import('@src/ui/styles/index.css');
      }

      const container = document.createElement('div');
      if (definition.component.width) {
        container.style.width = `${definition.component.width}px`;
      }
      if (definition.component.height) {
        container.style.height = `${definition.component.height}px`;
      }
      root.appendChild(container);

      if (definition.component.render) {
        // SolidJS JSX rendering
        render(() => definition.component.render(), container);
      } else if (definition.component.component) {
        // Legacy DOM element rendering
        const el = definition.component.component();
        if (el instanceof HTMLElement) {
          container.appendChild(el);
        }
      }
    } else if (definition.editor) {
      // Editor scenario: mount a real CodeMirror instance
      const container = document.createElement('div');
      container.style.height = '100%';
      container.style.width = '100%';
      root.appendChild(container);

      await createInspectorEditor(container, definition.editor, {
        theme: (definition.settings?.['editor.theme'] as string) ?? undefined,
        fontSize: (definition.settings?.['editor.fontSize'] as number) ?? undefined,
        readOnly: true,
      });
    } else {
      root.innerHTML =
        '<div class="scenario-loading" style="color: #e0a040">Scenario has no component or editor setup</div>';
    }

    // Notify parent that rendering is complete
    window.parent.postMessage(
      { type: 'scenario-rendered', id: data.scenario.id },
      '*'
    );
  } catch (err) {
    root.innerHTML = `<div class="scenario-loading" style="color: #e06060">Error: ${err instanceof Error ? err.message : String(err)}</div>`;
  }
});

// Notify parent that the runner is ready to receive scenarios
window.parent.postMessage({ type: 'scenario-runner-ready' }, '*');
