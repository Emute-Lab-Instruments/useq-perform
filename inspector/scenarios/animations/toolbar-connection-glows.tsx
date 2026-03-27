import { defineScenario } from '../../framework/scenario';

/**
 * The connection button in the first toolbar row uses colored box-shadow glows
 * to indicate transport state. Four states exist:
 * - transport-none: red (no connection)
 * - transport-wasm: orange (WASM interpreter only)
 * - transport-both: green (WASM + hardware)
 * - transport-hardware: off-green (hardware only)
 *
 * These styles require `.toolbar-row:first-child .toolbar-button` specificity,
 * so each button is wrapped in a toolbar-row marked as first-child.
 */

interface GlowButtonProps {
  state: string;
  label: string;
  description: string;
}

function GlowButton(props: GlowButtonProps) {
  return (
    <div style={{ "text-align": 'center' }}>
      <div style={{
        "font-size": '0.6rem',
        color: 'rgba(255,255,255,0.5)',
        "margin-bottom": '6px',
        "font-family": 'monospace',
      }}>
        {props.description}
      </div>
      <div class="toolbar-row" style={{ "justify-content": 'center' }}>
        <button class={`toolbar-button ${props.state}`}>
          {props.label}
        </button>
      </div>
    </div>
  );
}

function ConnectionGlowGrid() {
  return (
    <div style={{
      display: 'flex',
      gap: '28px',
      padding: '24px',
      background: '#0d0d1a',
      "align-items": 'flex-start',
      "justify-content": 'center',
    }}>
      <GlowButton state="transport-none" label="USB" description="none (red)" />
      <GlowButton state="transport-wasm" label="USB" description="wasm (orange)" />
      <GlowButton state="transport-both" label="USB" description="both (green)" />
      <GlowButton state="transport-hardware" label="USB" description="hardware (off-green)" />
    </div>
  );
}

export default defineScenario({
  category: 'Animations & Transitions / Connection Glows',
  name: 'Transport connection glow states',
  type: 'contract',
  sourceFiles: [
    'src/ui/styles/toolbar.css',
    'src/ui/MainToolbar.tsx',
  ],
  grepTerms: [
    '.transport-none',
    '.transport-wasm',
    '.transport-both',
    '.transport-hardware',
    '.toolbar-button',
  ],
  description:
    'Four connection glow states for the toolbar connect button. Each should ' +
    'display a distinct colored box-shadow: transport-none (red, rgba 255,60,60), ' +
    'transport-wasm (orange, rgba 255,165,0), transport-both (green, rgba 0,230,100), ' +
    'transport-hardware (off-green, rgba 120,210,80). The glow style requires ' +
    '.toolbar-row:first-child .toolbar-button specificity.',
  component: {
    render: () => <ConnectionGlowGrid />,
    loadAppStyles: true,
    width: 520,
    height: 140,
  },
});
