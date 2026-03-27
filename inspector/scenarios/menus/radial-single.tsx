import { defineScenario } from '../../framework/scenario';
import { createSignal } from 'solid-js';
import { RadialMenu } from '@src/ui/RadialMenu';

export default defineScenario({
  category: 'Modals & Overlays / Radial Menu',
  name: 'Single ring (real)',
  type: 'contract',
  sourceFiles: ['src/ui/RadialMenu.tsx'],
  description:
    'Real RadialMenu component with 8 segments, hover interaction, and inactive theme colors. Hover over segments to see highlight.',
  component: {
    render: () => {
      const [active, setActive] = createSignal<number | null>(null);
      const labels = ['d1', 'd2', 'd3', 'd4', 'a1', 'a2', 'a3', 'a4'];

      return (
        <div style={{ display: 'flex', 'align-items': 'center', 'justify-content': 'center', padding: '16px' }}>
          <RadialMenu
            segmentCount={8}
            activeSegment={active()}
            onHoverSegment={setActive}
            onSelectSegment={() => {}}
            labels={labels}
            size={260}
            innerRadiusRatio={0.35}
            pointerEnabled={true}
          />
        </div>
      );
    },
    loadAppStyles: true,
    width: 320,
    height: 320,
  },
});
