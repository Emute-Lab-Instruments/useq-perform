import { describe, expect, it } from "vitest";
import { createWasmRuntimeWorkerPort } from "./wasmRuntimeWorkerPort.ts";

describe("WASM port hardware-only namespaces", () => {
  it("returns an empty successful result for nn forms without starting a Worker", async () => {
    const originalWorker = globalThis.Worker;
    let constructed = false;
    class UnexpectedWorker {
      constructor() {
        constructed = true;
      }
    }
    Object.defineProperty(globalThis, "Worker", {
      configurable: true,
      value: UnexpectedWorker,
    });

    try {
      const port = createWasmRuntimeWorkerPort();
      await expect(port.evalCodeWithDiagnostics("(nn/in 1 meml/joy-x)"))
        .resolves.toEqual({ result: null, diagnostics: [], synthArtifacts: null });
      expect(constructed).toBe(false);
    } finally {
      Object.defineProperty(globalThis, "Worker", {
        configurable: true,
        value: originalWorker,
      });
    }
  });
});
