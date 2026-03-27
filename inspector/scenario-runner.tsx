// Scenario runner — executes inside the iframe.
// Listens for postMessage from the parent ScenarioViewer and renders the requested scenario.

import { render } from 'solid-js/web';
import { createInspectorEditor } from './framework/editor';

// Auto-discover all scenario modules (.ts and .tsx)
const scenarioModules = {
  ...import.meta.glob('./scenarios/**/*.ts'),
  ...import.meta.glob('./scenarios/**/*.tsx'),
};

const root = document.getElementById('scenario-root')!;

// Listen for scenario render requests from parent — receives only the ID,
// loads the scenario module itself to avoid postMessage serialization issues
// (functions like render() can't be cloned across the iframe boundary).
window.addEventListener('message', async (event: MessageEvent) => {
  if (event.data?.type !== 'render-scenario') return;
  const scenarioId: string = event.data.scenarioId;

  root.innerHTML = '<div class="scenario-loading">Loading scenario...</div>';

  try {
    const tsPath = `./scenarios/${scenarioId}.ts`;
    const tsxPath = `./scenarios/${scenarioId}.tsx`;
    const loader = scenarioModules[tsPath] || scenarioModules[tsxPath];
    if (!loader) {
      root.innerHTML = `<div class="scenario-loading" style="color: #e06060">Scenario not found: ${scenarioId}</div>`;
      return;
    }

    const mod = await (loader as () => Promise<{ default: any }>)();
    const definition = mod.default;

    root.innerHTML = '';

    if (definition.component) {
      if (definition.component.loadAppStyles) {
        await import('@src/ui/styles/index.css');
      }

      const container = document.createElement('div');
      if (definition.component.width) container.style.width = `${definition.component.width}px`;
      if (definition.component.height) container.style.height = `${definition.component.height}px`;
      root.appendChild(container);

      if (definition.component.render) {
        render(() => definition.component.render(), container);
      } else if (definition.component.component) {
        const el = definition.component.component();
        if (el instanceof HTMLElement) container.appendChild(el);
      }
    } else if (definition.editor) {
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
      root.innerHTML = '<div class="scenario-loading" style="color: #e0a040">No component or editor setup</div>';
    }

    window.parent.postMessage({ type: 'scenario-rendered', id: scenarioId }, '*');
  } catch (err) {
    root.innerHTML = `<div class="scenario-loading" style="color: #e06060">Error: ${err instanceof Error ? err.message : String(err)}</div>`;
  }
});

// Notify parent that the runner is ready to receive scenarios
window.parent.postMessage({ type: 'scenario-runner-ready' }, '*');
