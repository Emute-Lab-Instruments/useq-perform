/**
 * CircularBuffer Class
 * 
 * Implements a fixed-length circular buffer (ring buffer) for storing data.
 * Useful for maintaining a history of values while limiting memory usage.
 */
export { CircularBuffer };

class CircularBuffer {
  /**
   * Create a new circular buffer
   * @param {number} bufferLength - Maximum number of elements to store
   */
  constructor(bufferLength) {
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
   * @param {any} element - Element to add to the buffer
   */
  push(element) {
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
   * @param {number} i - Index from the oldest element (0 = oldest)
   * @returns {any} The element at specified index or undefined if not available
   */
  oldest(i) {
    if (this.buffer.length === 0) {
      return undefined;
    }
    
    if (i < 0 || i >= this.buffer.length) {
      return undefined;
    }
    
    return this.buffer[(this.pointer + i) % this.bufferLength];
  }
  
  /**
   * Get an element from the buffer, starting from the most recent
   * @param {number} i - Index from the most recent element (0 = newest)
   * @returns {any} The element at specified index or undefined if not available
   */
  last(i) {
    if (this.buffer.length === 0) {
      return undefined;
    }
    
    if (i < 0 || i >= this.buffer.length) {
      return undefined;
    }
    
    let idx = this.pointer - 1 - i;
    if (idx < 0) {
      idx = this.buffer.length + idx;
    }
    
    return this.buffer[idx];
  }
  
  /**
   * Get the current number of elements in the buffer
   * @returns {number} Number of elements currently in the buffer
   */
  get length() {
    return this.buffer.length;
  }
  
  /**
   * Get the maximum capacity of the buffer
   * @returns {number} Maximum number of elements the buffer can hold
   */
  get capacity() {
    return this.bufferLength;
  }
  
  /**
   * Clear the buffer
   */
  clear() {
    this.buffer = [];
    this.pointer = 0;
  }
  
  /**
   * Get all elements in the buffer as an array
   * @param {boolean} [oldestFirst=true] - If true, returns elements from oldest to newest
   * @returns {Array} Array containing all buffer elements
   */
  toArray(oldestFirst = true) {
    if (this.buffer.length === 0) {
      return [];
    }
    
    const result = [];
    
    if (oldestFirst) {
      // Return elements from oldest to newest
      for (let i = 0; i < this.buffer.length; i++) {
        result.push(this.oldest(i));
      }
    } else {
      // Return elements from newest to oldest
      for (let i = 0; i < this.buffer.length; i++) {
        result.push(this.last(i));
      }
    }
    
    return result;
  }
}
