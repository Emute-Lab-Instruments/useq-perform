import { defineScenario } from '../../framework/scenario';

/**
 * The keyboard visualiser shows a green flash (kv-flash, 0.6s ease-out)
 * when a key is rebound. The .kv-just-rebound class triggers a box-shadow
 * and border-color animation from teal/green to inherit.
 *
 * This scenario shows keys in various states: normal bound, listening (blue
 * pulse), and just-rebound (green flash frozen mid-animation).
 */

function KeyboardFlashDemo() {
  const keyStyle = {
    width: '42px',
    height: '34px',
    display: 'flex',
    "flex-direction": 'column' as const,
    "align-items": 'center',
    "justify-content": 'center',
  };

  return (
    <div style={{
      display: 'flex',
      gap: '24px',
      padding: '24px',
      background: '#0d0d1a',
      "align-items": 'flex-start',
      "justify-content": 'center',
    }}>
      {/* Normal bound key */}
      <div style={{ "text-align": 'center' }}>
        <div style={{
          "font-size": '0.6rem',
          color: 'rgba(255,255,255,0.5)',
          "margin-bottom": '8px',
          "font-family": 'monospace',
        }}>
          bound (normal)
        </div>
        <div
          class="kv-key kv-bound"
          style={{
            ...keyStyle,
            background: 'rgba(77,201,176,0.15)',
            "border-color": 'rgba(77,201,176,0.4)',
          }}
        >
          <span class="kv-key-label">Q</span>
          <span class="kv-key-action" style={{ color: 'rgba(77,201,176,0.9)' }}>eval</span>
        </div>
      </div>

      {/* Listening state — blue pulse */}
      <div style={{ "text-align": 'center' }}>
        <div style={{
          "font-size": '0.6rem',
          color: 'rgba(255,255,255,0.5)',
          "margin-bottom": '8px',
          "font-family": 'monospace',
        }}>
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
          <span class="kv-key-action" style={{ color: 'rgba(66,165,245,0.9)' }}>...</span>
        </div>
      </div>

      {/* Just-rebound — green flash frozen at start */}
      <div style={{ "text-align": 'center' }}>
        <div style={{
          "font-size": '0.6rem',
          color: 'rgba(255,255,255,0.5)',
          "margin-bottom": '8px',
          "font-family": 'monospace',
        }}>
          just-rebound (flash)
        </div>
        <div
          class="kv-key kv-bound kv-just-rebound"
          style={{
            ...keyStyle,
            background: 'rgba(77,201,176,0.15)',
            "border-color": 'rgba(77,201,176,0.4)',
            "animation-play-state": 'paused',
            "animation-delay": '-0.05s',
          }}
        >
          <span class="kv-key-label">E</span>
          <span class="kv-key-action" style={{ color: 'rgba(76,201,176,0.9)' }}>play</span>
        </div>
      </div>

      {/* Just-rebound — flash frozen midway */}
      <div style={{ "text-align": 'center' }}>
        <div style={{
          "font-size": '0.6rem',
          color: 'rgba(255,255,255,0.5)',
          "margin-bottom": '8px',
          "font-family": 'monospace',
        }}>
          rebound (mid-fade)
        </div>
        <div
          class="kv-key kv-bound kv-just-rebound"
          style={{
            ...keyStyle,
            background: 'rgba(77,201,176,0.15)',
            "border-color": 'rgba(77,201,176,0.4)',
            "animation-play-state": 'paused',
            "animation-delay": '-0.3s',
          }}
        >
          <span class="kv-key-label">R</span>
          <span class="kv-key-action" style={{ color: 'rgba(76,201,176,0.9)' }}>stop</span>
        </div>
      </div>
    </div>
  );
}

export default defineScenario({
  category: 'Animations & Transitions / Keyboard Flash',
  name: 'Key rebound flash animation',
  type: 'canary',
  sourceFiles: [
    'src/ui/styles/keyboard-visualiser.css',
  ],
  grepTerms: [
    '.kv-just-rebound',
    '.kv-listening',
    '.kv-key',
    '.kv-bound',
    '@keyframes kv-flash',
    '@keyframes kv-pulse',
  ],
  description:
    'Keyboard visualiser key states showing the rebound flash animation. ' +
    'Left to right: normal bound key, listening key (blue kv-pulse), ' +
    'just-rebound key frozen at animation start (bright green glow, ' +
    'box-shadow 12px rgba 76,201,176), and just-rebound frozen at midpoint ' +
    '(fading glow). The kv-flash animation is 0.6s ease-out from teal glow ' +
    'to no shadow.',
  component: {
    render: () => <KeyboardFlashDemo />,
    loadAppStyles: true,
    width: 480,
    height: 140,
  },
});
