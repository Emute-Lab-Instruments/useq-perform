import { describe, expect, it, vi } from "vitest";

import {
  createWasmBatchEvaluator,
  createHeapBuffer,
  createWasmSynthDeclarationReset,
  readAndFreeCString,
  type EmscriptenModule,
} from "./wasmInterpreterCore";

function createHeapModule(): EmscriptenModule & {
  _malloc: ReturnType<typeof vi.fn>;
  _free: ReturnType<typeof vi.fn<(pointer: number) => void>>;
} {
  let nextPointer = 8;
  return {
    cwrap: vi.fn(),
    _malloc: vi.fn((bytes: number) => {
      const pointer = nextPointer;
      nextPointer += bytes;
      return pointer;
    }),
    _free: vi.fn< (pointer: number) => void >(),
    HEAPF64: new Float64Array(32),
    UTF8ToString: vi.fn((pointer: number) => pointer === 16 ? "owned text" : ""),
  };
}

describe("shared WASM interpreter heap policy", () => {
  it("labels projection samples from the C frontier metadata", () => {
    let frontier = 5;
    const heap = new Float64Array(16);
    const callFns: Record<string, (...args: any[]) => any> = {
      useq_tick_and_project: vi.fn((_json, _tick, _mode, _end, _count, pointer) => {
        heap.set([11, 12, 13], pointer / Float64Array.BYTES_PER_ELEMENT);
        frontier = 10;
        return 1;
      }),
      useq_projection_frontier_time: vi.fn(() => frontier),
    };
    const module = {
      cwrap: vi.fn((symbol: string) => callFns[symbol]),
      _useq_tick_and_project: vi.fn(),
      _useq_projection_frontier_time: vi.fn(),
      _malloc: vi.fn(() => 8),
      _free: vi.fn(),
      HEAPF64: heap,
      UTF8ToString: vi.fn(() => ""),
    } as unknown as EmscriptenModule;
    const evaluator = createWasmBatchEvaluator(module, () => Number.NaN);

    const result = evaluator.tickAndProject(["a"], 6, 2, 10, 2, 4);

    expect(result?.projectionFrontierTime).toBe(10);
    expect(result?.projectionSamples.get("a")).toEqual([
      { time: 7.5, value: 12 },
      { time: 10, value: 13 },
    ]);
  });

  it("decodes and frees an owned C string pointer", () => {
    const module = createHeapModule();
    expect(readAndFreeCString(module, 16)).toBe("owned text");
    expect(module._free).toHaveBeenCalledWith(16);
  });

  it("uses the dedicated synth declaration reset export", () => {
    const resetFn = vi.fn(() => 1);
    const module = {
      cwrap: vi.fn(() => resetFn),
      _useq_clear_synth_declarations: vi.fn(),
      _malloc: vi.fn(() => 8),
      _free: vi.fn(),
      HEAPF64: new Float64Array(32),
      UTF8ToString: vi.fn(() => ""),
    } as unknown as EmscriptenModule;

    expect(createWasmSynthDeclarationReset(module)()).toBe(true);
    expect(resetFn).toHaveBeenCalledOnce();
    expect(module.cwrap).toHaveBeenCalledWith(
      "useq_clear_synth_declarations",
      "number",
      [],
    );
  });

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
