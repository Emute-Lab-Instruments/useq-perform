import { defineScenario } from '../../framework/scenario';

/**
 * Three distinct pulse animations used across the app:
 * 1. Generic pulse (updates.css) — scale 1 -> 1.2 -> 1, used for update notifications
 * 2. kv-pulse (keyboard-visualiser.css) — blue glow on .kv-listening keys
 * 3. kb-pulse (settings.css) — opacity fade on .kb-listening keybinding capture
 */

function PulseStatesGrid() {
  return (
    <div style={{
      display: 'flex',
      gap: '24px',
      padding: '24px',
      background: '#0d0d1a',
      "align-items": 'flex-start',
    }}>
      {/* Generic pulse — scale animation */}
      <div style={{ "text-align": 'center' }}>
        <div style={{
          "font-size": '0.65rem',
          color: 'rgba(255,255,255,0.5)',
          "margin-bottom": '8px',
          "font-family": 'monospace',
        }}>
          pulse (scale)
        </div>
        <div style={{
          width: '48px',
          height: '48px',
          "border-radius": '50%',
          background: 'var(--accent-color, #00ff41)',
          margin: '12px auto',
          animation: 'pulse 1s ease-in-out infinite',
        }} />
      </div>

      {/* kv-pulse — keyboard visualiser listening key */}
      <div style={{ "text-align": 'center' }}>
        <div style={{
          "font-size": '0.65rem',
          color: 'rgba(255,255,255,0.5)',
          "margin-bottom": '8px',
          "font-family": 'monospace',
        }}>
          kv-pulse (blue glow)
        </div>
        <div style={{ padding: '12px' }}>
          <div
            class="kv-key kv-bound kv-listening"
            style={{
              width: '42px',
              height: '34px',
              display: 'flex',
              "align-items": 'center',
              "justify-content": 'center',
              background: 'rgba(66,165,245,0.15)',
              "border-color": 'rgba(66,165,245,0.6)',
            }}
          >
            <span class="kv-key-label">A</span>
          </div>
        </div>
      </div>

      {/* kb-pulse — settings keybinding capture */}
      <div style={{ "text-align": 'center' }}>
        <div style={{
          "font-size": '0.65rem',
          color: 'rgba(255,255,255,0.5)',
          "margin-bottom": '8px',
          "font-family": 'monospace',
        }}>
          kb-pulse (opacity)
        </div>
        <div style={{ padding: '12px' }}>
          <button
            class="kb-listening"
            style={{
              padding: '6px 14px',
              background: 'var(--panel-control-bg, rgba(0,0,0,0.2))',
              border: '1px solid var(--accent-color, #00ff41)',
              "border-radius": '4px',
              color: 'var(--accent-color, #00ff41)',
              "font-family": 'monospace',
              "font-size": '0.8em',
              cursor: 'pointer',
            }}
          >
            Press a key...
          </button>
        </div>
      </div>
    </div>
  );
}

export default defineScenario({
  category: 'Animations & Transitions / Pulse Animations',
  name: 'Pulse animation variants',
  type: 'canary',
  sourceFiles: [
    'src/ui/styles/updates.css',
    'src/ui/styles/keyboard-visualiser.css',
    'src/ui/styles/settings.css',
  ],
  grepTerms: [
    '@keyframes pulse',
    '@keyframes kv-pulse',
    '@keyframes kb-pulse',
    '.kv-listening',
    '.kb-listening',
  ],
  description:
    'Three pulse animation variants side by side. Left: generic pulse (scale 1-1.2-1) ' +
    'from updates.css. Center: kv-pulse (blue glow oscillation) from keyboard-visualiser.css, ' +
    'shown on a .kv-listening key element. Right: kb-pulse (opacity 1-0.4-1) from settings.css, ' +
    'shown on a .kb-listening button. All should animate continuously.',
  component: {
    render: () => <PulseStatesGrid />,
    loadAppStyles: true,
    width: 480,
    height: 160,
  },
});
