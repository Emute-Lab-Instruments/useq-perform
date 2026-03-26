import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Keybindings / Modifier Hints',
  name: 'Modifier key overlay',
  type: 'canary',
  sourceFiles: [
    'src/ui/keybindings/ModifierHints.tsx',
  ],
  description:
    'Ephemeral floating panel that appears when a modifier key is held, showing available key completions for that modifier.',
  component: {
    component: () => {
      const el = document.createElement('div');
      el.style.padding = '1rem';
      el.style.color = '#a0a0c0';
      el.style.fontFamily = 'monospace';

      const hints = [
        { key: 'Enter', action: 'Evaluate line', cat: 'core', color: '#2dd4bf' },
        { key: 'Shift+Enter', action: 'Evaluate block', cat: 'core', color: '#2dd4bf' },
        { key: 'P', action: 'Toggle probe', cat: 'probe', color: '#c084fc' },
        { key: ']', action: 'Next editor', cat: 'navigation', color: '#94a3b8' },
        { key: '[', action: 'Previous editor', cat: 'navigation', color: '#94a3b8' },
        { key: 'S', action: 'Save snippet', cat: 'UI', color: '#60a5fa' },
      ];

      const hintsHtml = hints
        .map(
          (h) =>
            `<div style="display:flex;align-items:center;gap:8px;padding:3px 0;">` +
            `<kbd style="display:inline-block;min-width:60px;font-size:0.7rem;padding:1px 5px;border-radius:3px;background:#ffffff10;color:#e0e0f0;text-align:center;">${h.key}</kbd>` +
            `<span style="font-size:0.7rem;color:${h.color};">${h.action}</span>` +
            `</div>`,
        )
        .join('');

      el.innerHTML =
        `<p style="font-size: 0.8rem; color: #606080;">Component scenario — full SolidJS rendering pending</p>` +
        `<p style="margin:0.5rem 0 0.25rem;">ModifierHints — modifier key overlay</p>` +
        `<div style="display:inline-block;background:#1a1a2e;border:1px solid #ffffff15;border-radius:8px;padding:10px 14px;margin-top:0.75rem;">` +
        `<p style="font-size:0.65rem;color:#606080;margin-bottom:6px;"><kbd style="padding:1px 5px;border-radius:3px;background:#ffffff10;color:#facc15;font-size:0.7rem;">Ctrl</kbd> held</p>` +
        hintsHtml +
        `</div>`;

      return el;
    },
    width: 360,
    height: 340,
  },
});
