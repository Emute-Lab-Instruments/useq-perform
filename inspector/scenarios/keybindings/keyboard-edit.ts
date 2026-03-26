import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Keybindings / Keyboard Visualiser',
  name: 'Edit mode (rebinding)',
  type: 'canary',
  sourceFiles: [
    'src/ui/keybindings/KeyboardVisualiser.tsx',
  ],
  description:
    'Keyboard layout in edit/rebinding mode with one key selected and waiting for the next keypress to capture a new binding.',
  component: {
    component: () => {
      const el = document.createElement('div');
      el.style.padding = '1rem';
      el.style.color = '#a0a0c0';
      el.style.fontFamily = 'monospace';

      const keyStyle = (bg: string, selected = false) =>
        `display:inline-block;width:36px;height:32px;line-height:32px;text-align:center;margin:2px;border-radius:4px;background:${bg};color:#1a1a2e;font-size:0.7rem;font-weight:600;` +
        (selected ? 'box-shadow:0 0 0 2px #facc15, 0 0 8px #facc1580;' : '');

      const keys = 'Q W E R T Y U I O P'.split(' ');
      const keysHtml = keys
        .map(
          (k) =>
            `<span style="${keyStyle(k === 'E' ? '#facc15' : '#334155', k === 'E')}">${k}</span>`,
        )
        .join('');

      el.innerHTML =
        `<p style="font-size: 0.8rem; color: #606080;">Component scenario — full SolidJS rendering pending</p>` +
        `<p style="margin:0.5rem 0 0.25rem;">KeyboardVisualiser — edit mode (rebinding)</p>` +
        `<div style="background:#1a1a2e;padding:0.75rem;border-radius:8px;margin-top:0.75rem;">` +
        `<div>${keysHtml}</div>` +
        `<p style="color:#facc15;font-size:0.7rem;margin-top:0.75rem;">Press a key to rebind <strong>E</strong> (Eval Line)...</p>` +
        `</div>`;

      return el;
    },
    width: 640,
    height: 260,
  },
});
