import { expect } from 'chai';
import './setup.mjs';

import { createEditor } from '../src/editors/main.mjs';
import { createGamepadController } from '../src/editors/gamepadControl.mjs';
import { updateUserSettings } from '../src/utils/persistentUserSettings.mjs';
import { buildHierarchicalMenuModel } from '../src/ui/pickers/menuData.mjs';

// Helper to flush microtasks/timeouts
function tick(ms = 0) {
  return new Promise(res => setTimeout(res, ms));
}

function setStarred(list) {
  window.localStorage.setItem('moduLispReference\x3AstarredFunctions', JSON.stringify(list));
}

describe('Gamepad picker menus', () => {
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

  it('hierarchical grid picker inserts selected entry (replace)', async () => {
    setStarred(['+']);
    updateUserSettings({ ui: { gamepadPickerStyle: 'grid' } });

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

  it('radial picker inserts selected entry with A/select', async () => {
    setStarred(['+']);
    updateUserSettings({ ui: { gamepadPickerStyle: 'radial' } });
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
