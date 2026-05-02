import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { onMount, onCleanup } from 'solid-js';
import { userEvent, within } from 'storybook/test';
import {
  ActionPalette,
  openPalette,
  closePalette,
} from '@src/ui/keybindings/ActionPalette';

function PaletteHarness() {
  onMount(() => openPalette());
  onCleanup(() => closePalette());
  return (
    <div style={{ width: '100%', height: '600px', background: '#0b1220' }}>
      <div style={{ padding: '16px', color: 'rgba(255,255,255,0.5)', 'font-family': 'monospace', 'font-size': '12px' }}>
        ActionPalette opened via openPalette(). Type to filter, ↑/↓ to navigate, Enter to run, Esc to close.
      </div>
      <ActionPalette />
    </div>
  );
}

const meta: Meta = {
  title: 'Keybindings/ActionPalette',
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
};
export default meta;
type Story = StoryObj;

/**
 * Action palette in its open state, listing every action from the keybinding
 * registry alongside its default shortcut. Real handlers are no-ops here so
 * selecting an item just closes the palette and shows the shortcut toast.
 */
export const Open: Story = {
  render: () => <PaletteHarness />,
};

/** Closed state for completeness — `<ActionPalette />` renders nothing. */
export const Closed: Story = {
  render: () => {
    onMount(() => closePalette());
    return (
      <div style={{ width: '100%', height: '300px', background: '#0b1220', padding: '16px', color: 'rgba(255,255,255,0.5)', 'font-family': 'monospace', 'font-size': '12px' }}>
        Palette is closed. Use the "Open" story to see the rendered state.
        <ActionPalette />
      </div>
    );
  },
};

/** Open with a filter query pre-typed — narrows the list to matching actions. */
export const Filtered: Story = {
  render: () => <PaletteHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = await canvas.findByPlaceholderText('Type to search actions...');
    await userEvent.type(input, 'eval');
  },
};

/** Open with a query that matches nothing — empty-results message visible. */
export const NoResults: Story = {
  render: () => <PaletteHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = await canvas.findByPlaceholderText('Type to search actions...');
    await userEvent.type(input, 'zzznotanaction');
  },
};
