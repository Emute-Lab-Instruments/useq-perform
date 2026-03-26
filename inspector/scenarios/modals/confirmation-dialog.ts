import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Modals & Overlays / Modal',
  name: 'Confirmation dialog',
  type: 'contract',
  sourceFiles: ['src/ui/Modal.tsx'],
  description:
    'Centered modal with title, message, confirm/cancel buttons, and a dark overlay.',
  component: {
    component: () => {
      const el = document.createElement('div');
      el.style.position = 'relative';
      el.style.width = '100%';
      el.style.height = '100%';
      el.style.background = 'rgba(0, 0, 0, 0.6)';
      el.style.display = 'flex';
      el.style.alignItems = 'center';
      el.style.justifyContent = 'center';
      el.innerHTML = `
        <div style="background: #1e1e2e; border: 1px solid #444; border-radius: 8px; padding: 1.5rem; width: 320px; color: #a0a0c0; font-family: sans-serif;">
          <h2 style="margin: 0 0 0.75rem; font-size: 1rem; color: #e0e0f0;">Confirm Action</h2>
          <p style="margin: 0 0 1.25rem; font-size: 0.85rem; color: #808098;">Are you sure you want to proceed? This action cannot be undone.</p>
          <div style="display: flex; gap: 0.5rem; justify-content: flex-end;">
            <button style="padding: 0.4rem 1rem; background: transparent; border: 1px solid #555; border-radius: 4px; color: #a0a0c0; cursor: pointer;">Cancel</button>
            <button style="padding: 0.4rem 1rem; background: #5865f2; border: none; border-radius: 4px; color: #fff; cursor: pointer;">Confirm</button>
          </div>
        </div>
      `;
      return el;
    },
    width: 500,
    height: 350,
  },
});
