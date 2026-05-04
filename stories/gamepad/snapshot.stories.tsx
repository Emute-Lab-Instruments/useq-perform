// Storybook live readout of every connected gamepad. Pure presentational —
// drives itself from `useGamepadSnapshot()` (A1 helper) for the primary pad,
// plus a direct `navigator.getGamepads()` poll to enumerate additional pads
// so multiple panels can stack vertically. No app coupling, no runtime,
// no editor — only the gamepad foundation layer types.

import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import {
  createSignal,
  createMemo,
  For,
  Show,
  onCleanup,
  type Accessor,
  type JSX,
} from 'solid-js';

import { useGamepadSnapshot } from '@src/lib/gamepad/storybook';
import {
  BUTTON_MAP,
  type GamepadSnapshot,
  type ButtonState,
} from '@src/lib/gamepad/gamepadManager';
import { BUTTON_ORDER, type ButtonName } from '@src/lib/gamepad/types';

// ---------------------------------------------------------------------------
// Constants & types
// ---------------------------------------------------------------------------

const STICK_NAMES = ['LeftStick', 'RightStick'] as const;
type StickName = typeof STICK_NAMES[number];

/**
 * DPad direction names — drawn from BUTTON_ORDER but presented as a 4-way
 * indicator instead of plain buttons.
 */
const DPAD_DIRECTIONS: readonly ButtonName[] = ['Up', 'Down', 'Left', 'Right'];

/**
 * Buttons we exclude from the generic button grid because they are surfaced
 * elsewhere (DPad, stick presses get their own treatment if desired).
 */
const DPAD_SET = new Set<ButtonName>(DPAD_DIRECTIONS);

const POLL_MS = 50;

// Press-time tracking — entries keyed by `${gamepadIndex}::${buttonName}`.
type PressTimes = Map<string, number>;

interface PadView {
  readonly snapshot: GamepadSnapshot;
  /** held-since timestamp (performance.now) per button on this pad */
  readonly heldSince: ReadonlyMap<ButtonName, number>;
}

// ---------------------------------------------------------------------------
// Multi-pad polling — uses A1's useGamepadSnapshot for the primary pad and
// a parallel poll for additional connected pads.
// ---------------------------------------------------------------------------

interface MultiPadPollOptions {
  readonly pollIntervalMs?: number;
}

/**
 * Polls navigator.getGamepads() and returns a list of normalised snapshots
 * for every connected gamepad. Press-times are tracked locally and exposed
 * per pad. Cleans up on Solid scope dispose.
 */
function useAllGamepadSnapshots(
  options: MultiPadPollOptions = {},
): Accessor<readonly PadView[]> {
  const pollIntervalMs = options.pollIntervalMs ?? POLL_MS;
  const [pads, setPads] = createSignal<readonly PadView[]>([]);

  // Track press-onset timestamps across polls.
  const pressTimes: PressTimes = new Map();

  const buttonNames = Object.values(BUTTON_MAP);

  function buttonKey(idx: number, name: ButtonName): string {
    return `${idx}::${name}`;
  }

  function normalise(gamepad: Gamepad | null, now: number): GamepadSnapshot | null {
    if (!gamepad || !gamepad.connected) return null;

    const buttons: Record<string, ButtonState> = {};
    for (const name of buttonNames) {
      buttons[name] = { pressed: false, value: 0 };
    }
    const rawButtons = gamepad.buttons ?? [];
    for (let i = 0; i < rawButtons.length; i += 1) {
      const b = rawButtons[i];
      if (!b) continue;
      const name = BUTTON_MAP[i] ?? `Button${i}`;
      buttons[name] = {
        pressed: Boolean(b.pressed) || Number(b.value ?? 0) >= 0.5,
        value: Number(b.value ?? 0),
      };
    }

    const axes: Record<string, number> = {
      LeftStickX: 0,
      LeftStickY: 0,
      RightStickX: 0,
      RightStickY: 0,
    };
    const rawAxes = gamepad.axes ?? [];
    const axisLookup: Record<number, string> = {
      0: 'LeftStickX',
      1: 'LeftStickY',
      2: 'RightStickX',
      3: 'RightStickY',
    };
    for (let i = 0; i < rawAxes.length; i += 1) {
      const name = axisLookup[i] ?? `Axis${i}`;
      const v = typeof rawAxes[i] === 'number' ? rawAxes[i] : 0;
      axes[name] = Math.abs(v) < 0.05 ? 0 : v;
    }

    return {
      connected: true,
      id: gamepad.id ?? '',
      index: typeof gamepad.index === 'number' ? gamepad.index : null,
      timestamp: now,
      buttons,
      axes,
    };
  }

  function tick(): void {
    const now =
      typeof performance !== 'undefined' && performance.now
        ? performance.now()
        : Date.now();

    const raw =
      typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function'
        ? navigator.getGamepads()
        : [];

    const liveIndices = new Set<number>();
    const views: PadView[] = [];

    for (let i = 0; i < raw.length; i += 1) {
      const snap = normalise(raw[i] ?? null, now);
      if (!snap) continue;
      const idx = snap.index ?? i;
      liveIndices.add(idx);

      const heldSince = new Map<ButtonName, number>();
      for (const name of BUTTON_ORDER) {
        const state = snap.buttons[name];
        const k = buttonKey(idx, name);
        if (state?.pressed) {
          if (!pressTimes.has(k)) pressTimes.set(k, now);
          const since = pressTimes.get(k);
          if (since !== undefined) heldSince.set(name, since);
        } else {
          pressTimes.delete(k);
        }
      }
      views.push({ snapshot: snap, heldSince });
    }

    // Garbage-collect press-times for disconnected pads.
    for (const k of pressTimes.keys()) {
      const idx = Number(k.split('::')[0]);
      if (!liveIndices.has(idx)) pressTimes.delete(k);
    }

    setPads(views);
  }

  tick();
  const id = setInterval(tick, pollIntervalMs);
  onCleanup(() => clearInterval(id));

  return pads;
}

// ---------------------------------------------------------------------------
// Presentational helpers
// ---------------------------------------------------------------------------

const COLORS = {
  bg: '#0a0a14',
  panel: '#13131f',
  border: '#2a2a3a',
  text: '#e0e0e8',
  muted: '#7a7a8c',
  accent: '#00ff41',
  accentDim: '#1a4d28',
  warn: '#ffaa00',
  off: '#2a2a3a',
};

const BASE_FONT = "ui-monospace, Menlo, Consolas, 'DejaVu Sans Mono', monospace";

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function ButtonChip(props: {
  name: ButtonName;
  state: ButtonState | undefined;
  heldSinceMs: number | undefined;
  now: number;
}): JSX.Element {
  const pressed = (): boolean => Boolean(props.state?.pressed);
  const held = (): number =>
    props.heldSinceMs !== undefined ? props.now - props.heldSinceMs : 0;
  return (
    <div
      style={{
        display: 'flex',
        'flex-direction': 'column',
        'align-items': 'center',
        'justify-content': 'center',
        padding: '6px 4px',
        'border-radius': '4px',
        border: `1px solid ${pressed() ? COLORS.accent : COLORS.border}`,
        background: pressed() ? COLORS.accentDim : 'transparent',
        color: pressed() ? COLORS.accent : COLORS.muted,
        'font-family': BASE_FONT,
        'font-size': '11px',
        'min-width': '52px',
        transition: 'background 60ms linear, border-color 60ms linear',
      }}
    >
      <div style={{ 'font-weight': pressed() ? 'bold' : 'normal' }}>{props.name}</div>
      <div style={{ 'font-size': '9px', 'margin-top': '2px', height: '11px' }}>
        {pressed() ? fmtMs(held()) : ' '}
      </div>
    </div>
  );
}

function StickPanel(props: {
  name: StickName;
  x: number;
  y: number;
}): JSX.Element {
  const mag = (): number => Math.min(1, Math.hypot(props.x, props.y));
  const R = 48; // visualizer radius
  const cx = (): number => R + props.x * R;
  // Browser axes: y down is +1; we render y down too.
  const cy = (): number => R + props.y * R;

  return (
    <div
      style={{
        display: 'flex',
        'flex-direction': 'column',
        'align-items': 'center',
        gap: '4px',
        padding: '8px',
        border: `1px solid ${COLORS.border}`,
        'border-radius': '4px',
      }}
    >
      <div style={{ color: COLORS.muted, 'font-size': '11px' }}>{props.name}</div>
      <svg
        width={R * 2}
        height={R * 2}
        viewBox={`0 0 ${R * 2} ${R * 2}`}
        style={{ display: 'block' }}
      >
        <circle
          cx={R}
          cy={R}
          r={R - 1}
          fill="transparent"
          stroke={COLORS.border}
          stroke-width="1"
        />
        <line x1={R} y1={0} x2={R} y2={R * 2} stroke={COLORS.border} stroke-width="1" />
        <line x1={0} y1={R} x2={R * 2} y2={R} stroke={COLORS.border} stroke-width="1" />
        <circle
          cx={cx()}
          cy={cy()}
          r="5"
          fill={mag() > 0.05 ? COLORS.accent : COLORS.muted}
        />
      </svg>
      <div
        style={{
          'font-size': '10px',
          color: COLORS.text,
          'font-family': BASE_FONT,
          'text-align': 'center',
          'line-height': '1.4',
        }}
      >
        x: {props.x.toFixed(2)} y: {props.y.toFixed(2)}
      </div>
      {/* magnitude bar */}
      <div
        style={{
          width: `${R * 2}px`,
          height: '6px',
          background: COLORS.off,
          'border-radius': '3px',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${(mag() * 100).toFixed(1)}%`,
            height: '100%',
            background: mag() > 0.05 ? COLORS.accent : COLORS.muted,
            transition: 'width 40ms linear',
          }}
        />
      </div>
    </div>
  );
}

function DPadIndicator(props: {
  buttons: Record<string, ButtonState>;
}): JSX.Element {
  const isOn = (n: ButtonName): boolean => Boolean(props.buttons[n]?.pressed);
  const cell = (active: boolean): JSX.Element => (
    <div
      style={{
        width: '24px',
        height: '24px',
        background: active ? COLORS.accent : COLORS.off,
        'border-radius': '3px',
        transition: 'background 60ms linear',
      }}
    />
  );
  return (
    <div
      style={{
        display: 'grid',
        'grid-template-columns': '24px 24px 24px',
        'grid-template-rows': '24px 24px 24px',
        gap: '4px',
        padding: '8px',
        border: `1px solid ${COLORS.border}`,
        'border-radius': '4px',
      }}
    >
      <div />
      {cell(isOn('Up'))}
      <div />
      {cell(isOn('Left'))}
      <div
        style={{
          width: '24px',
          height: '24px',
          background: COLORS.panel,
          border: `1px solid ${COLORS.border}`,
          'border-radius': '3px',
          color: COLORS.muted,
          'font-size': '10px',
          display: 'flex',
          'align-items': 'center',
          'justify-content': 'center',
          'font-family': BASE_FONT,
        }}
      >
        DP
      </div>
      {cell(isOn('Right'))}
      <div />
      {cell(isOn('Down'))}
      <div />
    </div>
  );
}

function GamepadPanel(props: {
  view: PadView;
  now: number;
}): JSX.Element {
  const snap = (): GamepadSnapshot => props.view.snapshot;

  const heldFor = (name: ButtonName): number | undefined =>
    props.view.heldSince.get(name);

  const generalButtons = createMemo<readonly ButtonName[]>(() =>
    BUTTON_ORDER.filter((n) => !DPAD_SET.has(n)),
  );

  return (
    <div
      style={{
        display: 'flex',
        'flex-direction': 'column',
        gap: '12px',
        padding: '14px',
        background: COLORS.panel,
        border: `1px solid ${COLORS.border}`,
        'border-radius': '6px',
        color: COLORS.text,
        'font-family': BASE_FONT,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          'align-items': 'baseline',
          'justify-content': 'space-between',
          'border-bottom': `1px solid ${COLORS.border}`,
          'padding-bottom': '8px',
        }}
      >
        <div style={{ display: 'flex', gap: '12px', 'align-items': 'baseline' }}>
          <span style={{ color: COLORS.accent, 'font-weight': 'bold' }}>
            CONNECTED
          </span>
          <span style={{ color: COLORS.muted, 'font-size': '12px' }}>
            index: {snap().index ?? '?'}
          </span>
        </div>
        <div
          style={{
            color: COLORS.muted,
            'font-size': '11px',
            'max-width': '60%',
            overflow: 'hidden',
            'text-overflow': 'ellipsis',
            'white-space': 'nowrap',
          }}
          title={snap().id}
        >
          {snap().id || '<unnamed>'}
        </div>
      </div>

      {/* Sticks + DPad row */}
      <div style={{ display: 'flex', gap: '12px', 'flex-wrap': 'wrap' }}>
        <StickPanel
          name="LeftStick"
          x={snap().axes.LeftStickX ?? 0}
          y={snap().axes.LeftStickY ?? 0}
        />
        <StickPanel
          name="RightStick"
          x={snap().axes.RightStickX ?? 0}
          y={snap().axes.RightStickY ?? 0}
        />
        <DPadIndicator buttons={snap().buttons} />
      </div>

      {/* Button grid */}
      <div
        style={{
          display: 'grid',
          'grid-template-columns': 'repeat(auto-fill, minmax(56px, 1fr))',
          gap: '6px',
        }}
      >
        <For each={generalButtons()}>
          {(name) => (
            <ButtonChip
              name={name}
              state={snap().buttons[name]}
              heldSinceMs={heldFor(name)}
              now={props.now}
            />
          )}
        </For>
      </div>
    </div>
  );
}

function NoGamepadPlaceholder(): JSX.Element {
  return (
    <div
      style={{
        padding: '24px',
        background: COLORS.panel,
        border: `1px dashed ${COLORS.border}`,
        'border-radius': '6px',
        color: COLORS.muted,
        'font-family': BASE_FONT,
        'text-align': 'center',
      }}
    >
      <div style={{ 'font-size': '13px', 'margin-bottom': '6px' }}>
        Waiting for gamepad…
      </div>
      <div style={{ 'font-size': '11px' }}>
        Plug in a controller and press any button to wake it up.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top-level visualizer component
// ---------------------------------------------------------------------------

function GamepadSnapshotVisualizer(): JSX.Element {
  // Drive primary pad off A1's helper so we exercise the documented entry
  // point. Additional pads come from a parallel poll.
  const primary = useGamepadSnapshot({ pollIntervalMs: POLL_MS });
  const all = useAllGamepadSnapshots({ pollIntervalMs: POLL_MS });

  // Tick a clock signal so held-duration text re-renders without each pad
  // having to trigger reactivity on every frame.
  const [now, setNow] = createSignal<number>(
    typeof performance !== 'undefined' && performance.now
      ? performance.now()
      : Date.now(),
  );
  const clockId = setInterval(() => {
    setNow(
      typeof performance !== 'undefined' && performance.now
        ? performance.now()
        : Date.now(),
    );
  }, POLL_MS);
  onCleanup(() => clearInterval(clockId));

  const hasAny = createMemo(() => all().length > 0 || primary() !== null);

  return (
    <div
      style={{
        display: 'flex',
        'flex-direction': 'column',
        gap: '12px',
        padding: '16px',
        background: COLORS.bg,
        'min-height': '100vh',
        'box-sizing': 'border-box',
      }}
    >
      <Show when={hasAny()} fallback={<NoGamepadPlaceholder />}>
        <For each={all()}>
          {(view) => <GamepadPanel view={view} now={now()} />}
        </For>
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Static fallback for the NoGamepad story — does NOT call useGamepadSnapshot
// (which has setInterval side-effects); renders the placeholder directly so
// the story is fully deterministic.
// ---------------------------------------------------------------------------

function StaticNoGamepadView(): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        'flex-direction': 'column',
        gap: '12px',
        padding: '16px',
        background: COLORS.bg,
        'min-height': '100vh',
        'box-sizing': 'border-box',
      }}
    >
      <NoGamepadPlaceholder />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Storybook meta + stories
// ---------------------------------------------------------------------------

const meta: Meta = {
  title: 'Gamepad/SnapshotVisualizer',
  tags: ['autodocs', 'gamepad'],
  parameters: { layout: 'fullscreen' },
};
export default meta;
type Story = StoryObj;

/**
 * Live readout of every connected gamepad. Drives itself from
 * `useGamepadSnapshot()` for the primary pad and a parallel
 * `navigator.getGamepads()` poll for any additional pads. Multiple pads
 * stack vertically.
 */
export const Live: Story = {
  render: () => <GamepadSnapshotVisualizer />,
};

/**
 * Deterministic "waiting for gamepad" placeholder. Renders the empty-state
 * UI without invoking any gamepad polling — useful for snapshot review and
 * a11y checks.
 */
export const NoGamepad: Story = {
  render: () => <StaticNoGamepadView />,
};
