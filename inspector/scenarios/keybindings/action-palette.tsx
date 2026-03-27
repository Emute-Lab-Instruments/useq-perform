import { defineScenario } from '../../framework/scenario';
import { For } from 'solid-js';
import { actions, type ActionCategory } from '@src/lib/keybindings/actions';
import { defaultKeyBindings } from '@src/lib/keybindings/defaults';

/**
 * ActionPalette is coupled to overlayManager, handler registry, and editorStore.
 * This scenario renders a static approximation of its visual structure using
 * real action data from the keybindings module.
 */

const categoryColors: Record<string, string> = {
  core: '#4DC9B0',
  editor: '#FD971F',
  structure: '#66BB6A',
  probe: '#CE93D8',
  navigation: '#78909C',
  ui: '#42A5F5',
  transport: '#FFD54F',
  gamepad: '#FF7043',
  menu: '#AED581',
};

function formatKey(key: string): string {
  return key
    .replace(/Mod/g, 'Ctrl')
    .replace(/-/g, '+')
    .replace(/\b[a-z]\b/g, (c) => c.toUpperCase());
}

/** Build a representative sample of actions for the palette display. */
function getSampleActions() {
  const keyLookup = new Map<string, string>();
  for (const b of defaultKeyBindings) {
    if (!keyLookup.has(b.action)) keyLookup.set(b.action, b.key);
  }

  const entries = Object.entries(actions)
    .filter(([, def]) => !(def as any).analogOnly)
    .sort((a, b) => {
      const cat = a[1].category.localeCompare(b[1].category);
      if (cat !== 0) return cat;
      return a[1].description.localeCompare(b[1].description);
    })
    .slice(0, 12)
    .map(([id, def]) => ({
      id,
      description: def.description,
      category: def.category,
      key: keyLookup.get(id),
    }));

  return entries;
}

function ActionPaletteStatic() {
  const sampleActions = getSampleActions();

  return (
    <div class="action-palette-backdrop" style={{
      position: 'relative',
      display: 'flex',
      "align-items": 'flex-start',
      "justify-content": 'center',
      padding: '2rem',
      "min-height": '100%',
      background: 'rgba(0,0,0,0.4)',
    }}>
      <div class="action-palette" style={{
        background: '#1a1a2e',
        border: '1px solid rgba(255,255,255,0.08)',
        "border-radius": '8px',
        width: '100%',
        "max-width": '460px',
        overflow: 'hidden',
      }}>
        <div class="action-palette-input-wrap" style={{
          padding: '8px',
          "border-bottom": '1px solid rgba(255,255,255,0.08)',
        }}>
          <input
            class="action-palette-input"
            type="text"
            placeholder="Type to search actions..."
            readonly
            style={{
              width: '100%',
              "box-sizing": 'border-box',
              background: '#0d0d1a',
              border: '1px solid rgba(255,255,255,0.12)',
              "border-radius": '4px',
              padding: '6px 8px',
              color: '#e0e0f0',
              "font-size": '0.75rem',
              "font-family": 'monospace',
            }}
          />
        </div>
        <div class="action-palette-list" style={{ "max-height": '300px', overflow: 'auto' }}>
          <For each={sampleActions}>
            {(entry, i) => (
              <div
                class="action-palette-item"
                data-active={i() === 0 ? 'true' : undefined}
                style={{
                  display: 'flex',
                  "align-items": 'center',
                  gap: '8px',
                  padding: '6px 10px',
                  "border-bottom": '1px solid rgba(255,255,255,0.04)',
                  background: i() === 0 ? 'rgba(255,255,255,0.06)' : undefined,
                  cursor: 'pointer',
                }}
              >
                <span class="action-palette-desc" style={{ flex: '1', "font-size": '0.75rem', color: '#c0c0e0' }}>
                  {entry.description}
                </span>
                <span class="action-palette-category" style={{
                  "font-size": '0.6rem',
                  padding: '1px 6px',
                  "border-radius": '3px',
                  background: `${categoryColors[entry.category] || '#666'}20`,
                  color: categoryColors[entry.category] || '#666',
                  "font-weight": '600',
                }}>
                  {entry.category}
                </span>
                {entry.key && (
                  <span class="action-palette-key" style={{
                    "font-size": '0.65rem',
                    padding: '1px 4px',
                    "border-radius": '3px',
                    background: 'rgba(255,255,255,0.06)',
                    color: '#e0e0f0',
                    "font-family": 'monospace',
                  }}>
                    {formatKey(entry.key)}
                  </span>
                )}
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}

export default defineScenario({
  category: 'Keybindings / Action Palette',
  name: 'Command palette',
  type: 'contract',
  sourceFiles: [
    'src/ui/keybindings/ActionPalette.tsx',
    'src/lib/keybindings/actions.ts',
    'src/lib/keybindings/defaults.ts',
  ],
  description:
    'Static approximation of the ActionPalette command palette using real action ' +
    'data from the keybindings module. The real ActionPalette is coupled to ' +
    'overlayManager, handler registry, and editorStore. Verify search input, ' +
    'action list with descriptions, category badges, and keybinding display.',
  component: {
    render: () => <ActionPaletteStatic />,
    loadAppStyles: true,
    width: 520,
    height: 450,
  },
});
