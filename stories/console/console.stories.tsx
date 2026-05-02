import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { onMount, onCleanup } from 'solid-js';
import { userEvent, within } from 'storybook/test';
import { ConsolePanel } from '@src/ui/console/ConsolePanel';
import {
  addConsoleMessage,
  clearConsole,
  type ConsoleMessageType,
} from '@src/utils/consoleStore';
import { settings, setSettings } from '@src/utils/settingsStore';

interface ConsoleSeed {
  type: ConsoleMessageType;
  content: string;
}

function ConsoleHarness(props: { seed: ConsoleSeed[] }) {
  onMount(() => {
    clearConsole();
    for (const m of props.seed) addConsoleMessage(m.content, m.type);
  });
  onCleanup(() => clearConsole());

  // The panel uses fixed positioning anchored to the viewport corners.
  // Wrap it in a sized fake editor area so the resize/drag handles work
  // and the user sees the panel context.
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '600px',
        background: '#0b1220',
        'border-radius': '4px',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: '0',
          left: '0',
          right: '0',
          bottom: '0',
          padding: '16px',
          color: 'rgba(255,255,255,0.3)',
          'font-family': 'monospace',
          'font-size': '12px',
        }}
      >
        Fake editor area — the console panel is anchored to bottom-right of the viewport.
        Drag its title bar to reposition, or drag the edges to resize.
      </div>
      <ConsolePanel />
    </div>
  );
}

const meta: Meta = {
  title: 'Console/ConsolePanel',
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
};
export default meta;
type Story = StoryObj;

/** Mixed log / wasm-eval / warn / error entries — exercises every message type. */
export const Mixed: Story = {
  render: () => (
    <ConsoleHarness
      seed={[
        { type: 'log', content: 'uSEQ Perform v1.2.0 ready' },
        { type: 'wasm', content: '(+ 1 2) <strong>=&gt; 3</strong>' },
        { type: 'log', content: 'Connected to interpreter' },
        { type: 'wasm', content: '(sine 0.5) <em>=&gt; #signal</em>' },
        { type: 'warn', content: 'Probe range too short, padding to 1 bar' },
        { type: 'error', content: 'Eval failed: <code>unbound symbol foo</code>' },
        { type: 'log', content: 'Auto-saved at 14:23:01' },
      ]}
    />
  ),
};

/** Empty state — only the title bar and prompt area are visible. */
export const Empty: Story = {
  render: () => <ConsoleHarness seed={[]} />,
};

/** Many messages — exercises auto-scroll, scroll indicator, and the line cap. */
export const Many: Story = {
  render: () => {
    const seed: ConsoleSeed[] = [];
    for (let i = 1; i <= 60; i++) {
      const t: ConsoleMessageType = i % 9 === 0 ? 'error' : i % 7 === 0 ? 'warn' : i % 3 === 0 ? 'wasm' : 'log';
      seed.push({
        type: t,
        content: t === 'wasm'
          ? `(eval-${i}) <strong>=&gt; ${(i / 7).toFixed(2)}</strong>`
          : `Message ${i}: ${t} entry from a long simulated session`,
      });
    }
    return <ConsoleHarness seed={seed} />;
  },
};

/** Only error/warn entries — useful to review the error and warning styling. */
export const Diagnostics: Story = {
  render: () => (
    <ConsoleHarness
      seed={[
        { type: 'warn', content: 'Probe deadline missed (frame &gt; 16ms)' },
        { type: 'error', content: 'Failed to send to module: <code>port disconnected</code>' },
        { type: 'warn', content: 'Diagnostic spans truncated to 50 entries' },
        { type: 'error', content: 'Eval threw: <code>division by zero</code>' },
      ]}
    />
  ),
};

/**
 * Collapsed-tab state — `play()` clicks the title-bar collapse button after
 * mount to drive the panel into its small docked tab. Click the tab to expand.
 */
export const Collapsed: Story = {
  render: () => (
    <ConsoleHarness
      seed={[
        { type: 'log', content: 'Idle session…' },
        { type: 'wasm', content: '(eval) <strong>=&gt; 42</strong>' },
      ]}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const collapseBtn = await canvas.findByTitle('Collapse');
    await userEvent.click(collapseBtn);
  },
};

/**
 * Typewriter animation — character-by-character reveal for new entries.
 * The setting is mutated directly via `setSettings` so it picks up before
 * the initial render flush.
 */
function TypewriterHarness() {
  onMount(() => {
    setSettings('console', {
      ...(settings.console ?? { showTimestamp: true, showTypeBadge: true, typewriterIntervalMs: 25 }),
      entryAnimation: 'typewriter',
      typewriterIntervalMs: 30,
    });
    clearConsole();
    addConsoleMessage('uSEQ Perform v1.2.0 ready', 'log');
    addConsoleMessage('Connected to interpreter', 'log');
    addConsoleMessage('(+ 1 2) <strong>=&gt; 3</strong>', 'wasm');
    addConsoleMessage('(sine 0.5) <em>=&gt; #signal</em>', 'wasm');
  });
  onCleanup(() => {
    setSettings('console', { ...(settings.console ?? {}), entryAnimation: 'slide' });
    clearConsole();
  });
  return (
    <div style={{ position: 'relative', width: '100%', height: '600px', background: '#0b1220', overflow: 'hidden' }}>
      <ConsolePanel />
    </div>
  );
}

export const Typewriter: Story = {
  render: () => <TypewriterHarness />,
};

/** Compact mode — type badges and timestamps off, just the prompt char and content. */
function CompactHarness() {
  onMount(() => {
    setSettings('console', {
      ...(settings.console ?? { entryAnimation: 'slide', typewriterIntervalMs: 20 }),
      showTimestamp: false,
      showTypeBadge: false,
    });
    clearConsole();
    addConsoleMessage('compact log line', 'log');
    addConsoleMessage('warning without badge', 'warn');
    addConsoleMessage('(eval) <strong>=&gt; ok</strong>', 'wasm');
    addConsoleMessage('error without badge', 'error');
  });
  onCleanup(() => {
    setSettings('console', { ...(settings.console ?? {}), showTimestamp: true, showTypeBadge: true });
    clearConsole();
  });
  return (
    <div style={{ position: 'relative', width: '100%', height: '600px', background: '#0b1220', overflow: 'hidden' }}>
      <ConsolePanel />
    </div>
  );
}

export const Compact: Story = {
  render: () => <CompactHarness />,
};
