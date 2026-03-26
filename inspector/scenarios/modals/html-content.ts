import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Modals & Overlays / Modal',
  name: 'HTML content modal',
  type: 'canary',
  sourceFiles: ['src/ui/Modal.tsx'],
  description:
    'Modal displaying sanitized HTML content including rich text and links.',
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
        <div style="background: #1e1e2e; border: 1px solid #444; border-radius: 8px; padding: 1.5rem; width: 360px; color: #a0a0c0; font-family: sans-serif;">
          <h2 style="margin: 0 0 0.75rem; font-size: 1rem; color: #e0e0f0;">Release Notes</h2>
          <div style="font-size: 0.85rem; line-height: 1.5; color: #808098;">
            <p style="margin: 0 0 0.5rem;">New in <strong style="color: #c0c0e0;">v1.2.0</strong>:</p>
            <ul style="margin: 0 0 0.5rem; padding-left: 1.25rem;">
              <li>Improved <em>inline evaluation</em> rendering</li>
              <li>Added <a href="#" style="color: #7aa2f7; text-decoration: underline;">diagnostic hints</a></li>
              <li>Fixed serialisation edge cases</li>
            </ul>
            <p style="margin: 0;">See the <a href="#" style="color: #7aa2f7; text-decoration: underline;">full changelog</a> for details.</p>
          </div>
        </div>
      `;
      return el;
    },
    width: 500,
    height: 400,
  },
});
