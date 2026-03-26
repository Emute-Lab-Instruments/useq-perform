// Scenario runner — executes inside the iframe.
// Listens for postMessage from the parent ScenarioViewer and renders the requested scenario.

// Auto-discover all scenario modules for dynamic loading
const scenarioModules = import.meta.glob('./scenarios/**/*.ts');

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
    // Resolve the module path — try the ID-based path
    const modulePath = `./scenarios/${data.scenario.id}.ts`;
    const loader = scenarioModules[modulePath];
    if (!loader) {
      root.innerHTML = `<div class="scenario-loading" style="color: #e06060">Scenario module not found: ${data.scenario.id}</div>`;
      return;
    }

    const mod = await (loader as () => Promise<{ default: any }>)();
    const definition = mod.default;

    // Clear root for rendering
    root.innerHTML = '';

    if (definition.component) {
      // Component scenario: call the component function to get a DOM element or JSX
      const el = definition.component.component();
      if (el instanceof HTMLElement) {
        // Apply optional container dimensions
        if (definition.component.width) {
          el.style.width = `${definition.component.width}px`;
        }
        if (definition.component.height) {
          el.style.height = `${definition.component.height}px`;
        }
        root.appendChild(el);
      }
    } else if (definition.editor) {
      // Editor scenario: render a code preview placeholder
      // Full CodeMirror integration will be added when editor scenarios are built
      const container = document.createElement('div');
      container.style.padding = '1rem';
      container.style.fontFamily = 'monospace';
      container.style.whiteSpace = 'pre-wrap';

      const label = document.createElement('div');
      label.style.color = '#606080';
      label.style.marginBottom = '0.5rem';
      label.style.fontSize = '0.8rem';
      label.textContent = 'Editor scenario \u2014 CodeMirror integration pending';

      const code = document.createElement('pre');
      code.style.padding = '1rem';
      code.style.background = '#12121e';
      code.style.borderRadius = '4px';
      code.style.color = '#c0c0e0';
      code.textContent = definition.editor.editorContent;

      container.appendChild(label);
      container.appendChild(code);
      root.appendChild(container);
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
