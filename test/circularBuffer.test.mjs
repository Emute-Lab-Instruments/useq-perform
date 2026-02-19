import { strict as assert } from 'assert';
import { CircularBuffer } from '../src/legacy/utils/CircularBuffer.ts';

describe('CircularBuffer', () => {
  it('retrieves values in order before buffer wraps', () => {
    const buf = new CircularBuffer(5);
    [1,2,3].forEach(v => buf.push(v));

    assert.equal(buf.length, 3);
    assert.equal(buf.capacity, 5);
    assert.equal(buf.oldest(0), 1);
    assert.equal(buf.oldest(1), 2);
    assert.equal(buf.oldest(2), 3);
    assert.equal(buf.last(0), 3);
    assert.equal(buf.last(1), 2);
  });

  it('retrieves values correctly after wrapping', () => {
    const buf = new CircularBuffer(5);
    [1,2,3,4,5,6].forEach(v => buf.push(v));
    // Buffer should now contain [2,3,4,5,6]
    assert.equal(buf.length, 5);
    assert.deepEqual(buf.toArray(true), [2,3,4,5,6]);
    assert.equal(buf.oldest(0), 2);
    assert.equal(buf.last(0), 6);
    assert.equal(buf.last(4), 2);
  });
});
