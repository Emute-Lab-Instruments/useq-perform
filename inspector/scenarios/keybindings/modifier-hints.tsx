import { defineScenario } from '../../framework/scenario';
import { For } from 'solid-js';
import { defaultKeyBindings } from '@src/lib/keybindings/defaults';
import { actions, type ActionId } from '@src/lib/keybindings/actions';

/**
 * ModifierHints is coupled to settingsStore (reads modifier hint delay).
 * This scenario renders a static approximation using real binding data,
 * showing what the overlay looks like when Ctrl is held.
 */

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

    const matchedPrefix = prefixes.find(p => binding.key.startsWith(p));
    if (!matchedPrefix) continue;

    const remainder = binding.key.slice(matchedPrefix.length);
    if (!remainder) continue;

    const isChord = remainder.includes(' ');
    const displayKey = isChord ? remainder.split(' ')[0] : remainder;

    const dedupeKey = isChord ? `chord:${displayKey}` : `key:${displayKey}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const action = actions[binding.action as ActionId];
    const description = isChord
      ? 'More...'
      : action?.description ?? binding.action;

    entries.push({ key: displayKey, description, isChord });
  }

  entries.sort((a, b) => {
    if (a.isChord !== b.isChord) return a.isChord ? 1 : -1;
    return a.key.localeCompare(b.key);
  });

  return entries.slice(0, 10);
}

function ModifierHintsStatic() {
  const hints = getHintsForCtrl();

  return (
    <div style={{
      padding: '2rem',
      display: 'flex',
      "justify-content": 'center',
      "align-items": 'flex-start',
      "min-height": '100%',
    }}>
      <div class="modifier-hints" style={{
        background: '#1a1a2e',
        border: '1px solid rgba(255,255,255,0.08)',
        "border-radius": '8px',
        padding: '10px 14px',
        "pointer-events": 'auto',
        "min-width": '200px',
      }}>
        <div class="modifier-hints-header" style={{
          "font-size": '0.7rem',
          color: '#808098',
          "margin-bottom": '6px',
          "padding-bottom": '4px',
          "border-bottom": '1px solid rgba(255,255,255,0.06)',
        }}>
          <kbd style={{
            padding: '1px 5px',
            "border-radius": '3px',
            background: 'rgba(255,255,255,0.06)',
            color: '#facc15',
            "font-size": '0.7rem',
            "font-family": 'monospace',
          }}>Ctrl</kbd>{' '}+ ...
        </div>
        <div class="modifier-hints-list">
          <For each={hints}>
            {(entry) => (
              <div class="modifier-hints-row" style={{
                display: 'flex',
                "align-items": 'center',
                gap: '8px',
                padding: '3px 0',
              }}>
                <span class="modifier-hints-key" style={{
                  display: 'inline-block',
                  "min-width": '50px',
                  "font-size": '0.7rem',
                  padding: '1px 5px',
                  "border-radius": '3px',
                  background: 'rgba(255,255,255,0.06)',
                  color: '#e0e0f0',
                  "text-align": 'center',
                  "font-family": 'monospace',
                }}>
                  {entry.key}
                  {entry.isChord && (
                    <span class="modifier-hints-chord-arrow" style={{ "margin-left": '2px', color: '#808098' }}>
                      {'\u2192'}
                    </span>
                  )}
                </span>
                <span class="modifier-hints-desc" style={{
                  "font-size": '0.7rem',
                  color: entry.isChord ? '#808098' : '#c0c0e0',
                }}>
                  {entry.description}
                </span>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}

export default defineScenario({
  category: 'Keybindings / Modifier Hints',
  name: 'Modifier key overlay',
  type: 'canary',
  sourceFiles: [
    'src/ui/keybindings/ModifierHints.tsx',
    'src/lib/keybindings/defaults.ts',
    'src/lib/keybindings/actions.ts',
  ],
  description:
    'Static approximation of the ModifierHints overlay using real binding data, ' +
    'showing the Ctrl modifier held state. The real ModifierHints is coupled to ' +
    'settingsStore. Verify hint layout, key badges, chord arrows, and descriptions.',
  component: {
    render: () => <ModifierHintsStatic />,
    loadAppStyles: true,
    width: 360,
    height: 380,
  },
});
