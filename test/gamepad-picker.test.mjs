import { expect } from 'chai';
import './setup.mjs';

import { buildHierarchicalMenuModel } from '../src/lib/pickerMenuModel.ts';

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

  // NOTE: The former grid/radial picker insert/replace integration tests were
  // removed. They referenced a `createGamepadController({ view })` /
  // `controller.openCreateMenu()` API and an `updateAppSettings` import that no
  // longer exist — the gamepad picker now flows through typed channels via
  // gamepadMenuBridge. The insert/replace behaviour is covered by the picker
  // adapter/model tests (src/ui/adapters and pickerMenuModel) and the menu
  // dispatcher e2e tests. Re-add a browser E2E case here if end-to-end
  // gamepad→insert coverage is needed.

  it('menu model includes Favorites only when starred exist', async () => {
    setStarred([]);
    const model = await buildHierarchicalMenuModel();
    expect(model[0].id).to.not.equal('favorites');
    setStarred(['+']);
    const model2 = await buildHierarchicalMenuModel();
    expect(model2[0].id).to.equal('favorites');
  });
});
