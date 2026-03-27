import { createEffect, createSignal, onCleanup } from 'solid-js';
import type { ResolvedScenario } from '../framework/scenario';

interface ScenarioViewerProps {
  scenario: ResolvedScenario;
}

export default function ScenarioViewer(props: ScenarioViewerProps) {
  let iframeRef: HTMLIFrameElement | undefined;
  const [ready, setReady] = createSignal(false);

  function sendScenario(scenario: ResolvedScenario) {
    if (!iframeRef?.contentWindow) return;
    // Only send the scenario ID — the runner loads the module itself.
    // Functions (render, component) can't be serialized via postMessage.
    iframeRef.contentWindow.postMessage(
      { type: 'render-scenario', scenarioId: scenario.id },
      '*'
    );
  }

  // Listen for the runner to signal it's ready
  function handleMessage(event: MessageEvent) {
    if (event.data?.type === 'scenario-runner-ready') {
      setReady(true);
      sendScenario(props.scenario);
    }
  }

  window.addEventListener('message', handleMessage);
  onCleanup(() => window.removeEventListener('message', handleMessage));

  // Re-send scenario when it changes (and runner is ready)
  createEffect(() => {
    const scenario = props.scenario;
    if (ready()) {
      sendScenario(scenario);
    }
  });

  function handleIframeLoad() {
    // The runner script will post 'scenario-runner-ready' when it initializes.
    // As a fallback, also try sending on load in case the message was missed.
    sendScenario(props.scenario);
  }

  return (
    <div class="scenario-viewer">
      <iframe
        ref={iframeRef}
        class="scenario-iframe"
        src="./scenario-runner.html"
        onLoad={handleIframeLoad}
      />
    </div>
  );
}
