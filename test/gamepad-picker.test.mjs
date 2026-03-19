import { expect } from 'chai';
import './setup.mjs';

import { createEditor } from '../src/lib/editorStore.ts';
import { createGamepadController } from '../src/editors/gamepadControl.ts';
import { updateAppSettings } from '../src/runtime/appSettingsRepository.ts';
import { buildHierarchicalMenuModel } from '../src/lib/pickerMenuModel.ts';

// Helper to flush microtasks/timeouts
function tick(ms = 0) {
  return new Promise(res => setTimeout(res, ms));
}

function setStarred(list) {
  window.localStorage.setItem('moduLispReference\x3AstarredFunctions', JSON.stringify(list));
}

describe('Gamepad picker menus', () => {
  before(async () => {
    // Note: Picker menu is now imported directly by gamepadControl.ts
    // No need to set up window.__pickerMenu anymore
  });

  beforeEach(() => {
    // Mock fetch to return a tiny reference set
    global.window.fetch = async () => ({ ok: true, json: async () => ([
      { name: '+', tags: ['functional programming', 'maths'] },
      { name: '-', tags: ['functional programming', 'maths'] },
      { name: '=', tags: ['evaluation control'] }
    ]) });
    // Clear DOM overlays between tests
    const overlays = Array.from(document.querySelectorAll('.picker-menu-overlay'));
    overlays.forEach(el => el.remove());
  });

  // NOTE: The picker menu integration tests are skipped because they require
  // a full browser environment with Solid rendering. The adapter tests in
  // src/ui/adapters/adapters.test.tsx cover the adapter functionality in jsdom.
  // These integration tests should be run in a browser E2E test environment.
  it.skip('hierarchical grid picker inserts selected entry (replace)', async () => {
    setStarred(['+']);
    updateAppSettings({ ui: { gamepadPickerStyle: 'grid' } });

    const view = createEditor('OLD', []);
    document.body.appendChild(view.dom);
    view.dispatch({
      selection: { anchor: 0, head: view.state.doc.length }
    });

    const controller = createGamepadController({ view, pollInterval: 999999 });
    // Directly open picker
    await controller.openCreateMenu('replace');
    await tick(10);

    // Press select to enter first category (Favorites)
    window.dispatchEvent(new CustomEvent('gamepadpickerinput', { detail: { action: 'select' } }));
    await tick(10);
    // Press select again to choose first item ('+')
    window.dispatchEvent(new CustomEvent('gamepadpickerinput', { detail: { action: 'select' } }));
    await tick(20);

    const doc = view.state.doc.toString();
    expect(doc).to.equal('(+ )');
  });

  it.skip('radial picker inserts selected entry with A/select', async () => {
    setStarred(['+']);
    updateAppSettings({ ui: { gamepadPickerStyle: 'radial' } });
    const view = createEditor('OLD', []);
    document.body.appendChild(view.dom);
    view.dispatch({
      selection: { anchor: 0, head: view.state.doc.length }
    });
    const controller = createGamepadController({ view, pollInterval: 999999 });
    await controller.openCreateMenu('replace');
    await tick(10);

    // By default, activeCat=0 (Favorites), activeItem=0 ('+')
    window.dispatchEvent(new CustomEvent('gamepadpickerinput', { detail: { action: 'select' } }));
    await tick(10);
    const doc = view.state.doc.toString();
    expect(doc).to.equal('(+ )');
  });

  it('menu model includes Favorites only when starred exist', async () => {
    setStarred([]);
    const model = await buildHierarchicalMenuModel();
    expect(model[0].id).to.not.equal('favorites');
    setStarred(['+']);
    const model2 = await buildHierarchicalMenuModel();
    expect(model2[0].id).to.equal('favorites');
  });
});
