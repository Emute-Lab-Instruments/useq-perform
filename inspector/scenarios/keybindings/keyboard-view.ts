import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Keybindings / Keyboard Visualiser',
  name: 'View mode (QWERTY US)',
  type: 'contract',
  sourceFiles: [
    'src/ui/keybindings/KeyboardVisualiser.tsx',
  ],
  description:
    'Full keyboard layout in view mode with color-coded keys by action category: core (teal), editor (orange), structure (green), probe (purple), navigation (slate), UI (blue), transport (yellow), gamepad (orange-red).',
  component: {
    component: () => {
      const el = document.createElement('div');
      el.style.padding = '1rem';
      el.style.color = '#a0a0c0';
      el.style.fontFamily = 'monospace';

      const legend = [
        { label: 'core', color: '#2dd4bf' },
        { label: 'editor', color: '#fb923c' },
        { label: 'structure', color: '#4ade80' },
        { label: 'probe', color: '#c084fc' },
        { label: 'navigation', color: '#94a3b8' },
        { label: 'UI', color: '#60a5fa' },
        { label: 'transport', color: '#facc15' },
        { label: 'gamepad', color: '#f97316' },
      ];

      const legendHtml = legend
        .map(
          (l) =>
            `<span style="display:inline-block;width:10px;height:10px;background:${l.color};border-radius:2px;margin-right:4px;vertical-align:middle;"></span><span style="margin-right:12px;font-size:0.7rem;">${l.label}</span>`,
        )
        .join('');

      const keyStyle = (bg: string) =>
        `display:inline-block;width:36px;height:32px;line-height:32px;text-align:center;margin:2px;border-radius:4px;background:${bg};color:#1a1a2e;font-size:0.7rem;font-weight:600;`;

      const rows = [
        { keys: 'Q W E R T Y U I O P'.split(' '), color: '#2dd4bf' },
        { keys: 'A S D F G H J K L'.split(' '), color: '#4ade80' },
        { keys: 'Z X C V B N M'.split(' '), color: '#c084fc' },
      ];

      const rowsHtml = rows
        .map(
          (r) =>
            `<div>${r.keys.map((k) => `<span style="${keyStyle(r.color)}">${k}</span>`).join('')}</div>`,
        )
        .join('');

      el.innerHTML =
        `<p style="font-size: 0.8rem; color: #606080;">Component scenario — full SolidJS rendering pending</p>` +
        `<p style="margin:0.5rem 0 0.25rem;">KeyboardVisualiser — view mode (QWERTY US)</p>` +
        `<div style="margin:0.75rem 0;">${legendHtml}</div>` +
        `<div style="background:#1a1a2e;padding:0.75rem;border-radius:8px;">${rowsHtml}</div>`;

      return el;
    },
    width: 640,
    height: 320,
  },
});
