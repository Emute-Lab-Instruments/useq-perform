import { defineScenario } from '../../framework/scenario';

/**
 * The palette toast is a transient notification shown when ActionPalette
 * displays a keybinding tip. It fades in (0.15s) and auto-dismisses with
 * a fade-out (0.3s at 1.7s delay). This scenario freezes the toast
 * mid-animation using animation-play-state: paused so both the element
 * and its styling are visible for review.
 */

function PaletteToastFrozen() {
  return (
    <div style={{
      position: 'relative',
      width: '100%',
      height: '100%',
      background: '#0d0d1a',
    }}>
      {/* Toast frozen at fully visible state */}
      <div
        class="action-palette-toast"
        style={{
          position: 'absolute',
          bottom: '24px',
          left: '50%',
          transform: 'translateX(-50%)',
          "animation-play-state": 'paused',
          "animation-delay": '-0.15s, -0.15s',
        }}
      >
        Tip: press <kbd style={{
          padding: '1px 5px',
          "border-radius": '3px',
          background: 'rgba(255,255,255,0.08)',
          border: '1px solid rgba(255,255,255,0.12)',
          "font-family": 'monospace',
          "font-size": '0.9em',
        }}>Ctrl+Shift+P</kbd> to open the palette
      </div>
    </div>
  );
}

export default defineScenario({
  category: 'Animations & Transitions / Palette Toast',
  name: 'Toast notification frozen',
  type: 'canary',
  sourceFiles: [
    'src/ui/styles/palette.css',
    'src/ui/keybindings/ActionPalette.tsx',
  ],
  grepTerms: [
    '.action-palette-toast',
    '@keyframes palette-toast-in',
    '@keyframes palette-toast-out',
  ],
  description:
    'Palette toast notification frozen mid-animation. Verify the toast appears ' +
    'centered at the bottom, has the correct panel background, border radius, ' +
    'and monospace font. The toast uses palette-toast-in (0.15s fade+slide) ' +
    'and palette-toast-out (0.3s fade at 1.7s delay).',
  component: {
    render: () => <PaletteToastFrozen />,
    loadAppStyles: true,
    width: 500,
    height: 150,
  },
});
