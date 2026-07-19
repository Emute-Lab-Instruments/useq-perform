/**
 * Tests for the browser wiring of the synthesis service.
 *
 * Verifies the devmode-only global surface (VAL-HOST-011/012) is
 * installed only when devmode is on, and the lazy AudioContext factory
 * honours the autoplay contract.
 *
 * These tests run in jsdom which does NOT ship AudioContext by default.
 * We install a stub AudioContext + AudioWorkletNode to drive the wiring
 * end-to-end against fakes.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

import { detectAudioCapabilities } from "../contracts/audioCapabilities";
import { resetEngineStateStoreForTests } from "../contracts/synthesisChannels";
import { OSC_SINE_NODEDEF_DESCRIPTOR } from "../contracts/nodeDefRegistry";

import {
  createBrowserSynthesisService,
  defaultAssetUrlBuilder,
  teardownBrowserSynthesisGlobals,
  wrapBrowserAudioContext,
  wrapBrowserAudioWorkletNode,
} from "./synthesisServiceBrowser";

// ---------------------------------------------------------------------------
// Fake browser globals (installed per-test on window)
// ---------------------------------------------------------------------------

interface FakeWorkletPort {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: { data: unknown }) => void) | null;
}

interface FakeAudioContext {
  state: "suspended" | "running" | "closed";
  sampleRate: number;
  currentTime: number;
  destination: unknown;
  audioWorklet: { addModule(url: string): Promise<void> };
  resume(): Promise<void>;
  suspend(): Promise<void>;
  close(): Promise<void>;
}

interface FakeAudioWorkletNode {
  numberOfInputs: number;
  numberOfOutputs: number;
  port: FakeWorkletPort;
  connect(destination: unknown): unknown;
  disconnect(): void;
}

function installBrowserStubs(opts: { addModuleResult: "ok" | "throw" } = { addModuleResult: "ok" }): {
  audioContexts: FakeAudioContext[];
  workletNodes: FakeAudioWorkletNode[];
} {
  const audioContexts: FakeAudioContext[] = [];
  const workletNodes: FakeAudioWorkletNode[] = [];

  class FakeAudioContextCtor {
    state: "suspended" | "running" | "closed" = "suspended";
    sampleRate = 48000;
    currentTime = 0;
    destination = { name: "fake-destination" };
    audioWorklet = {
      async addModule(_url: string) {
        if (opts.addModuleResult === "throw") {
          throw new Error("worklet addModule failed");
        }
      },
    };
    async resume() {
      this.state = "running";
    }
    async suspend() {
      this.state = "suspended";
    }
    async close() {
      this.state = "closed";
    }
    constructor() {
      audioContexts.push(this as unknown as FakeAudioContext);
    }
  }

  class FakeAudioWorkletNodeCtor {
    numberOfInputs = 0;
    numberOfOutputs = 1;
    port: FakeWorkletPort = {
      postMessage() {},
      onmessage: null,
    };
    connect(destination: unknown) {
      return destination;
    }
    disconnect() {}
    constructor() {
      workletNodes.push(this as unknown as FakeAudioWorkletNode);
    }
  }

  (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContextCtor;
  (window as unknown as { AudioWorkletNode: unknown }).AudioWorkletNode = FakeAudioWorkletNodeCtor;

  // jsdom does not implement fetch by default. Stub a minimal fetch that
  // returns a tiny WASM byte sequence; the loader will compile it.
  (window as unknown as { fetch: unknown }).fetch = vi.fn(async (url: string) => {
    // Hand-craft a minimal valid WASM module (8 bytes magic + version).
    // The compile call below will succeed; the registry JSON path falls
    // back to the editor descriptor because the test bytes have no
    // exports.
    const bytes = new Uint8Array([
      0x00, 0x61, 0x73, 0x6d, // magic
      0x01, 0x00, 0x00, 0x00, // version
    ]);
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => bytes.buffer,
    } as unknown as Response;
  });

  return { audioContexts, workletNodes };
}

function clearBrowserStubs(): void {
  delete (window as unknown as { AudioContext?: unknown }).AudioContext;
  delete (window as unknown as { AudioWorkletNode?: unknown }).AudioWorkletNode;
  delete (window as unknown as { fetch?: unknown }).fetch;
}

function capableSnapshot() {
  return detectAudioCapabilities({
    crossOriginIsolated: true,
    sharedArrayBufferAvailable: true,
    audioWorkletAvailable: true,
    workerAvailable: true,
    sharedWebAssemblyMemoryAvailable: true,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("synthesisServiceBrowser — devmode gating (VAL-HOST-011/012)", () => {
  beforeEach(() => {
    resetEngineStateStoreForTests();
    teardownBrowserSynthesisGlobals();
  });

  afterEach(() => {
    teardownBrowserSynthesisGlobals();
    clearBrowserStubs();
  });

  it("does NOT install the devmode surface outside devmode", async () => {
    installBrowserStubs();
    const w = window as unknown as {
      __useqSynthesisDev?: unknown;
      __useqSynthesisTelemetry?: unknown;
    };

    const service = createBrowserSynthesisService({
      capabilities: capableSnapshot(),
      devmode: false,
    });

    // Outside devmode the globals must stay undefined.
    expect(w.__useqSynthesisDev).toBeUndefined();
    // Telemetry global also stays undefined outside devmode.
    expect(w.__useqSynthesisTelemetry).toBeUndefined();
    await service.dispose();
  });

  it("installs the devmode surface (telemetry + fault actions) when devmode is true", async () => {
    installBrowserStubs();
    const w = window as unknown as {
      __useqSynthesisDev?: {
        getTelemetry(): { engineState: string };
        terminateProducer(): boolean;
        reinitialise(): Promise<boolean>;
      };
      __useqSynthesisTelemetry?: { engineState: string };
    };

    const service = createBrowserSynthesisService({
      capabilities: capableSnapshot(),
      devmode: true,
    });

    expect(w.__useqSynthesisDev).toBeDefined();
    expect(typeof w.__useqSynthesisDev?.getTelemetry).toBe("function");
    expect(typeof w.__useqSynthesisDev?.terminateProducer).toBe("function");
    expect(typeof w.__useqSynthesisDev?.reinitialise).toBe("function");
    expect(w.__useqSynthesisTelemetry).toBeDefined();
    expect(w.__useqSynthesisTelemetry?.engineState).toBe("off");

    await service.dispose();
  });

  it("teardownBrowserSynthesisGlobals removes both surfaces", async () => {
    installBrowserStubs();
    const w = window as unknown as {
      __useqSynthesisDev?: unknown;
      __useqSynthesisTelemetry?: unknown;
    };

    const service = createBrowserSynthesisService({
      capabilities: capableSnapshot(),
      devmode: true,
    });
    expect(w.__useqSynthesisDev).toBeDefined();
    await service.dispose();

    teardownBrowserSynthesisGlobals();
    expect(w.__useqSynthesisDev).toBeUndefined();
    expect(w.__useqSynthesisTelemetry).toBeUndefined();
  });
});

describe("synthesisServiceBrowser — asset URL convention", () => {
  it("defaultAssetUrlBuilder maps descriptors to /wasm/<name>.wasm", () => {
    expect(defaultAssetUrlBuilder(OSC_SINE_NODEDEF_DESCRIPTOR)).toBe("wasm/osc_sine.wasm");
  });
});

describe("synthesisServiceBrowser — wrapper identity", () => {
  it("wrapBrowserAudioContext delegates every method", async () => {
    const calls: string[] = [];
    const fakeCtx = {
      state: "suspended" as const,
      sampleRate: 48000,
      currentTime: 0,
      destination: {},
      audioWorklet: {
        async addModule(url: string) {
          calls.push(`addModule:${url}`);
        },
      },
      async resume() { calls.push("resume"); },
      async suspend() { calls.push("suspend"); },
      async close() { calls.push("close"); },
    };
    const wrapped = wrapBrowserAudioContext(fakeCtx as unknown as AudioContext);
    expect(wrapped.state).toBe("suspended");
    expect(wrapped.sampleRate).toBe(48000);
    await wrapped.audioWorklet?.addModule("foo");
    await wrapped.resume();
    await wrapped.suspend();
    await wrapped.close();
    expect(calls).toEqual(["addModule:foo", "resume", "suspend", "close"]);
  });

  it("wrapBrowserAudioWorkletNode delegates port + connect/disconnect", () => {
    const posted: unknown[] = [];
    const fakeNode = {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      port: {
        postMessage(message: unknown) { posted.push(message); },
        onmessage: null,
      },
      connect(destination: unknown) { return destination; },
      disconnect() {},
    };
    const wrapped = wrapBrowserAudioWorkletNode(fakeNode as unknown as AudioWorkletNode);
    expect(wrapped.numberOfInputs).toBe(0);
    expect(wrapped.numberOfOutputs).toBe(1);
    wrapped.port.postMessage({ type: "ping" });
    expect(posted).toEqual([{ type: "ping" }]);
    expect(wrapped.connect("dest")).toBe("dest");
    expect(() => wrapped.disconnect()).not.toThrow();
  });
});
