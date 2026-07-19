/**
 * Tests for the synthesis worklet processor shell.
 *
 * Covers the shell wiring (VAL-ENGINE-009, VAL-ENGINE-037):
 *   - The shell registers the processor name when loaded in the
 *     AudioWorkletGlobalScope.
 *   - The shell is a no-op (does not throw) when the globals are
 *     absent, as in Node/Vitest.
 *   - The processor name matches the one the synthesis service uses
 *     to construct the AudioWorkletNode.
 *
 * The full process() path is exercised by the worklet-core tests
 * (workletCore.test.ts); this file only verifies the shell glue.
 */
import { describe, expect, it } from "vitest";

import { SYNTHESIS_PROCESSOR_NAME, registerSynthesisProcessor } from "./synthesisWorklet";

describe("synthesisWorklet shell", () => {
  it("exports the canonical processor name", () => {
    expect(SYNTHESIS_PROCESSOR_NAME).toBe("synthesis-processor");
  });

  it("does not throw when the worklet globals are absent", () => {
    // In Vitest the AudioWorkletProcessor and registerProcessor globals
    // are absent; the registration call must be a no-op.
    expect(() => registerSynthesisProcessor()).not.toThrow();
  });

  it("registers the processor when the worklet globals are present", () => {
    // Install fake globals, invoke registration, assert the processor
    // was registered under the canonical name, then clean up.
    const originalRegister = (globalThis as { registerProcessor?: unknown }).registerProcessor;
    const originalProcessor = (globalThis as { AudioWorkletProcessor?: unknown }).AudioWorkletProcessor;

    const registered: Array<{ name: string; ctor: unknown }> = [];
    class FakeProcessor {
      port = { postMessage: () => {}, onmessage: null as unknown };
    }

    (globalThis as { registerProcessor?: unknown }).registerProcessor = (
      name: string,
      ctor: unknown,
    ) => {
      registered.push({ name, ctor });
    };
    (globalThis as { AudioWorkletProcessor?: unknown }).AudioWorkletProcessor = FakeProcessor;

    try {
      registerSynthesisProcessor();
      expect(registered).toHaveLength(1);
      expect(registered[0].name).toBe(SYNTHESIS_PROCESSOR_NAME);
      expect(typeof registered[0].ctor).toBe("function");
    } finally {
      if (originalRegister === undefined) {
        delete (globalThis as { registerProcessor?: unknown }).registerProcessor;
      } else {
        (globalThis as { registerProcessor?: unknown }).registerProcessor = originalRegister;
      }
      if (originalProcessor === undefined) {
        delete (globalThis as { AudioWorkletProcessor?: unknown }).AudioWorkletProcessor;
      } else {
        (globalThis as { AudioWorkletProcessor?: unknown }).AudioWorkletProcessor = originalProcessor;
      }
    }
  });
});
