import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { onMount, onCleanup, createSignal } from 'solid-js';
import { ModifierHints } from '@src/ui/keybindings/ModifierHints';

/**
 * Drive the hints overlay by dispatching synthetic keyboard events.
 * The component watches `window` keydown/keyup, starts a hold-timer
 * on a lone modifier press, and reveals the overlay after the
 * configured delay (default 500ms).
 */
function ModifierTrigger(props: { modifier: 'Control' | 'Alt' | 'Shift' | 'Meta' }) {
  const [pressed, setPressed] = createSignal(false);

  const press = () => {
    setPressed(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: props.modifier, bubbles: true }));
  };
  const release = () => {
    setPressed(false);
    window.dispatchEvent(new KeyboardEvent('keyup', { key: props.modifier, bubbles: true }));
  };

  onCleanup(() => {
    if (pressed()) release();
  });

  return (
    <div style={{ width: '100%', 'min-height': '500px', position: 'relative', background: '#0b1220', padding: '24px' }}>
      <div style={{ color: 'rgba(255,255,255,0.6)', 'font-family': 'monospace', 'font-size': '12px', 'margin-bottom': '12px' }}>
        Click "Hold {props.modifier}" to fire a synthetic keydown — the overlay appears
        after the configured hold delay (~500ms).
      </div>
      <button
        onPointerDown={press}
        onPointerUp={release}
        onPointerLeave={() => pressed() && release()}
        style={{
          padding: '8px 16px',
          'font-family': 'monospace',
          'font-size': '14px',
          background: pressed() ? '#3a3a6a' : '#1a1a2e',
          color: '#c0c0e0',
          border: '1px solid #444',
          'border-radius': '4px',
          cursor: 'pointer',
        }}
      >
        Hold {props.modifier}
      </button>
      <ModifierHints />
    </div>
  );
}

const meta: Meta = {
  title: 'Keybindings/ModifierHints',
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
};
export default meta;
type Story = StoryObj;

/** Holding Ctrl reveals all Ctrl-prefixed bindings. */
export const Ctrl: Story = {
  render: () => <ModifierTrigger modifier="Control" />,
};

/** Holding Alt reveals all Alt-prefixed bindings. */
export const Alt: Story = {
  render: () => <ModifierTrigger modifier="Alt" />,
};

/** Holding Shift reveals all Shift-prefixed bindings. */
export const Shift: Story = {
  render: () => <ModifierTrigger modifier="Shift" />,
};

/** Holding Meta (Cmd on macOS, Win key elsewhere) — also matches `Mod-` bindings on mac. */
export const Meta: Story = {
  render: () => <ModifierTrigger modifier="Meta" />,
};
