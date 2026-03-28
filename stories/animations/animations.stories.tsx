import type { Meta, StoryObj } from 'storybook-solidjs-vite';

const meta: Meta = {
  title: 'Animations',
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj;

/** Keyboard visualiser showing key rebound flash animation states. */
export const KeyboardFlash: Story = {
  render: () => {
    const keyStyle = {
      width: '42px',
      height: '34px',
      display: 'flex',
      'flex-direction': 'column' as const,
      'align-items': 'center',
      'justify-content': 'center',
    };

    return (
      <div
        style={{
          display: 'flex',
          gap: '24px',
          padding: '24px',
          background: '#0d0d1a',
          'align-items': 'flex-start',
          'justify-content': 'center',
        }}
      >
        {/* Normal bound key */}
        <div style={{ 'text-align': 'center' }}>
          <div
            style={{
              'font-size': '0.6rem',
              color: 'rgba(255,255,255,0.5)',
              'margin-bottom': '8px',
              'font-family': 'monospace',
            }}
          >
            bound (normal)
          </div>
          <div
            class="kv-key kv-bound"
            style={{
              ...keyStyle,
              background: 'rgba(77,201,176,0.15)',
              'border-color': 'rgba(77,201,176,0.4)',
            }}
          >
            <span class="kv-key-label">Q</span>
            <span class="kv-key-action" style={{ color: 'rgba(77,201,176,0.9)' }}>
              eval
            </span>
          </div>
        </div>

        {/* Listening state — blue pulse */}
        <div style={{ 'text-align': 'center' }}>
          <div
            style={{
              'font-size': '0.6rem',
              color: 'rgba(255,255,255,0.5)',
              'margin-bottom': '8px',
              'font-family': 'monospace',
            }}
          >
            listening (pulse)
          </div>
          <div
            class="kv-key kv-bound kv-listening"
            style={{
              ...keyStyle,
              background: 'rgba(66,165,245,0.15)',
            }}
          >
            <span class="kv-key-label">W</span>
            <span class="kv-key-action" style={{ color: 'rgba(66,165,245,0.9)' }}>
              ...
            </span>
          </div>
        </div>

        {/* Just-rebound — green flash frozen at start */}
        <div style={{ 'text-align': 'center' }}>
          <div
            style={{
              'font-size': '0.6rem',
              color: 'rgba(255,255,255,0.5)',
              'margin-bottom': '8px',
              'font-family': 'monospace',
            }}
          >
            just-rebound (flash)
          </div>
          <div
            class="kv-key kv-bound kv-just-rebound"
            style={{
              ...keyStyle,
              background: 'rgba(77,201,176,0.15)',
              'border-color': 'rgba(77,201,176,0.4)',
              'animation-play-state': 'paused',
              'animation-delay': '-0.05s',
            }}
          >
            <span class="kv-key-label">E</span>
            <span class="kv-key-action" style={{ color: 'rgba(76,201,176,0.9)' }}>
              play
            </span>
          </div>
        </div>

        {/* Just-rebound — flash frozen midway */}
        <div style={{ 'text-align': 'center' }}>
          <div
            style={{
              'font-size': '0.6rem',
              color: 'rgba(255,255,255,0.5)',
              'margin-bottom': '8px',
              'font-family': 'monospace',
            }}
          >
            rebound (mid-fade)
          </div>
          <div
            class="kv-key kv-bound kv-just-rebound"
            style={{
              ...keyStyle,
              background: 'rgba(77,201,176,0.15)',
              'border-color': 'rgba(77,201,176,0.4)',
              'animation-play-state': 'paused',
              'animation-delay': '-0.3s',
            }}
          >
            <span class="kv-key-label">R</span>
            <span class="kv-key-action" style={{ color: 'rgba(76,201,176,0.9)' }}>
              stop
            </span>
          </div>
        </div>
      </div>
    );
  },
};

/** Onboarding banner for first-time users. */
export const OnboardingBanner: Story = {
  render: () => (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        background: '#0d0d1a',
      }}
    >
      {/* Simulated toolbar area */}
      <div
        style={{
          height: '48px',
          background: 'rgba(30,30,30,0.6)',
          'border-bottom': '1px solid rgba(255,255,255,0.06)',
        }}
      />

      {/* Banner with animation frozen at end state */}
      <div
        class="onboarding-banner"
        style={{
          position: 'absolute',
          top: '48px',
          right: '10px',
          'animation-play-state': 'paused',
          'animation-delay': '-0.3s',
        }}
      >
        <div class="onboarding-banner__text">
          <strong>Welcome to uSEQ Perform!</strong>{' '}
          Connect your hardware or use the built-in WASM interpreter to start live coding.
        </div>
        <button class="onboarding-banner__dismiss">Got it</button>
      </div>
    </div>
  ),
};

/** Palette toast notification frozen mid-animation. */
export const PaletteToast: Story = {
  render: () => (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        background: '#0d0d1a',
      }}
    >
      {/* Toast frozen at fully visible state */}
      <div
        class="action-palette-toast"
        style={{
          position: 'absolute',
          bottom: '24px',
          left: '50%',
          transform: 'translateX(-50%)',
          'animation-play-state': 'paused',
          'animation-delay': '-0.15s, -0.15s',
        }}
      >
        Tip: press{' '}
        <kbd
          style={{
            padding: '1px 5px',
            'border-radius': '3px',
            background: 'rgba(255,255,255,0.08)',
            border: '1px solid rgba(255,255,255,0.12)',
            'font-family': 'monospace',
            'font-size': '0.9em',
          }}
        >
          Ctrl+Shift+P
        </kbd>{' '}
        to open the palette
      </div>
    </div>
  ),
};

/** Three pulse animation variants. */
export const PulseStates: Story = {
  render: () => (
    <div
      style={{
        display: 'flex',
        gap: '24px',
        padding: '24px',
        background: '#0d0d1a',
        'align-items': 'flex-start',
      }}
    >
      {/* Generic pulse — scale animation */}
      <div style={{ 'text-align': 'center' }}>
        <div
          style={{
            'font-size': '0.65rem',
            color: 'rgba(255,255,255,0.5)',
            'margin-bottom': '8px',
            'font-family': 'monospace',
          }}
        >
          pulse (scale)
        </div>
        <div
          style={{
            width: '48px',
            height: '48px',
            'border-radius': '50%',
            background: 'var(--accent-color, #00ff41)',
            margin: '12px auto',
            animation: 'pulse 1s ease-in-out infinite',
          }}
        />
      </div>

      {/* kv-pulse — keyboard visualiser listening key */}
      <div style={{ 'text-align': 'center' }}>
        <div
          style={{
            'font-size': '0.65rem',
            color: 'rgba(255,255,255,0.5)',
            'margin-bottom': '8px',
            'font-family': 'monospace',
          }}
        >
          kv-pulse (blue glow)
        </div>
        <div style={{ padding: '12px' }}>
          <div
            class="kv-key kv-bound kv-listening"
            style={{
              width: '42px',
              height: '34px',
              display: 'flex',
              'align-items': 'center',
              'justify-content': 'center',
              background: 'rgba(66,165,245,0.15)',
              'border-color': 'rgba(66,165,245,0.6)',
            }}
          >
            <span class="kv-key-label">A</span>
          </div>
        </div>
      </div>

      {/* kb-pulse — settings keybinding capture */}
      <div style={{ 'text-align': 'center' }}>
        <div
          style={{
            'font-size': '0.65rem',
            color: 'rgba(255,255,255,0.5)',
            'margin-bottom': '8px',
            'font-family': 'monospace',
          }}
        >
          kb-pulse (opacity)
        </div>
        <div style={{ padding: '12px' }}>
          <button
            class="kb-listening"
            style={{
              padding: '6px 14px',
              background: 'var(--panel-control-bg, rgba(0,0,0,0.2))',
              border: '1px solid var(--accent-color, #00ff41)',
              'border-radius': '4px',
              color: 'var(--accent-color, #00ff41)',
              'font-family': 'monospace',
              'font-size': '0.8em',
              cursor: 'pointer',
            }}
          >
            Press a key...
          </button>
        </div>
      </div>
    </div>
  ),
};

/** Toolbar button interaction states. */
export const ToolbarButtonStates: Story = {
  render: () => (
    <div
      style={{
        display: 'flex',
        gap: '24px',
        padding: '24px',
        background: '#0d0d1a',
        'align-items': 'flex-start',
        'justify-content': 'center',
      }}
    >
      {/* Default state */}
      <div style={{ 'text-align': 'center' }}>
        <div
          style={{
            'font-size': '0.6rem',
            color: 'rgba(255,255,255,0.5)',
            'margin-bottom': '6px',
            'font-family': 'monospace',
          }}
        >
          default
        </div>
        <div class="toolbar-row">
          <button class="toolbar-button">Play</button>
        </div>
      </div>

      {/* Hover state — forced via inline styles */}
      <div style={{ 'text-align': 'center' }}>
        <div
          style={{
            'font-size': '0.6rem',
            color: 'rgba(255,255,255,0.5)',
            'margin-bottom': '6px',
            'font-family': 'monospace',
          }}
        >
          hover
        </div>
        <div class="toolbar-row">
          <button
            class="toolbar-button"
            style={{
              'background-color': 'var(--panel-item-hover-bg, rgba(255,255,255,0.1))',
              'border-color': 'var(--accent-color, #00ff41)',
              color: 'var(--accent-color, #00ff41)',
              'box-shadow': '0 2px 5px rgba(0,0,0,0.3)',
            }}
          >
            Play
          </button>
        </div>
      </div>

      {/* Active state — forced via inline styles */}
      <div style={{ 'text-align': 'center' }}>
        <div
          style={{
            'font-size': '0.6rem',
            color: 'rgba(255,255,255,0.5)',
            'margin-bottom': '6px',
            'font-family': 'monospace',
          }}
        >
          active
        </div>
        <div class="toolbar-row">
          <button
            class="toolbar-button"
            style={{
              'background-color': 'var(--panel-item-active-bg, rgba(255,255,255,0.15))',
              'border-color': 'var(--accent-color-active, #00cc33)',
              color: 'var(--accent-color-active, #00cc33)',
              transform: 'translateY(1px)',
            }}
          >
            Play
          </button>
        </div>
      </div>

      {/* Disabled state */}
      <div style={{ 'text-align': 'center' }}>
        <div
          style={{
            'font-size': '0.6rem',
            color: 'rgba(255,255,255,0.5)',
            'margin-bottom': '6px',
            'font-family': 'monospace',
          }}
        >
          disabled
        </div>
        <div class="toolbar-row">
          <button class="toolbar-button disabled">Play</button>
        </div>
      </div>

      {/* Primary variant */}
      <div style={{ 'text-align': 'center' }}>
        <div
          style={{
            'font-size': '0.6rem',
            color: 'rgba(255,255,255,0.5)',
            'margin-bottom': '6px',
            'font-family': 'monospace',
          }}
        >
          primary
        </div>
        <div class="toolbar-row">
          <button class="toolbar-button primary">Connect</button>
        </div>
      </div>
    </div>
  ),
};

/** Connection glow states for transport toolbar button. */
export const ConnectionGlows: Story = {
  render: () => {
    interface GlowButtonProps {
      state: string;
      label: string;
      description: string;
    }

    function GlowButton(props: GlowButtonProps) {
      return (
        <div style={{ 'text-align': 'center' }}>
          <div
            style={{
              'font-size': '0.6rem',
              color: 'rgba(255,255,255,0.5)',
              'margin-bottom': '6px',
              'font-family': 'monospace',
            }}
          >
            {props.description}
          </div>
          <div class="toolbar-row" style={{ 'justify-content': 'center' }}>
            <button class={`toolbar-button ${props.state}`}>{props.label}</button>
          </div>
        </div>
      );
    }

    return (
      <div
        style={{
          display: 'flex',
          gap: '28px',
          padding: '24px',
          background: '#0d0d1a',
          'align-items': 'flex-start',
          'justify-content': 'center',
        }}
      >
        <GlowButton state="transport-none" label="USB" description="none (red)" />
        <GlowButton state="transport-wasm" label="USB" description="wasm (orange)" />
        <GlowButton state="transport-both" label="USB" description="both (green)" />
        <GlowButton state="transport-hardware" label="USB" description="hardware (off-green)" />
      </div>
    );
  },
};
