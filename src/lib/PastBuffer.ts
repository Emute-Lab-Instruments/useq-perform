/**
 * Ring buffer for recorded past visualisation values.
 *
 * Stores output values pushed one per animation frame. Tracks the time
 * of each push so the renderer can reconstruct per-sample timestamps.
 *
 * All access is O(1). No allocations after construction.
 */
export class PastBuffer {
  private _values: Float64Array;
  private _times: Float64Array;
  private _head = 0;
  private _length = 0;

  constructor(readonly capacity: number) {
    const cap = Math.max(1, capacity);
    this._values = new Float64Array(cap);
    this._times = new Float64Array(cap);
  }

  push(time: number, value: number): void {
    this._values[this._head] = value;
    this._times[this._head] = time;
    this._head = (this._head + 1) % this._values.length;
    if (this._length < this._values.length) this._length++;
  }

  valueAt(i: number): number {
    if (i < 0 || i >= this._length) return NaN;
    const idx =
      this._length < this._values.length
        ? i
        : (this._head + i) % this._values.length;
    return this._values[idx];
  }

  timeAt(i: number): number {
    if (i < 0 || i >= this._length) return NaN;
    const idx =
      this._length < this._values.length
        ? i
        : (this._head + i) % this._values.length;
    return this._times[idx];
  }

  get length(): number {
    return this._length;
  }

  get newestTime(): number {
    if (this._length === 0) return -Infinity;
    const idx = (this._head - 1 + this._values.length) % this._values.length;
    return this._times[idx];
  }

  get oldestTime(): number {
    if (this._length === 0) return Infinity;
    const idx =
      this._length < this._values.length
        ? 0
        : this._head % this._values.length;
    return this._times[idx];
  }

  clear(): void {
    this._head = 0;
    this._length = 0;
  }
}
