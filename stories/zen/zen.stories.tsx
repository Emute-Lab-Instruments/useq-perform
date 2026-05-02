import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { onMount, onCleanup, createSignal } from 'solid-js';
import ZenGrid from '@src/zen/ZenGrid';
import ZenExercise from '@src/zen/ZenExercise';
import ZenMode from '@src/zen/ZenMode';
import { enterExercise, returnToGrid, setGuidanceMode, type GuidanceMode } from '@src/zen/store';
import { exercises } from '@src/zen/exercises';
import '@src/zen/zen.css';

/** Force the body class so the .zen-active panel-suppression rules don't fire. */
function preventGlobalZenStyles() {
  document.body.classList.remove('zen-active');
}

const meta: Meta = {
  title: 'Zen',
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
};
export default meta;
type Story = StoryObj;

/**
 * Grid view of all exercises by category. Use the focusedRow / focusedCol
 * controls to highlight a card. Clicking a card calls enterExercise() but
 * the navigation effect lives in ZenMode — see the FullZenMode story.
 */
export const Grid: Story = {
  render: () => {
    const [row, setRow] = createSignal(0);
    const [col, setCol] = createSignal(0);
    onMount(() => preventGlobalZenStyles());
    return (
      <div style={{ height: '720px', width: '100%', overflow: 'auto', background: '#0b1220' }}>
        <div
          style={{
            position: 'sticky',
            top: '0',
            'z-index': 10,
            background: '#1a1a2e',
            padding: '8px 16px',
            display: 'flex',
            gap: '12px',
            color: '#c0c0e0',
            'font-family': 'monospace',
            'font-size': '12px',
            'border-bottom': '1px solid #333',
          }}
        >
          <label>row <input type="number" min={0} max={6} value={row()} onInput={(e) => setRow(+e.currentTarget.value)} style={{ width: '60px' }} /></label>
          <label>col <input type="number" min={0} max={20} value={col()} onInput={(e) => setCol(+e.currentTarget.value)} style={{ width: '60px' }} /></label>
        </div>
        <ZenGrid onExit={() => alert('exit')} focusedRow={row()} focusedCol={col()} />
      </div>
    );
  },
};

/**
 * Single ZenExercise — pre-selects the first exercise in the registry and
 * mounts the dual-editor view (start vs target with structural extensions).
 */
export const Exercise: Story = {
  render: () => {
    onMount(() => {
      preventGlobalZenStyles();
      enterExercise(exercises[0].id);
    });
    onCleanup(() => returnToGrid());
    return (
      <div style={{ height: '720px', width: '100%', background: '#0b1220' }}>
        <ZenExercise />
      </div>
    );
  },
};

/**
 * Exercise from the slurp-and-barf category — different start code shape so
 * you can compare structural transformations.
 */
export const ExerciseSlurp: Story = {
  render: () => {
    const slurp = exercises.find((e) => e.category === 'slurp-barf') ?? exercises[0];
    onMount(() => {
      preventGlobalZenStyles();
      enterExercise(slurp.id);
    });
    onCleanup(() => returnToGrid());
    return (
      <div style={{ height: '720px', width: '100%', background: '#0b1220' }}>
        <ZenExercise />
      </div>
    );
  },
};

/**
 * Exercise in `guided` mode — wrong actions are blocked so the learner
 * can only execute the correct sequence (default mode).
 */
function GuidedHarness(props: { mode: GuidanceMode }) {
  onMount(() => {
    preventGlobalZenStyles();
    setGuidanceMode(props.mode);
    enterExercise(exercises[0].id);
  });
  onCleanup(() => {
    returnToGrid();
    setGuidanceMode('guided');
  });
  return (
    <div style={{ height: '720px', width: '100%', background: '#0b1220' }}>
      <ZenExercise />
    </div>
  );
}

export const ExerciseGuided: Story = {
  render: () => <GuidedHarness mode="guided" />,
};

/** `hints` mode — wrong actions are allowed but the next-step hint is shown. */
export const ExerciseHints: Story = {
  render: () => <GuidedHarness mode="hints" />,
};

/** `bare` mode — no guidance at all; just the editor and the target. */
export const ExerciseBare: Story = {
  render: () => <GuidedHarness mode="bare" />,
};

/**
 * Full ZenMode orchestrator — handles grid ↔ exercise transitions
 * via keyboard or gamepad input. Click a card or press Enter to enter an
 * exercise; press Escape to return to the grid.
 *
 * Note: the gamepad pipeline starts on mount; in Storybook with no
 * controller connected, only keyboard input is active.
 */
export const FullZenMode: Story = {
  render: () => {
    onMount(() => returnToGrid());
    onCleanup(() => {
      returnToGrid();
      document.body.classList.remove('zen-active');
    });
    return (
      <div style={{ height: '720px', width: '100%', background: '#0b1220', overflow: 'auto', position: 'relative' }}>
        <ZenMode />
      </div>
    );
  },
};
