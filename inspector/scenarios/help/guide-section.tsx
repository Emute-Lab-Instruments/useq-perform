import { createSignal } from 'solid-js';
import { defineScenario } from '../../framework/scenario';
import { HelpPanel } from '@src/ui/help/HelpPanel';
import { GuideSection } from '@src/ui/help/guide/GuideSection';
import type { Tab } from '@src/ui/Tabs';
import type { Section } from '@src/ui/help/guide/guideTypes';

/**
 * Real GuideSection component rendered with a Section that contains every
 * non-playground content block (prose, try-it, tip, deep-dive, reference-
 * table). The Playground block type is exercised separately in
 * guide-playground.tsx (it's runtime-coupled and can't render in the iframe).
 *
 * This scenario starts with the section expanded so reviewers can see all
 * content. Click the header to verify the collapse/expand toggle works.
 */
const sampleSection: Section = {
  id: 'phasor',
  title: '3.1 The Phasor',
  summary: 'A ramp from 0 to 1 — the heartbeat of every signal',
  content: [
    {
      type: 'prose',
      text:
        'A *phasor* is a signal that ramps linearly from `0` to `1` over a fixed period, ' +
        'then resets. The expression `(bar)` gives you a phasor that resets once per bar.\n\n' +
        'Phasors are the foundation of every other signal — once you have a ramp, ' +
        'you can shape it into anything.',
    },
    {
      type: 'try-it',
      text: 'Replace `(bar)` with `(beat)` to make the phasor reset four times faster.',
    },
    {
      type: 'tip',
      text: 'Phasors are *not* the same as sawtooth waves: they only go up, never down.',
    },
    {
      type: 'deep-dive',
      title: 'Why "phasor" and not "ramp"?',
      content: [
        {
          type: 'prose',
          text:
            'In signal processing, a *phasor* is the abstract notion of "where in the cycle ' +
            'are we?" — independent of how that position is rendered. uSEQ exposes this directly.',
        },
      ],
    },
    {
      type: 'reference-table',
      rows: [
        { name: 'bar', signature: '(bar)', description: 'Phasor over one bar' },
        { name: 'beat', signature: '(beat)', description: 'Phasor over one beat' },
        { name: 'fast', signature: '(fast n sig)', description: 'Speed up signal n times' },
      ],
    },
  ],
};

const SectionDemo = () => {
  const [expanded, setExpanded] = createSignal(true);
  return (
    <div class="guide-tab" style={{ padding: '1rem' }}>
      <GuideSection
        section={sampleSection}
        expanded={expanded()}
        onToggle={() => setExpanded((p) => !p)}
      />
    </div>
  );
};

const tabs: Tab[] = [
  {
    id: 'panel-help-tab-guide-v2',
    name: 'Guide',
    content: () => <SectionDemo />,
  },
];

export default defineScenario({
  category: 'Help & Reference / Guide',
  name: 'GuideSection: collapsible with content blocks',
  type: 'contract',
  sourceFiles: [
    'src/ui/help/guide/GuideSection.tsx',
    'src/ui/help/guide/contentBlocks.tsx',
    'src/ui/help/guide/guideTypes.ts',
  ],
  description:
    'Real <GuideSection> rendered inside HelpPanel with a Section containing prose, ' +
    'try-it, tip, deep-dive, and reference-table blocks. Click the header to toggle ' +
    'collapse/expand. The deep-dive block has its own independent toggle. Playground ' +
    'blocks are runtime-coupled and tested separately.',
  component: {
    render: () => <HelpPanel tabs={tabs} />,
    loadAppStyles: true,
    width: 480,
    height: 600,
  },
});
