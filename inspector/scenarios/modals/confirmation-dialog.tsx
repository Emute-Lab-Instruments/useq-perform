import { defineScenario } from '../../framework/scenario';
import { Modal } from '@src/ui/Modal';

export default defineScenario({
  category: 'Modals & Overlays / Modal',
  name: 'Confirmation dialog (real)',
  type: 'contract',
  sourceFiles: ['src/ui/Modal.tsx'],
  description: 'Real Modal component with title, message, and action buttons.',
  component: {
    render: () => (
      <Modal title="Confirm Action" onClose={() => {}}>
        <p>Are you sure you want to reset all settings?</p>
        <div style="display: flex; gap: 8px; margin-top: 16px; justify-content: flex-end">
          <button class="toolbar-button">Cancel</button>
          <button class="toolbar-button primary">Confirm</button>
        </div>
      </Modal>
    ),
    loadAppStyles: true,
    width: 500,
    height: 300,
  },
});
