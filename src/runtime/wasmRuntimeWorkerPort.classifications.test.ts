import { afterEach, describe, expect, it, vi } from "vitest";
import { createWasmRuntimeWorkerPort } from "./wasmRuntimeWorkerPort.ts";

class ClassificationWorker {
  private listeners = new Map<string, (event: MessageEvent) => void>();
  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(type, listener);
  }
  terminate() {}
  postMessage(request: { id: number; type: string }) {
    const response = request.type === "load"
      ? {
          type: "load-result",
          id: request.id,
          capabilities: {
            enabled: true,
            supportsEval: true,
            supportsTimeWindow: true,
            supportsTickAndProject: true,
            supportsLiveInputs: true,
          },
        }
      : {
          type: "readOutputClassifications-result",
          id: request.id,
          classification: {
            classes: [1],
            inputMasks: [2],
            outputHealth: { a1: 1 },
            semanticEffects: [8],
          },
        };
    queueMicrotask(() => this.listeners.get("message")?.({ data: response } as MessageEvent));
  }
}

afterEach(() => vi.unstubAllGlobals());

describe("WASM worker output classifications", () => {
  it("routes the production port request and returns the worker snapshot", async () => {
    vi.stubGlobal("Worker", ClassificationWorker as unknown as typeof Worker);
    const port = createWasmRuntimeWorkerPort();
    try {
      await expect(port.readOutputClassifications()).resolves.toEqual({
        classes: [1],
        inputMasks: [2],
        outputHealth: { a1: 1 },
        semanticEffects: [8],
      });
    } finally {
      port.dispose();
    }
  });
});
