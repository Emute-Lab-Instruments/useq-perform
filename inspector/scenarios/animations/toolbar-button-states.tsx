import { defineScenario } from '../../framework/scenario';

/**
 * Toolbar buttons have three visual states:
 * - Default: panel-control-bg, panel-border
 * - Hover: panel-item-hover-bg, accent-color border + text
 * - Active: panel-item-active-bg, accent-color-active, translateY(1px)
 *
 * Since we cannot trigger real :hover/:active in a scenario, we use
 * inline style overrides to approximate each state.
 */

function ToolbarButtonStates() {
  return (
    <div style={{
      display: 'flex',
      gap: '24px',
      padding: '24px',
      background: '#0d0d1a',
      "align-items": 'flex-start',
      "justify-content": 'center',
    }}>
      {/* Default state */}
      <div style={{ "text-align": 'center' }}>
        <div style={{
          "font-size": '0.6rem',
          color: 'rgba(255,255,255,0.5)',
          "margin-bottom": '6px',
          "font-family": 'monospace',
        }}>
          default
        </div>
        <div class="toolbar-row">
          <button class="toolbar-button">Play</button>
        </div>
      </div>

      {/* Hover state — forced via inline styles */}
      <div style={{ "text-align": 'center' }}>
        <div style={{
          "font-size": '0.6rem',
          color: 'rgba(255,255,255,0.5)',
          "margin-bottom": '6px',
          "font-family": 'monospace',
        }}>
          hover
        </div>
        <div class="toolbar-row">
          <button
            class="toolbar-button"
            style={{
              "background-color": 'var(--panel-item-hover-bg, rgba(255,255,255,0.1))',
              "border-color": 'var(--accent-color, #00ff41)',
              color: 'var(--accent-color, #00ff41)',
              "box-shadow": '0 2px 5px rgba(0,0,0,0.3)',
            }}
          >
            Play
          </button>
        </div>
      </div>

      {/* Active state — forced via inline styles */}
      <div style={{ "text-align": 'center' }}>
        <div style={{
          "font-size": '0.6rem',
          color: 'rgba(255,255,255,0.5)',
          "margin-bottom": '6px',
          "font-family": 'monospace',
        }}>
          active
        </div>
        <div class="toolbar-row">
          <button
            class="toolbar-button"
            style={{
              "background-color": 'var(--panel-item-active-bg, rgba(255,255,255,0.15))',
              "border-color": 'var(--accent-color-active, #00cc33)',
              color: 'var(--accent-color-active, #00cc33)',
              transform: 'translateY(1px)',
            }}
          >
            Play
          </button>
        </div>
      </div>

      {/* Disabled state */}
      <div style={{ "text-align": 'center' }}>
        <div style={{
          "font-size": '0.6rem',
          color: 'rgba(255,255,255,0.5)',
          "margin-bottom": '6px',
          "font-family": 'monospace',
        }}>
          disabled
        </div>
        <div class="toolbar-row">
          <button class="toolbar-button disabled">Play</button>
        </div>
      </div>

      {/* Primary variant */}
      <div style={{ "text-align": 'center' }}>
        <div style={{
          "font-size": '0.6rem',
          color: 'rgba(255,255,255,0.5)',
          "margin-bottom": '6px',
          "font-family": 'monospace',
        }}>
          primary
        </div>
        <div class="toolbar-row">
          <button class="toolbar-button primary">Connect</button>
        </div>
      </div>
    </div>
  );
}

export default defineScenario({
  category: 'Animations & Transitions / Toolbar Buttons',
  name: 'Button interaction states',
  type: 'canary',
  sourceFiles: [
    'src/ui/styles/toolbar.css',
  ],
  grepTerms: [
    '.toolbar-button',
    '.toolbar-button:hover',
    '.toolbar-button:active',
    '.toolbar-button.disabled',
    '.toolbar-button.primary',
  ],
  description:
    'Toolbar button in default, hover, active, disabled, and primary states. ' +
    'Hover and active states are approximated with inline style overrides since ' +
    'pseudo-classes cannot be triggered statically. Verify: default has subtle ' +
    'shadow, hover shows accent border/text, active shifts down 1px, disabled ' +
    'is 50% opacity, primary uses accent background with white text. ' +
    'All transitions are 0.15s.',
  component: {
    render: () => <ToolbarButtonStates />,
    loadAppStyles: true,
    width: 560,
    height: 120,
  },
});
