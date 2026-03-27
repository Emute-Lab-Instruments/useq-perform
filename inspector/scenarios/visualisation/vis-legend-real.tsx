import { defineScenario } from '../../framework/scenario';
import { VisLegend } from '@src/ui/VisLegend';

export default defineScenario({
  category: 'Visualisation / Legend',
  name: 'Channel legend (real)',
  type: 'contract',
  sourceFiles: ['src/ui/VisLegend.tsx'],
  description: 'Real VisLegend showing 7 channels with palette colors, some active and some inactive.',
  component: {
    render: () => <VisLegend channels={[
      { channel: 'a1', color: '#00ff41', active: true, label: 'a1' },
      { channel: 'a2', color: '#1adbdb', active: true, label: 'a2' },
      { channel: 'a3', color: '#ffaa00', active: false, label: 'a3' },
      { channel: 'a4', color: '#ff0080', active: false, label: 'a4' },
      { channel: 'd1', color: '#ff5500', active: true, label: 'd1' },
      { channel: 'd2', color: '#ffee33', active: false, label: 'd2' },
      { channel: 'd3', color: '#0088ff', active: false, label: 'd3' },
    ]} />,
    loadAppStyles: true,
    width: 600,
    height: 60,
  },
});
