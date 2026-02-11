import './setup.mjs';
import { strict as assert } from 'assert';
import { createStructuralEditor, selectByText, findNodeAt, navigateIn } from '../src/editors/extensions/structure/new-structure.mjs';

describe('Active Selection Tracking (new-structure)', () => {
  it('selectByText selects exact expression ranges', () => {
    const doc = '(do (a1 foo) (a2 bar) (a1 baz))';
    let state = createStructuralEditor(doc);

    state = selectByText(state, '(a2 bar)');
    const sel = state.selection.main;
    assert.equal(state.sliceDoc(sel.from, sel.to), '(a2 bar)');
  });

  it('findNodeAt resolves selected symbols inside expression', () => {
    const doc = '(do (a1 foo) (a2 bar))';
    const state = createStructuralEditor(doc);
    const node = findNodeAt(state, 5, 7);

    assert.ok(node);
    assert.equal(node.type.name, 'Symbol');
    assert.equal(state.sliceDoc(node.from, node.to), 'a1');
  });

  it('navigateIn moves focus from expression to child symbol', () => {
    const doc = '(do (a1 foo) (a2 bar))';
    let state = createStructuralEditor(doc);
    state = selectByText(state, doc);

    const next = navigateIn(state);
    const sel = next.selection.main;

    assert.equal(next.sliceDoc(sel.from, sel.to), 'do');
  });
});
