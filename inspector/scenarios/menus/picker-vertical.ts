import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Modals & Overlays / Picker Menu',
  name: 'Vertical layout',
  type: 'canary',
  sourceFiles: ['src/ui/PickerMenu.tsx'],
  description: 'Single-column vertical list of selectable items.',
  component: {
    component: () => {
      const items = [
        { label: 'Load snippet', active: false },
        { label: 'Save snippet', active: true },
        { label: 'Export to clipboard', active: false },
        { label: 'Import from file', active: false },
      ];
      const el = document.createElement('div');
      el.style.padding = '0.5rem';
      el.style.background = '#1e1e2e';
      el.style.borderRadius = '8px';
      el.style.border = '1px solid #444';
      el.style.fontFamily = 'sans-serif';
      el.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 2px;">
          ${items
            .map(
              (item) => `
            <div style="
              padding: 0.5rem 0.75rem; border-radius: 4px; cursor: pointer;
              font-size: 0.85rem;
              background: ${item.active ? '#333366' : 'transparent'};
              color: ${item.active ? '#e0e0f0' : '#808098'};
            ">${item.label}</div>
          `,
            )
            .join('')}
        </div>
      `;
      return el;
    },
    width: 250,
    height: 220,
  },
});
