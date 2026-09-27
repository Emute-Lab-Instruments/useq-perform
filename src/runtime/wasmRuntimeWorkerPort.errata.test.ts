import { afterEach, describe, expect, it, vi } from "vitest";
import { codeEvaluated } from "../contracts/runtimeChannels.ts";
import { createWasmRuntimeWorkerPort } from "./wasmRuntimeWorkerPort.ts";

class ReplyingWorker {
  private listeners = new Map<string, (event: MessageEvent) => void>();
  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(type, listener);
  }
  terminate() {}
  postMessage(request: { id: number; type: string; code?: string }) {
    const response = request.type === "load"
      ? {
          type: "load-result",
          id: request.id,
          capabilities: {
            enabled: true,
            supportsEval: true,
            supportsTimeWindow: false,
            supportsTickAndProject: false,
            supportsLiveInputs: false,
          },
        }
      : {
          type: "evalCodeWithDiagnostics-result",
          id: request.id,
          result: "ok",
          diagnostics: request.code === "bad"
            ? [{ start: 0, end: 1, severity: "error", message: "bad" }]
            : [],
          synthArtifacts: null,
        };
    queueMicrotask(() => this.listeners.get("message")?.({ data: response } as MessageEvent));
  }
}

afterEach(() => vi.unstubAllGlobals());

describe("WASM evaluated announcements", () => {
  it("publishes success but not an error reply", async () => {
    vi.stubGlobal("Worker", ReplyingWorker as unknown as typeof Worker);
    const port = createWasmRuntimeWorkerPort();
    const published: string[] = [];
    const unsubscribe = codeEvaluated.subscribe(({ code }) => published.push(code));
    try {
      await port.evalCodeWithDiagnostics("bad");
      await port.evalCodeWithDiagnostics("good");
      expect(published).toEqual(["good"]);
    } finally {
      unsubscribe();
      port.dispose();
    }
  });
});
