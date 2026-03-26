import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Keybindings / Action Palette',
  name: 'Command palette',
  type: 'contract',
  sourceFiles: [
    'src/ui/keybindings/ActionPalette.tsx',
  ],
  description:
    'Floating command palette with search input and filterable action list showing action ID, description, current keybinding, and category badge.',
  component: {
    component: () => {
      const el = document.createElement('div');
      el.style.padding = '1rem';
      el.style.color = '#a0a0c0';
      el.style.fontFamily = 'monospace';

      const actions = [
        { id: 'eval-line', desc: 'Evaluate current line', key: 'Ctrl+Enter', cat: 'core', catColor: '#2dd4bf' },
        { id: 'eval-block', desc: 'Evaluate block', key: 'Ctrl+Shift+Enter', cat: 'core', catColor: '#2dd4bf' },
        { id: 'toggle-probe', desc: 'Toggle probe on expression', key: 'Ctrl+P', cat: 'probe', catColor: '#c084fc' },
        { id: 'nav-next-editor', desc: 'Focus next editor', key: 'Ctrl+]', cat: 'navigation', catColor: '#94a3b8' },
        { id: 'toggle-help', desc: 'Toggle help panel', key: 'F1', cat: 'UI', catColor: '#60a5fa' },
      ];

      const badge = (text: string, color: string) =>
        `<span style="display:inline-block;padding:1px 6px;border-radius:3px;background:${color}20;color:${color};font-size:0.6rem;font-weight:600;">${text}</span>`;

      const rowsHtml = actions
        .map(
          (a) =>
            `<div style="display:flex;align-items:center;gap:8px;padding:4px 8px;border-bottom:1px solid #ffffff10;">` +
            `<code style="flex:0 0 140px;font-size:0.7rem;color:#e0e0f0;">${a.id}</code>` +
            `<span style="flex:1;font-size:0.7rem;">${a.desc}</span>` +
            `<kbd style="font-size:0.65rem;padding:1px 4px;border-radius:3px;background:#ffffff10;color:#e0e0f0;">${a.key}</kbd>` +
            badge(a.cat, a.catColor) +
            `</div>`,
        )
        .join('');

      el.innerHTML =
        `<p style="font-size: 0.8rem; color: #606080;">Component scenario — full SolidJS rendering pending</p>` +
        `<p style="margin:0.5rem 0 0.25rem;">ActionPalette — command palette</p>` +
        `<div style="background:#1a1a2e;border:1px solid #ffffff15;border-radius:8px;margin-top:0.75rem;overflow:hidden;">` +
        `<div style="padding:8px;border-bottom:1px solid #ffffff15;">` +
        `<input type="text" placeholder="Search actions..." value="eval" style="width:100%;background:#0d0d1a;border:1px solid #ffffff20;border-radius:4px;padding:6px 8px;color:#e0e0f0;font-size:0.75rem;font-family:monospace;" readonly />` +
        `</div>` +
        `<div>${rowsHtml}</div>` +
        `</div>`;

      return el;
    },
    width: 500,
    height: 400,
  },
});
