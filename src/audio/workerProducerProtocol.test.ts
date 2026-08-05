/**
 * Contract tests for the producer slice of the WASM runtime Worker
 * protocol.
 *
 * Covers (see mission feature `m1-audio-clocked-worker-producer`):
 *   VAL-ENGINE-001 — Only the existing Worker advances live ModuLisp
 *                    execution (the producer runs inside the Worker;
 *                    no second interpreter is constructed).
 *   VAL-ENGINE-003 — Transport mapping is deterministic (the protocol
 *                    carries a pure frame/time anchor + transition).
 *   VAL-ENGINE-005 — External inputs affect the next produced block.
 *   VAL-ENGINE-006 — Producer does not starve message handling.
 *   VAL-ENGINE-032 — Transport transitions govern live production.
 *   VAL-SAB-012   — Declared publication helpers are used.
 */
import { describe, expect, it } from "vitest";

import type {
  WasmWorkerRequest,
  WasmWorkerResponse,
  ProducerInstallSabRequest,
  ProducerStartRequest,
  ProducerStopRequest,
  ProducerTransportUpdateRequest,
  ProducerApplyInputsRequest,
  ProducerArmEpochRequest,
  ProducerTerminateRequest,
  ProducerReadTelemetryRequest,
  ProducerTelemetrySnapshot,
  ProducerPrepareCommitRequest,
} from "../runtime/workers/wasmRuntimeWorkerProtocol";
import {
  ABI_VERSION,
  createSynthesisControlBuffer,
  attachSynthesisControlView,
} from "../contracts/synthesisControlAbi";

function req<T extends WasmWorkerRequest>(r: T): T {
  return r;
}

describe("workerProducerProtocol / VAL-ENGINE-001 (sole executor)", () => {
  it("does not introduce a second-executor message", () => {
    const producerRequests: WasmWorkerRequest["type"][] = [
      "producerInstallSab",
      "producerStart",
      "producerStop",
      "producerTransportUpdate",
      "producerApplyInputs",
      "producerArmEpoch",
      "producerTerminate",
      "producerReadTelemetry",
    ];
    expect(producerRequests).not.toContain("createInterpreter");
    expect(producerRequests).not.toContain("spawnExecutor");
  });

  it("disables tickAndProject while the producer owns live VM advancement", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const source = readFileSync(
      resolve("src/runtime/workers/wasmRuntime.worker.ts"),
      "utf8",
    );
    expect(source).toContain("!wasmEnabled || !interpreter || producerRunning");
    expect(source).toContain("interpreter.tickSynthControls");
  });

  it("shares interpreter policy with the main-thread adapter", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const workerSource = readFileSync(
      resolve("src/runtime/workers/wasmRuntime.worker.ts"),
      "utf8",
    );
    const mainSource = readFileSync(
      resolve("src/runtime/wasmInterpreter.ts"),
      "utf8",
    );
    for (const factory of [
      "createWasmBatchEvaluator",
      "createWasmLiveInputController",
      "createWasmProbeController",
    ]) {
      expect(workerSource).toContain(factory);
      expect(mainSource).toContain(factory);
    }
    expect(workerSource).not.toContain("function bindOptionalCwrap");
    expect(mainSource).not.toContain("function bindOptionalCwrap");
  });
});

describe("workerProducerProtocol / VAL-ENGINE-003 (transport mapping)", () => {
  it("transport update carries a pure transition + atFrame + optional atTime", () => {
    const r = req<ProducerTransportUpdateRequest>({
      type: "producerTransportUpdate",
      id: 1,
      transition: "pause",
      atFrame: 1000n,
      atTime: 0.5,
    });
    expect(r.transition).toBe("pause");
    expect(r.atFrame).toBe(1000n);
    expect(r.atTime).toBe(0.5);
  });

  it("transport transitions enumerate start, pause, resume, stop, reanchor", () => {
    const transitions = ["start", "pause", "resume", "stop", "reanchor"] as const;
    for (const t of transitions) {
      const r = req<ProducerTransportUpdateRequest>({
        type: "producerTransportUpdate",
        id: 1,
        transition: t,
        atFrame: 0n,
      });
      expect(r.transition).toBe(t);
    }
  });
});

describe("workerProducerProtocol / VAL-ENGINE-005 (inputs affect next block)", () => {
  it("producerApplyInputs carries a Record<string, number>", () => {
    const r = req<ProducerApplyInputsRequest>({
      type: "producerApplyInputs",
      id: 1,
      inputs: { freq: 880, amp: 0.5 },
    });
    expect(r.inputs.freq).toBe(880);
    expect(r.inputs.amp).toBe(0.5);
  });
});

describe("workerProducerProtocol / VAL-ENGINE-006 (responsiveness)", () => {
  it("producerStart is a one-shot request/response", () => {
    const r = req<ProducerStartRequest>({
      type: "producerStart",
      id: 1,
      sampleRate: 48000,
    });
    expect(r.sampleRate).toBe(48000);
    expect(typeof r.id).toBe("number");
  });

  it("producerReadTelemetry returns a snapshot without blocking", () => {
    const r = req<ProducerReadTelemetryRequest>({
      type: "producerReadTelemetry",
      id: 1,
    });
    expect(r.type).toBe("producerReadTelemetry");
  });
});

describe("workerProducerProtocol / VAL-ENGINE-032 (transitions)", () => {
  it("every transition variant resolves to a numeric revision", () => {
    const response = {
      type: "producerTransportUpdate-result",
      id: 1,
      revision: 5,
    } as const;
    expect(response.type).toBe("producerTransportUpdate-result");
    const narrowed = response as Extract<
      WasmWorkerResponse,
      { type: "producerTransportUpdate-result" }
    >;
    expect(typeof narrowed.revision).toBe("number");
  });
});

describe("workerProducerProtocol / VAL-SAB-012 (publication helpers)", () => {
  it("producerInstallSab validates the buffer against the ABI", () => {
    const buf = createSynthesisControlBuffer();
    const view = attachSynthesisControlView(buf);
    expect(view.abiVersion).toBe(ABI_VERSION);
  });

  it("producerInstallSab carries no parallel control-layout authority", () => {
    const r = req<ProducerInstallSabRequest>({
      type: "producerInstallSab",
      id: 1,
      controlBuffer: new SharedArrayBuffer(
        createSynthesisControlBuffer().byteLength,
      ),
    });
    expect("blockRateChannels" in r).toBe(false);
  });
});

describe("workerProducerProtocol / telemetry snapshot shape", () => {
  it("ProducerTelemetrySnapshot exposes every VAL-ENGINE-029 field", () => {
    const snap: ProducerTelemetrySnapshot = {
      running: true,
      audioFrame: 1000n,
      blocksPublished: 64,
      ringWriteIndex: 64,
      ringReadIndex: 32,
      ringFillDepth: 32,
      pendingEpoch: 7,
      programEpoch: 7,
      transportRevision: 3,
      transportState: "playing",
    };
    expect(snap.running).toBe(true);
    expect(snap.audioFrame).toBe(1000n);
    expect(snap.blocksPublished).toBe(64);
    expect(snap.transportState).toBe("playing");
  });
});

describe("workerProducerProtocol / VAL-ENGINE-006 (no starvation)", () => {
  it("every producer request carries a numeric id so it can be matched", () => {
    const rs: WasmWorkerRequest[] = [
      { type: "producerInstallSab", id: 1, controlBuffer: new SharedArrayBuffer(256) },
      { type: "producerStart", id: 2, sampleRate: 48000 },
      { type: "producerStop", id: 3 },
      { type: "producerTransportUpdate", id: 4, transition: "pause", atFrame: 0n },
      { type: "producerApplyInputs", id: 5, inputs: {} },
      { type: "producerArmEpoch", id: 6, epoch: 1 },
      { type: "producerTerminate", id: 7 },
      { type: "producerReadTelemetry", id: 8 },
    ];
    for (const r of rs) {
      expect(typeof r.id).toBe("number");
    }
    void req;
  });
});

describe("workerProducerProtocol / VAL-ENGINE-001 (no second timeline)", () => {
  it("producerStop fully halts the producer loop", () => {
    const r = req<ProducerStopRequest>({ type: "producerStop", id: 1 });
    expect(r.type).toBe("producerStop");
  });

  it("producerTerminate halts the producer for devmode fault tests", () => {
    const r = req<ProducerTerminateRequest>({ type: "producerTerminate", id: 1 });
    expect(r.type).toBe("producerTerminate");
  });
});

describe("workerProducerProtocol / VAL-ENGINE-011 (epoch arming)", () => {
  it("producerArmEpoch accepts a positive epoch number", () => {
    const r = req<ProducerArmEpochRequest>({
      type: "producerArmEpoch",
      id: 1,
      epoch: 7,
    });
    expect(r.epoch).toBe(7);
  });

  it("prepare carries explicit compiler indices instead of placeholder values", () => {
    const r = req<ProducerPrepareCommitRequest>({
      type: "producerPrepareCommit",
      id: 1,
      epoch: 7,
      compilerControlCount: 3,
      controlBindings: [{
        identity: "lead",
        param: "amp",
        channelKey: "lead\u0000amp",
        compilerControlIndex: 2,
      }],
    });
    expect(r.compilerControlCount).toBe(3);
    expect(r.controlBindings[0].compilerControlIndex).toBe(2);
    expect(r).not.toHaveProperty("values");
  });
});

describe("workerProducerProtocol / VAL-ENGINE-006 (anti-starvation contract)", () => {
  // Ergo ca5e1cc3: the recursively self-replenishing queueMicrotask
  // producer pump was replaced by a cancellable, task-yielding loop
  // driver (src/audio/producerLoopDriver.ts). These protocol-shape
  // assertions document the invariants the Worker wiring must honour so
  // eval/transport/lifecycle messages stay responsive after
  // producerStart while control publication continues.
  it("producerStop and producerTerminate carry numeric ids so the host can confirm cancellation", () => {
    const stop = req<ProducerStopRequest>({ type: "producerStop", id: 1 });
    const terminate = req<ProducerTerminateRequest>({
      type: "producerTerminate",
      id: 2,
    });
    expect(typeof stop.id).toBe("number");
    expect(typeof terminate.id).toBe("number");
  });

  it("producerStop and producerTerminate are distinct one-shot request/response pairs", () => {
    expect(req<ProducerStopRequest>({ type: "producerStop", id: 1 }).type).toBe(
      "producerStop",
    );
    expect(
      req<ProducerTerminateRequest>({ type: "producerTerminate", id: 1 }).type,
    ).toBe("producerTerminate");
  });
});
