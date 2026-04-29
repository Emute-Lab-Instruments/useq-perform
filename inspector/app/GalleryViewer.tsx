import { For, onCleanup, onMount } from 'solid-js';
import type { ResolvedScenario } from '../framework/scenario';
import ApprovalBadge from './ApprovalBadge';

interface GalleryViewerProps {
  scenarios: ResolvedScenario[];
}

export default function GalleryViewer(props: GalleryViewerProps) {
  const iframeRefs = new Map<string, HTMLIFrameElement>();
  const viewportRefs = new Map<string, HTMLDivElement>();
  const readySet = new Set<string>();

  function sendScenario(id: string) {
    const iframe = iframeRefs.get(id);
    if (!iframe?.contentWindow) return;
    iframe.contentWindow.postMessage({ type: 'set-gallery-mode' }, '*');
    iframe.contentWindow.postMessage(
      { type: 'render-scenario', scenarioId: id },
      '*'
    );
  }

  function handleMessage(event: MessageEvent) {
    if (event.data?.type === 'scenario-runner-ready') {
      for (const [id, iframe] of iframeRefs) {
        if (iframe.contentWindow === event.source && !readySet.has(id)) {
          readySet.add(id);
          sendScenario(id);
          break;
        }
      }
    }

    if (event.data?.type === 'scenario-rendered' && event.data.contentHeight) {
      const id: string = event.data.id;
      const viewport = viewportRefs.get(id);
      if (viewport) {
        // Add a small buffer for padding/borders inside the iframe
        viewport.style.height = `${event.data.contentHeight + 4}px`;
      }
    }
  }

  onMount(() => window.addEventListener('message', handleMessage));
  onCleanup(() => window.removeEventListener('message', handleMessage));

  return (
    <div class="gallery-viewer">
      <For each={props.scenarios}>
        {(scenario) => (
          <div class="gallery-item">
            <div class="gallery-item-header">
              <span class="inspector-scenario-type" data-type={scenario.type}>
                {scenario.type}
              </span>
              <span class="gallery-item-name">{scenario.name}</span>
              <span class="gallery-item-category">{scenario.category}</span>
              <ApprovalBadge scenarioId={scenario.id} />
            </div>
            {scenario.description && (
              <div class="gallery-item-description">{scenario.description}</div>
            )}
            <div
              class="gallery-item-viewport"
              ref={(el) => viewportRefs.set(scenario.id, el)}
            >
              <iframe
                ref={(el) => iframeRefs.set(scenario.id, el)}
                class="gallery-iframe"
                src="./scenario-runner.html"
                tabIndex={-1}
                onLoad={() => sendScenario(scenario.id)}
              />
            </div>
          </div>
        )}
      </For>
    </div>
  );
}
