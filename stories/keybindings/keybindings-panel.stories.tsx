import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { userEvent, within } from 'storybook/test';
import { KeybindingsPanel } from '@src/ui/keybindings/KeybindingsPanel';

const meta: Meta = {
  title: 'Keybindings/KeybindingsPanel',
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
};
export default meta;
type Story = StoryObj;

/**
 * Editable keybindings panel — bindings are grouped by category
 * (Evaluation, Panels, Editor, …). Click "Edit" on any row to enter
 * key-listening mode, then press a combo to rebind. Conflicting binds
 * surface inline with swap/nearby suggestions.
 */
export const Default: Story = {
  render: () => (
    <div style={{ width: '100%', 'max-width': '780px', height: '720px', overflow: 'auto', background: '#0b1220', padding: '12px' }}>
      <KeybindingsPanel />
    </div>
  ),
};

/**
 * Listening mode — `play()` clicks the first row's edit button so the
 * "Press a key…" prompt is showing. Press any key in the live preview to
 * try the rebind flow.
 */
export const Listening: Story = {
  render: () => (
    <div style={{ width: '100%', 'max-width': '780px', height: '720px', overflow: 'auto', background: '#0b1220', padding: '12px' }}>
      <KeybindingsPanel />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // First "Rebind" button in the panel — pencil glyph (✎).
    const editBtns = await canvas.findAllByTitle('Rebind this shortcut');
    if (editBtns[0]) await userEvent.click(editBtns[0]);
  },
};

/**
 * Conflict-resolution UI — `play()` enters listening mode on the
 * "Evaluate now" row (default `Mod-Enter`) and dispatches `Alt-Enter`,
 * which is already bound to "Evaluate quantised". The conflict banner
 * with swap/nearby suggestions appears inline.
 */
export const Conflict: Story = {
  render: () => (
    <div style={{ width: '100%', 'max-width': '780px', height: '720px', overflow: 'auto', background: '#0b1220', padding: '12px' }}>
      <KeybindingsPanel />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const editBtns = await canvas.findAllByTitle('Rebind this shortcut');
    if (!editBtns[0]) return;
    await userEvent.click(editBtns[0]);
    // Dispatch Alt-Enter at the window level (the panel's listener uses
    // `addEventListener("keydown", ..., true)` in the capture phase).
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  },
};
