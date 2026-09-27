import { describe, expect, it, vi } from "vitest";
import type { EmscriptenModule } from "./wasmInterpreterCore.ts";
import { bindOutputClassifications } from "./wasmOutputClassifications.ts";

describe("WASM output classification ABI", () => {
  it("reads classes, dependencies, health, and semantic effects from one snapshot", () => {
    const heap = new Uint8Array(128);
    heap.set([1, 2, 3], 8);
    const cwrap = vi.fn((symbol: string) => {
      const bindings: Record<string, (...args: any[]) => any> = {
        useq_output_classifications: () => 8,
        useq_output_dependencies: (index: number) => index === 1 ? 4 : 0,
        useq_output_health: (name: string) => name === "a1" ? 2 : 0,
        useq_output_semantic_effects: (index: number) => index === 1 ? 9 : 0,
      };
      return bindings[symbol];
    });
    const module = {
      cwrap,
      HEAPU8: heap,
      ...Object.fromEntries([
        "useq_output_classifications",
        "useq_output_dependencies",
        "useq_output_health",
        "useq_output_semantic_effects",
      ].map((symbol) => [`_${symbol}`, vi.fn()])),
    } as unknown as EmscriptenModule;

    const classification = bindOutputClassifications(module)();

    expect(classification).not.toBeNull();
    expect(classification?.classes.slice(0, 3)).toEqual([1, 2, 3]);
    expect(classification?.inputMasks.slice(0, 3)).toEqual([0, 4, 0]);
    expect(classification?.outputHealth.a1).toBe(2);
    expect(classification?.semanticEffects.slice(0, 3)).toEqual([0, 9, 0]);
  });
});
