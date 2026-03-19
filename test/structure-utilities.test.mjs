import './setup.mjs';
import { strict as assert } from 'assert';
import { createStructuralEditor, findNodeAt, isStructuralToken, isContainerNode } from '../src/editors/extensions/structure/new-structure.ts';

describe('Structure Utilities (new-structure)', () => {
  it('identifies structural token nodes', () => {
    assert.equal(isStructuralToken({ type: { name: '(' } }), true);
    assert.equal(isStructuralToken({ type: { name: 'Bracket' } }), true);
    assert.equal(isStructuralToken({ type: { name: 'Symbol' } }), false);
  });

  it('identifies container nodes', () => {
    assert.equal(isContainerNode({ type: { name: 'List' } }), true);
    assert.equal(isContainerNode({ type: { name: 'Program' } }), false);
    assert.equal(isContainerNode({ type: { name: 'Symbol' } }), false);
  });

  it('findNodeAt returns expected symbol range', () => {
    const state = createStructuralEditor('(a1 foo)');
    const node = findNodeAt(state, 1, 3);
    assert.ok(node);
    assert.equal(node.type.name, 'Symbol');
    assert.equal(state.sliceDoc(node.from, node.to), 'a1');
  });
});
