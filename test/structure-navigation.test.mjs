import './setup.mjs';
import { strict as assert } from 'assert';
import { createStructuralEditor, selectByText, navigateIn, navigateOut, navigateNext, navigatePrev } from '../src/editors/extensions/structure/new-structure.mjs';

function selectedText(state) {
  const sel = state.selection.main;
  return state.sliceDoc(sel.from, sel.to);
}

describe('Structure Navigation (new-structure)', () => {
  it('navigates into a selected container', () => {
    const doc = '(do (a1 x) (a2 y))';
    let state = createStructuralEditor(doc);
    state = selectByText(state, doc);

    const next = navigateIn(state);
    assert.notEqual(next, state);
    assert.equal(selectedText(next), 'do');
  });

  it('navigateOut on a top-level expression is stable', () => {
    const doc = '(a1 x)';
    let state = createStructuralEditor(doc);
    state = selectByText(state, doc);

    const next = navigateOut(state);
    assert.ok(next);
  });

  it('sibling navigation does not crash on simple forms', () => {
    const doc = '(do (a1 x) (a2 y))';
    let state = createStructuralEditor(doc);
    state = selectByText(state, 'do');

    const right = navigateNext(state);
    const left = navigatePrev(right);

    assert.ok(right);
    assert.ok(left);
  });
});
