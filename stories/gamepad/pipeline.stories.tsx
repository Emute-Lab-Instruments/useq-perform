import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';

import {
  useGamepadPipeline,
  type Paradigm,
  type PipelineEvent,
} from '@src/lib/gamepad/storybook';
import type {
  AxisFrame,
  ButtonName,
  GestureEvent,
  Layer,
  LogicalEvent,
} from '@src/lib/gamepad/types';
import {
  modalShiftLayers,
  leaderLayers,
  hydraLayers,
  chordHeavyLayers,
} from '@src/lib/gamepad';

// ---------------------------------------------------------------------------
// Paradigm registry
//
// Look up paradigms by name from the imported layer arrays — no hardcoded
// switch. The helper itself already maps `Paradigm` to its layer set; this
// table just exposes the raw layer arrays for the sidebar (active layer
// stack) display.
// ---------------------------------------------------------------------------

const PARADIGM_LAYERS: Record<Paradigm, readonly Layer[]> = {
  'modal-shift': modalShiftLayers,
  'leader': leaderLayers,
  'hydra': hydraLayers,
  'chord-heavy': chordHeavyLayers,
};

const PARADIGM_NAMES = Object.keys(PARADIGM_LAYERS) as readonly Paradigm[];

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function fmtTime(t: number): string {
  // Trim to 1ms resolution and the last 6 digits (seconds.millis).
  const ms = Math.round(t);
  return String(ms % 1_000_000).padStart(6, '0');
}

function fmtLogical(e: LogicalEvent): string {
  if (e.kind === 'press') return `press ${e.btn}`;
  if (e.kind === 'release') return `release ${e.btn}`;
  return `axis ${e.stick} (${e.x.toFixed(2)}, ${e.y.toFixed(2)})`;
}

function fmtGesture(g: GestureEvent['gesture']): string {
  switch (g.kind) {
    case 'tap': return `tap ${g.btn}`;
    case 'hold': return `hold ${g.btn}`;
    case 'held': return `held ${g.btn} ×${g.n}`;
    case 'doubleTap': return `doubleTap ${g.btn}`;
    case 'chord': return `chord [${g.btns.join('+')}]`;
    case 'flick': return `flick ${g.stick} ${g.dir}`;
  }
}

function fmtAxis(f: AxisFrame): string {
  return `${f.stick} (${f.x.toFixed(2)}, ${f.y.toFixed(2)})`;
}

function stageColor(kind: PipelineEvent['kind']): string {
  switch (kind) {
    case 'logical': return '#7aa2f7';   // blue
    case 'gesture': return '#9ece6a';   // green
    case 'action':  return '#e0af68';   // amber
    case 'axis':    return '#bb9af7';   // purple
  }
}

function stageLabel(kind: PipelineEvent['kind']): string {
  switch (kind) {
    case 'logical': return 'L1';
    case 'gesture': return 'L2';
    case 'action':  return 'L3';
    case 'axis':    return 'AX';
  }
}

function eventBody(ev: PipelineEvent): string {
  switch (ev.kind) {
    case 'logical': return fmtLogical(ev.event);
    case 'gesture': return fmtGesture(ev.gesture.gesture);
    case 'action':  return ev.action;
    case 'axis':    return fmtAxis(ev.frame);
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface PipelineLogProps {
  readonly paradigm: Paradigm;
  readonly paused: boolean;
}

function PipelineLog(props: PipelineLogProps) {
  // The helper takes `paradigm` once at construction. To support live
  // paradigm switching, we tear down + rebuild the pipeline whenever
  // `props.paradigm` changes.
  const [events, setEvents] = createSignal<readonly PipelineEvent[]>([]);
  const [held, setHeld] = createSignal<readonly ButtonName[]>([]);
  const [lastInputAt, setLastInputAt] = createSignal<number | null>(null);

  let scrollEl: HTMLDivElement | undefined;

  createEffect(
    on(
      () => props.paradigm,
      (paradigm) => {
        setEvents([]);
        setHeld([]);
        setLastInputAt(null);

        const pipeline = useGamepadPipeline({ paradigm, maxEvents: 200 });

        // Mirror the helper's events into local state so we can also
        // derive sidebar values (held buttons, last input). The nested
        // createEffect is owned by the outer effect's reactive scope and
        // gets disposed automatically when paradigm changes.
        createEffect(() => {
          const evs = pipeline.events();
          setEvents(evs);

          // Recompute held set from the full visible event tail. This is a
          // best-effort visualisation — the helper's internal state is the
          // truth, but exposing it would mean changing the public surface.
          const set = new Set<ButtonName>();
          let last: number | null = null;
          for (const ev of evs) {
            if (ev.kind === 'logical') {
              if (ev.event.kind === 'press') set.add(ev.event.btn);
              else if (ev.event.kind === 'release') set.delete(ev.event.btn);
            }
            if (last === null || ev.t > last) last = ev.t;
          }
          setHeld([...set]);
          setLastInputAt(last);
        });

        // Tear down the pipeline (and its polling interval) whenever the
        // outer effect re-runs (paradigm changed) or the component unmounts.
        onCleanup(() => {
          pipeline.dispose();
        });
      },
    ),
  );

  // Auto-scroll on new events unless paused.
  createEffect(() => {
    // Track events() so this effect re-runs on every new event.
    events();
    if (props.paused) return;
    queueMicrotask(() => {
      if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
    });
  });

  const layerStack = createMemo(() =>
    PARADIGM_LAYERS[props.paradigm].map((l) => l.name as unknown as string),
  );

  return (
    <div
      style={{
        display: 'grid',
        'grid-template-columns': '1fr 280px',
        gap: '12px',
        padding: '16px',
        background: '#0b1220',
        color: '#c0c0e0',
        'font-family': 'monospace',
        'font-size': '12px',
        height: '100vh',
        'box-sizing': 'border-box',
      }}
    >
      {/* Event log */}
      <div
        style={{
          display: 'flex',
          'flex-direction': 'column',
          'min-height': 0,
          background: '#10182a',
          border: '1px solid #1f2a44',
          'border-radius': '6px',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '8px 12px',
            'border-bottom': '1px solid #1f2a44',
            display: 'flex',
            'justify-content': 'space-between',
            'align-items': 'center',
          }}
        >
          <strong style={{ color: '#fff' }}>Pipeline events</strong>
          <span style={{ color: '#7080a0' }}>
            paradigm: {props.paradigm} · {props.paused ? 'paused' : 'live'} ·
            {' '}
            {events().length} / 200
          </span>
        </div>
        <div
          ref={scrollEl}
          style={{
            flex: 1,
            overflow: 'auto',
            padding: '8px 12px',
            'line-height': '18px',
          }}
        >
          <Show
            when={events().length > 0}
            fallback={
              <div style={{ color: '#506080', 'font-style': 'italic' }}>
                Connect a gamepad and press something — events will appear here.
              </div>
            }
          >
            <For each={events()}>
              {(ev) => (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <span style={{ color: '#506080', width: '70px' }}>
                    {fmtTime(ev.t)}
                  </span>
                  <span
                    style={{
                      color: stageColor(ev.kind),
                      width: '28px',
                      'font-weight': 'bold',
                    }}
                  >
                    {stageLabel(ev.kind)}
                  </span>
                  <span style={{ color: stageColor(ev.kind) }}>
                    {eventBody(ev)}
                  </span>
                </div>
              )}
            </For>
          </Show>
        </div>
      </div>

      {/* Sidebar */}
      <div
        style={{
          display: 'flex',
          'flex-direction': 'column',
          gap: '12px',
        }}
      >
        <SidebarPanel title="Held buttons">
          <Show
            when={held().length > 0}
            fallback={<span style={{ color: '#506080' }}>(none)</span>}
          >
            <div style={{ display: 'flex', 'flex-wrap': 'wrap', gap: '4px' }}>
              <For each={held()}>
                {(btn) => (
                  <span
                    style={{
                      padding: '2px 6px',
                      background: '#1f2a44',
                      'border-radius': '3px',
                      color: '#7aa2f7',
                    }}
                  >
                    {btn}
                  </span>
                )}
              </For>
            </div>
          </Show>
        </SidebarPanel>

        <SidebarPanel title="Active layer stack">
          <For each={layerStack()}>
            {(name, i) => (
              <div style={{ color: i() === 0 ? '#9ece6a' : '#c0c0e0' }}>
                {i() === 0 ? '▸ ' : '  '}{name}
              </div>
            )}
          </For>
        </SidebarPanel>

        <SidebarPanel title="Last input">
          <Show
            when={lastInputAt() !== null}
            fallback={<span style={{ color: '#506080' }}>(none)</span>}
          >
            <span style={{ color: '#e0af68' }}>
              t = {fmtTime(lastInputAt() as number)}
            </span>
          </Show>
        </SidebarPanel>

        <SidebarPanel title="Stage legend">
          <LegendRow color={stageColor('logical')} label="L1 logical (press/release/axis)" />
          <LegendRow color={stageColor('gesture')} label="L2 gesture (tap/hold/chord/flick…)" />
          <LegendRow color={stageColor('action')}  label="L3 resolved ActionId" />
          <LegendRow color={stageColor('axis')}    label="AX axis frame" />
        </SidebarPanel>
      </div>
    </div>
  );
}

function SidebarPanel(props: { title: string; children: unknown }) {
  return (
    <div
      style={{
        background: '#10182a',
        border: '1px solid #1f2a44',
        'border-radius': '6px',
        padding: '8px 12px',
      }}
    >
      <div
        style={{
          color: '#fff',
          'font-weight': 'bold',
          'margin-bottom': '6px',
          'font-size': '11px',
          'text-transform': 'uppercase',
          'letter-spacing': '0.5px',
        }}
      >
        {props.title}
      </div>
      {props.children as unknown as never}
    </div>
  );
}

function LegendRow(props: { color: string; label: string }) {
  return (
    <div style={{ display: 'flex', 'align-items': 'center', gap: '6px' }}>
      <span
        style={{
          width: '10px',
          height: '10px',
          background: props.color,
          'border-radius': '2px',
        }}
      />
      <span style={{ color: '#c0c0e0' }}>{props.label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Storybook meta
// ---------------------------------------------------------------------------

interface StoryArgs {
  paradigm: Paradigm;
  paused: boolean;
}

const meta: Meta<StoryArgs> = {
  title: 'Gamepad/PipelineLog',
  parameters: { layout: 'fullscreen' },
  argTypes: {
    paradigm: {
      control: { type: 'select' },
      options: PARADIGM_NAMES,
      description:
        'Layer paradigm to load. Switching tears down the pipeline and ' +
        'rebuilds it with the new layer set.',
    },
    paused: {
      control: { type: 'boolean' },
      description: 'Pause auto-scroll. Events still record up to 200 entries.',
    },
  },
  args: {
    paradigm: 'modal-shift',
    paused: false,
  },
  render: (args) => <PipelineLog paradigm={args.paradigm} paused={args.paused} />,
};
export default meta;

type Story = StoryObj<StoryArgs>;

/** Default modal-shift paradigm (face buttons map to a single stable layer). */
export const ModalShift: Story = { args: { paradigm: 'modal-shift', paused: false } };

/** Leader paradigm (face buttons gate transient sub-layers). */
export const Leader: Story = { args: { paradigm: 'leader', paused: false } };

/** Hydra paradigm (multiple modal sub-layers reachable from base). */
export const Hydra: Story = { args: { paradigm: 'hydra', paused: false } };

/** Chord-heavy paradigm (multi-button chords for most actions). */
export const ChordHeavy: Story = { args: { paradigm: 'chord-heavy', paused: false } };
