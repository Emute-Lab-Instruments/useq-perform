import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { For } from 'solid-js';
import KeyboardVisualiser from '@src/ui/keybindings/KeyboardVisualiser';
import { defaultKeyBindings } from '@src/lib/keybindings/defaults';
import { actions, type ActionId } from '@src/lib/keybindings/actions';

const meta: Meta = {
  title: 'Keybindings',
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj;

/** Real KeyboardVisualiser in view mode with default bindings. */
export const KeyboardViewReal: Story = {
  render: () => (
    <KeyboardVisualiser layout="qwerty-us" bindings={defaultKeyBindings} showLegend={true} />
  ),
};

/** KeyboardVisualiser with command list visible. */
export const KeyboardEdit: Story = {
  render: () => (
    <KeyboardVisualiser
      layout="qwerty-us"
      bindings={defaultKeyBindings}
      showLegend={true}
      showCommandList={true}
    />
  ),
};

/** Static ActionPalette approximation using real action data. */
export const ActionPalette: Story = {
  render: () => {
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

    const sampleActions = getSampleActions();

    return (
      <div
        class="action-palette-backdrop"
        style={{
          position: 'relative',
          display: 'flex',
          'align-items': 'flex-start',
          'justify-content': 'center',
          padding: '2rem',
          'min-height': '100%',
          background: 'rgba(0,0,0,0.4)',
        }}
      >
        <div
          class="action-palette"
          style={{
            background: '#1a1a2e',
            border: '1px solid rgba(255,255,255,0.08)',
            'border-radius': '8px',
            width: '100%',
            'max-width': '460px',
            overflow: 'hidden',
          }}
        >
          <div
            class="action-palette-input-wrap"
            style={{
              padding: '8px',
              'border-bottom': '1px solid rgba(255,255,255,0.08)',
            }}
          >
            <input
              class="action-palette-input"
              type="text"
              placeholder="Type to search actions..."
              readonly
              style={{
                width: '100%',
                'box-sizing': 'border-box',
                background: '#0d0d1a',
                border: '1px solid rgba(255,255,255,0.12)',
                'border-radius': '4px',
                padding: '6px 8px',
                color: '#e0e0f0',
                'font-size': '0.75rem',
                'font-family': 'monospace',
              }}
            />
          </div>
          <div class="action-palette-list" style={{ 'max-height': '300px', overflow: 'auto' }}>
            <For each={sampleActions}>
              {(entry, i) => (
                <div
                  class="action-palette-item"
                  data-active={i() === 0 ? 'true' : undefined}
                  style={{
                    display: 'flex',
                    'align-items': 'center',
                    gap: '8px',
                    padding: '6px 10px',
                    'border-bottom': '1px solid rgba(255,255,255,0.04)',
                    background: i() === 0 ? 'rgba(255,255,255,0.06)' : undefined,
                    cursor: 'pointer',
                  }}
                >
                  <span
                    class="action-palette-desc"
                    style={{ flex: '1', 'font-size': '0.75rem', color: '#c0c0e0' }}
                  >
                    {entry.description}
                  </span>
                  <span
                    class="action-palette-category"
                    style={{
                      'font-size': '0.6rem',
                      padding: '1px 6px',
                      'border-radius': '3px',
                      background: `${categoryColors[entry.category] || '#666'}20`,
                      color: categoryColors[entry.category] || '#666',
                      'font-weight': '600',
                    }}
                  >
                    {entry.category}
                  </span>
                  {entry.key && (
                    <span
                      class="action-palette-key"
                      style={{
                        'font-size': '0.65rem',
                        padding: '1px 4px',
                        'border-radius': '3px',
                        background: 'rgba(255,255,255,0.06)',
                        color: '#e0e0f0',
                        'font-family': 'monospace',
                      }}
                    >
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
  },
};

/** ModifierHints overlay showing Ctrl bindings. */
export const ModifierHints: Story = {
  render: () => {
    interface HintEntry {
      key: string;
      description: string;
      isChord: boolean;
    }

    function getHintsForCtrl(): HintEntry[] {
      const prefixes = ['Ctrl-', 'Mod-'];
      const seen = new Set<string>();
      const entries: HintEntry[] = [];

      for (const binding of defaultKeyBindings) {
        if ((binding as any).when) continue;

        const matchedPrefix = prefixes.find((p) => binding.key.startsWith(p));
        if (!matchedPrefix) continue;

        const remainder = binding.key.slice(matchedPrefix.length);
        if (!remainder) continue;

        const isChord = remainder.includes(' ');
        const displayKey = isChord ? remainder.split(' ')[0] : remainder;

        const dedupeKey = isChord ? `chord:${displayKey}` : `key:${displayKey}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);

        const action = actions[binding.action as ActionId];
        const description = isChord ? 'More...' : action?.description ?? binding.action;

        entries.push({ key: displayKey, description, isChord });
      }

      entries.sort((a, b) => {
        if (a.isChord !== b.isChord) return a.isChord ? 1 : -1;
        return a.key.localeCompare(b.key);
      });

      return entries.slice(0, 10);
    }

    const hints = getHintsForCtrl();

    return (
      <div
        style={{
          padding: '2rem',
          display: 'flex',
          'justify-content': 'center',
          'align-items': 'flex-start',
          'min-height': '100%',
        }}
      >
        <div
          class="modifier-hints"
          style={{
            background: '#1a1a2e',
            border: '1px solid rgba(255,255,255,0.08)',
            'border-radius': '8px',
            padding: '10px 14px',
            'pointer-events': 'auto',
            'min-width': '200px',
          }}
        >
          <div
            class="modifier-hints-header"
            style={{
              'font-size': '0.7rem',
              color: '#808098',
              'margin-bottom': '6px',
              'padding-bottom': '4px',
              'border-bottom': '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <kbd
              style={{
                padding: '1px 5px',
                'border-radius': '3px',
                background: 'rgba(255,255,255,0.06)',
                color: '#facc15',
                'font-size': '0.7rem',
                'font-family': 'monospace',
              }}
            >
              Ctrl
            </kbd>{' '}
            + ...
          </div>
          <div class="modifier-hints-list">
            <For each={hints}>
              {(entry) => (
                <div
                  class="modifier-hints-row"
                  style={{
                    display: 'flex',
                    'align-items': 'center',
                    gap: '8px',
                    padding: '3px 0',
                  }}
                >
                  <span
                    class="modifier-hints-key"
                    style={{
                      display: 'inline-block',
                      'min-width': '50px',
                      'font-size': '0.7rem',
                      padding: '1px 5px',
                      'border-radius': '3px',
                      background: 'rgba(255,255,255,0.06)',
                      color: '#e0e0f0',
                      'text-align': 'center',
                      'font-family': 'monospace',
                    }}
                  >
                    {entry.key}
                    {entry.isChord && (
                      <span
                        class="modifier-hints-chord-arrow"
                        style={{ 'margin-left': '2px', color: '#808098' }}
                      >
                        {'\u2192'}
                      </span>
                    )}
                  </span>
                  <span
                    class="modifier-hints-desc"
                    style={{
                      'font-size': '0.7rem',
                      color: entry.isChord ? '#808098' : '#c0c0e0',
                    }}
                  >
                    {entry.description}
                  </span>
                </div>
              )}
            </For>
          </div>
        </div>
      </div>
    );
  },
};
