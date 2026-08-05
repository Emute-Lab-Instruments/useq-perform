import { describe, expect, it, vi } from "vitest";

import {
  createHeapBuffer,
  type EmscriptenModule,
} from "./wasmInterpreterCore";

function createHeapModule(): EmscriptenModule & {
  _malloc: ReturnType<typeof vi.fn>;
  _free: ReturnType<typeof vi.fn>;
} {
  let nextPointer = 8;
  return {
    cwrap: vi.fn(),
    _malloc: vi.fn((bytes: number) => {
      const pointer = nextPointer;
      nextPointer += bytes;
      return pointer;
    }),
    _free: vi.fn(),
    HEAPF64: new Float64Array(32),
  };
}

describe("shared WASM interpreter heap policy", () => {
  it("reuses an allocation and rebinds its view after memory growth", () => {
    const module = createHeapModule();
    const buffer = createHeapBuffer(module, "test buffer");

    const first = buffer.ensure(3);
    first.view.set([1, 2, 3]);
    expect(module._malloc).toHaveBeenCalledTimes(1);

    const grownHeap = new Float64Array(64);
    grownHeap.set(module.HEAPF64);
    module.HEAPF64 = grownHeap;

    const rebound = buffer.ensure(2);
    expect(rebound.pointer).toBe(first.pointer);
    expect(rebound.view.buffer).toBe(grownHeap.buffer);
    expect(Array.from(rebound.view.slice(0, 3))).toEqual([1, 2, 3]);
    expect(module._malloc).toHaveBeenCalledTimes(1);
    expect(module._free).not.toHaveBeenCalled();

    buffer.release();
    expect(module._free).toHaveBeenCalledOnce();
    expect(module._free).toHaveBeenCalledWith(first.pointer);
  });

  it("frees the old allocation exactly once when capacity grows", () => {
    const module = createHeapModule();
    const buffer = createHeapBuffer(module, "test buffer");

    const first = buffer.ensure(2);
    const second = buffer.ensure(5);

    expect(second.pointer).not.toBe(first.pointer);
    expect(module._malloc).toHaveBeenCalledTimes(2);
    expect(module._free).toHaveBeenCalledOnce();
    expect(module._free).toHaveBeenCalledWith(first.pointer);
  });
});

