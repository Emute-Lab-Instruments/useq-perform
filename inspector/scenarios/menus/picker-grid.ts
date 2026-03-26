import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Modals & Overlays / Picker Menu',
  name: 'Grid layout (3 columns)',
  type: 'contract',
  sourceFiles: ['src/ui/PickerMenu.tsx'],
  description:
    'Three-column grid of items with icons and labels, one item highlighted.',
  component: {
    component: () => {
      const items = [
        { icon: '\u266B', label: 'Sine', highlighted: false },
        { icon: '\u25A0', label: 'Square', highlighted: true },
        { icon: '\u25B2', label: 'Triangle', highlighted: false },
        { icon: '\u223F', label: 'Saw', highlighted: false },
        { icon: '\u2022', label: 'Pulse', highlighted: false },
        { icon: '\u2248', label: 'Noise', highlighted: false },
      ];
      const el = document.createElement('div');
      el.style.padding = '1rem';
      el.style.background = '#1e1e2e';
      el.style.borderRadius = '8px';
      el.style.border = '1px solid #444';
      el.style.fontFamily = 'sans-serif';
      el.innerHTML = `
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.5rem;">
          ${items
            .map(
              (item) => `
            <div style="
              display: flex; flex-direction: column; align-items: center; gap: 0.25rem;
              padding: 0.75rem 0.5rem; border-radius: 6px; cursor: pointer;
              background: ${item.highlighted ? '#333366' : '#2a2a3e'};
              border: 1px solid ${item.highlighted ? '#5865f2' : '#3a3a50'};
              color: ${item.highlighted ? '#e0e0f0' : '#808098'};
            ">
              <span style="font-size: 1.25rem;">${item.icon}</span>
              <span style="font-size: 0.75rem;">${item.label}</span>
            </div>
          `,
            )
            .join('')}
        </div>
      `;
      return el;
    },
    width: 300,
    height: 250,
  },
});
