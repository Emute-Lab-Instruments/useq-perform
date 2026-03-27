import { defineScenario } from '../../framework/scenario';
import { ProgressBar } from '@src/ui/ProgressBar';

export default defineScenario({
  category: 'Toolbar & Chrome / Progress Bar',
  name: '60% progress',
  type: 'contract',
  sourceFiles: ['src/ui/ProgressBar.tsx'],
  description: 'ProgressBar at 60% fill. The bar should visually fill about 3/5 of the container width via scaleX transform.',
  component: {
    render: () => (
      <div style={{ width: '400px', background: '#1e293b', padding: '20px' }}>
        <div class="toolbar-row" style={{ width: '100%', height: '40px' }} />
        <ProgressBar progress={0.6} />
      </div>
    ),
    loadAppStyles: true,
    width: 440,
    height: 80,
  },
});
