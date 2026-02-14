/**
 * CircularBuffer Class
 *
 * Implements a fixed-length circular buffer (ring buffer) for storing data.
 * Useful for maintaining a history of values while limiting memory usage.
 */
export class CircularBuffer<T = any> {
  buffer: T[];
  pointer: number;
  bufferLength: number;

  /**
   * Create a new circular buffer
   * @param bufferLength - Maximum number of elements to store
   */
  constructor(bufferLength: number) {
    if (!Number.isInteger(bufferLength) || bufferLength <= 0) {
      throw new Error('Buffer length must be a positive integer');
    }

    this.buffer = [];
    this.pointer = 0;
    this.bufferLength = bufferLength;
  }

  /**
   * Add an element to the buffer
   * If the buffer is full, the oldest element will be overwritten
   * @param element - Element to add to the buffer
   */
  push(element: T): void {
    if (this.buffer.length === this.bufferLength) {
      // Buffer is full, overwrite the oldest element
      this.buffer[this.pointer] = element;
    } else {
      // Buffer still has space, append to the end
      this.buffer.push(element);
    }
    // Move pointer to the next position
    this.pointer = (this.pointer + 1) % this.bufferLength;
  }

  /**
   * Get an element from the buffer, starting from the oldest
   * @param i - Index from the oldest element (0 = oldest)
   * @returns The element at specified index or undefined if not available
   */
  oldest(i: number): T | undefined {
    if (this.buffer.length === 0) {
      return undefined;
    }

    if (i < 0 || i >= this.buffer.length) {
      return undefined;
    }
    const index = this.buffer.length < this.bufferLength
      ? i
      : (this.pointer + i) % this.bufferLength;
    return this.buffer[index];
  }

  /**
   * Get an element from the buffer, starting from the most recent
   * @param i - Index from the most recent element (0 = newest)
   * @returns The element at specified index or undefined if not available
   */
  last(i: number): T | undefined {
    if (this.buffer.length === 0) {
      return undefined;
    }

    if (i < 0 || i >= this.buffer.length) {
      return undefined;
    }
    let idx: number;
    if (this.buffer.length < this.bufferLength) {
      idx = this.buffer.length - 1 - i;
    } else {
      idx = this.pointer - 1 - i;
      if (idx < 0) {
        idx = this.bufferLength + idx;
      }
    }
    return this.buffer[idx];
  }

  /**
   * Get the current number of elements in the buffer
   */
  get length(): number {
    return this.buffer.length;
  }

  /**
   * Get the maximum capacity of the buffer
   */
  get capacity(): number {
    return this.bufferLength;
  }

  /**
   * Clear the buffer
   */
  clear(): void {
    this.buffer = [];
    this.pointer = 0;
  }

  /**
   * Get all elements in the buffer as an array
   * @param oldestFirst - If true, returns elements from oldest to newest
   * @returns Array containing all buffer elements
   */
  toArray(oldestFirst: boolean = true): T[] {
    if (this.buffer.length === 0) {
      return [];
    }

    const result: T[] = [];

    if (oldestFirst) {
      // Return elements from oldest to newest
      for (let i = 0; i < this.buffer.length; i++) {
        result.push(this.oldest(i)!);
      }
    } else {
      // Return elements from newest to oldest
      for (let i = 0; i < this.buffer.length; i++) {
        result.push(this.last(i)!);
      }
    }

    return result;
  }
}
