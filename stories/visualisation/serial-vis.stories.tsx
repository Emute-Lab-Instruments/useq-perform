import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { onMount, onCleanup } from 'solid-js';
import { SerialVis } from '@src/ui/SerialVis';
import {
  updateExpressions,
  updateTime,
  updateSettings,
  type VisExpression,
  type VisSample,
} from '@src/utils/visualisationStore';

/** Build a sample window from t=-halfWindow .. t=+halfWindow at given step. */
function buildSamples(
  fn: (t: number) => number,
  start: number,
  end: number,
  step = 0.05,
): VisSample[] {
  const out: VisSample[] = [];
  for (let t = start; t <= end; t += step) {
    out.push({ time: t, value: fn(t) });
  }
  return out;
}

interface SeedConfig {
  expressions: Record<string, VisExpression>;
  windowDuration?: number;
  /** If set, animate `displayTime` from 0 → animateUntil over `animateDurationSec`. */
  animateUntil?: number;
}

function SerialVisHarness(seed: SeedConfig) {
  let raf: number | undefined;

  onMount(() => {
    updateSettings({
      windowDuration: seed.windowDuration ?? 10,
      sampleCount: 100,
      lineWidth: 1.5,
      futureDashed: true,
      futureMaskOpacity: 0.35,
      futureMaskWidth: 12,
      circularOffset: 0,
      futureLeadSeconds: 1,
      digitalLaneGap: 4,
    });
    updateExpressions(seed.expressions);

    if (seed.animateUntil !== undefined) {
      const start = performance.now();
      const sweep = seed.animateUntil;
      const tick = () => {
        const elapsed = (performance.now() - start) / 1000;
        const t = (elapsed % sweep);
        updateTime(t);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    } else {
      updateTime(5);
    }
  });

  onCleanup(() => {
    if (raf !== undefined) cancelAnimationFrame(raf);
    updateExpressions({});
  });

  return (
    <div style={{ width: '720px', height: '320px', background: '#0a0a14', 'border-radius': '4px' }}>
      <SerialVis />
    </div>
  );
}

const meta: Meta = {
  title: 'Visualisation/SerialVis',
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
};
export default meta;
type Story = StoryObj;

/** Two analog channels animated through the window. */
export const AnalogPair: Story = {
  render: () => (
    <SerialVisHarness
      windowDuration={4}
      animateUntil={8}
      expressions={{
        a1: {
          exprType: 'a1',
          expressionText: '(sine 0.5)',
          color: '#00ff41',
          samples: buildSamples((t) => 0.5 + 0.45 * Math.sin(t * Math.PI), -2, 10),
        },
        a2: {
          exprType: 'a2',
          expressionText: '(tri 1)',
          color: '#1adbdb',
          samples: buildSamples((t) => 0.5 + 0.4 * Math.sin(t * Math.PI * 2 + 0.8), -2, 10),
        },
      }}
    />
  ),
};

/** Mixed analog + digital — exercises the digital lane layout. */
export const Mixed: Story = {
  render: () => (
    <SerialVisHarness
      windowDuration={4}
      animateUntil={8}
      expressions={{
        a1: {
          exprType: 'a1',
          expressionText: '(sine 0.5)',
          color: '#00ff41',
          samples: buildSamples((t) => 0.5 + 0.45 * Math.sin(t * Math.PI), -2, 10),
        },
        d1: {
          exprType: 'd1',
          expressionText: '(> (sine 0.5) 0)',
          color: '#ff5500',
          samples: buildSamples((t) => (Math.sin(t * Math.PI) > 0 ? 1 : 0), -2, 10, 0.02),
        },
        d2: {
          exprType: 'd2',
          expressionText: '(euclid 5 8)',
          color: '#ffee33',
          samples: buildSamples((t) => {
            const beat = Math.floor(((t + 2) * 2) % 8);
            const pattern = [1, 0, 1, 0, 1, 0, 1, 1];
            return pattern[beat] ?? 0;
          }, -2, 10, 0.02),
        },
      }}
    />
  ),
};

/** Empty state shows the "No expressions selected" message. */
export const Empty: Story = {
  render: () => (
    <SerialVisHarness
      expressions={{}}
    />
  ),
};

/** Full mix: 4 analog + 3 digital channels — exercises the entire layout. */
export const FullMix: Story = {
  render: () => (
    <SerialVisHarness
      windowDuration={4}
      animateUntil={8}
      expressions={{
        a1: {
          exprType: 'a1',
          expressionText: '(sine 0.5)',
          color: '#00ff41',
          samples: buildSamples((t) => 0.5 + 0.45 * Math.sin(t * Math.PI), -2, 10),
        },
        a2: {
          exprType: 'a2',
          expressionText: '(tri 1)',
          color: '#1adbdb',
          samples: buildSamples((t) => 0.5 + 0.4 * Math.sin(t * Math.PI * 2 + 0.8), -2, 10),
        },
        a3: {
          exprType: 'a3',
          expressionText: '(sqr 0.7)',
          color: '#ffaa00',
          samples: buildSamples((t) => 0.5 + 0.4 * Math.tanh(Math.sin(t * Math.PI * 1.4) * 4), -2, 10),
        },
        a4: {
          exprType: 'a4',
          expressionText: '(phasor 0.5)',
          color: '#ff0080',
          samples: buildSamples((t) => ((t * 0.5) % 1 + 1) % 1, -2, 10),
        },
        d1: {
          exprType: 'd1',
          expressionText: '(> (sine 0.5) 0)',
          color: '#ff5500',
          samples: buildSamples((t) => (Math.sin(t * Math.PI) > 0 ? 1 : 0), -2, 10, 0.02),
        },
        d2: {
          exprType: 'd2',
          expressionText: '(euclid 5 8)',
          color: '#ffee33',
          samples: buildSamples((t) => {
            const beat = Math.floor(((t + 2) * 2) % 8);
            return ([1, 0, 1, 0, 1, 0, 1, 1])[beat] ?? 0;
          }, -2, 10, 0.02),
        },
        d3: {
          exprType: 'd3',
          expressionText: '(beat 4)',
          color: '#0088ff',
          samples: buildSamples((t) => (Math.floor(t * 4) % 2), -2, 10, 0.02),
        },
      }}
    />
  ),
};

/** Static (no animation) — useful for inspecting past/future split rendering. */
export const StaticPaused: Story = {
  render: () => (
    <SerialVisHarness
      windowDuration={4}
      expressions={{
        a1: {
          exprType: 'a1',
          expressionText: '(sine 0.5)',
          color: '#00ff41',
          samples: buildSamples((t) => 0.5 + 0.45 * Math.sin(t * Math.PI), -2, 10),
        },
      }}
    />
  ),
};
