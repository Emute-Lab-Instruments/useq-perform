export class CircularBuffer {
  constructor(bufferLength) {
    this.buffer = [];
    this.pointer = 0;
    this.bufferLength = bufferLength;
  }

  push(element) {
    if (this.buffer.length === this.bufferLength) {
      this.buffer[this.pointer] = element;
    } else {
      this.buffer.push(element);
    }
    this.pointer = (this.pointer + 1) % this.bufferLength;
  }

  oldest(i) {
    return this.buffer[(this.pointer + i) % this.bufferLength];
  }

  last(i) {
    let idx = this.pointer - i - 1
    if (idx < 0) {
      idx = this.bufferLength + idx
    }
    return this.buffer[idx];
  }

}
