import { createSignal } from 'solid-js';
import type { ResolvedScenario } from '../framework/scenario';
import { copyContextToClipboard } from '../framework/context';

interface ContextButtonProps {
  scenario: ResolvedScenario;
}

export default function ContextButton(props: ContextButtonProps) {
  const [copied, setCopied] = createSignal(false);

  async function handleClick() {
    const success = await copyContextToClipboard(props.scenario);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <button
      class="context-button"
      classList={{ 'context-button-copied': copied() }}
      onClick={handleClick}
      title="Copy scenario context to clipboard"
    >
      {copied() ? 'Copied!' : 'Copy Context'}
    </button>
  );
}
