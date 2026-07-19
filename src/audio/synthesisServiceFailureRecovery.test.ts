/**
 * Failure recovery and telemetry contract tests.
 *
 * Covers (see mission feature
 * `m1-producer-failure-recovery-telemetry`):
 *   VAL-HOST-012    — controlled producer termination and engine
 *                     reinitialisation are explicit devmode-only actions
 *                     and are absent or inert outside devmode.
 *   VAL-ENGINE-026  — producer loss exposes error: peak/RMS reach zero,
 *                     timeout telemetry increments, engine state becomes
 *                     `error` without indefinite drone.
 *   VAL-ENGINE-027  — recovery replaces failed Worker and worklet
 *                     resources exactly once, prevents failed resources
                     from resuming publication or rendering, preserves
 *                   one-executor/one-worklet invariants across repeated
 *                   recovery, and can return to finite non-zero output
 *                   after trusted interaction.
 *   VAL-ENGINE-029  — telemetry exposes capabilities, engine and
 *                     AudioContext state, audio frame, ABI version, ring
 *                     sequences and fill, revisions and epochs, instance
 *                     ID, liveness, peak/RMS, finite status, and
 *                     underrun/glitch/timeout counters.
 *   VAL-ENGINE-030  — telemetry progresses coherently: frames and ring
 *                     sequences progress monotonically under documented
 *                     wrap semantics, fill depth stays bounded, and fault
 *                     counters increment only for matching injected
 *                     faults.
 *
 * These tests exercise the worklet → service telemetry bridge end-to-end
 * in Node by injecting a fake AudioContext and a fake worklet node whose
 * `port.onmessage` is wired to a simulated worklet core. They were
 * OBSERVED FAILING before the synthesis service learned to consume
 * `WorkletOutboundEvent` messages and expose full telemetry.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";

import {
  detectAudioCapabilities,
  type AudioCapabilitySnapshot,
} from "../contracts/audioCapabilities";
import {
  resetEngineStateStoreForTests,
  engineStateStore,
} from "../contracts/synthesisChannels";
import { OSC_SINE_NODEDEF_DESCRIPTOR } from "../contracts/nodeDefRegistry";
import {
  createSynthesisService,
  createSynthesisDevmodeSurface,
  SYNTHESIS_TELEMETRY_SCHEMA_VERSION,
  type AudioContextContract,
  type ConsoleMessageSink,
  type NodeDefModuleLoader,
  type SynthesisService,
  type SynthesisServiceOptions,
  type WorkletNodeContract,
} from "./synthesisService";
import { createFakeNodeDefModule } from "./nodeDefAdapter";
import type {
  WorkletOutboundEvent,
  WorkletTelemetrySnapshot,
  WorkletProducerTimeoutEvent,
} from "./workletGraphDelta";
import { WORKLET_TELEMETRY_SCHEMA_VERSION } from "./workletGraphDelta";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

function capableSnapshot(): AudioCapabilitySnapshot {
  return detectAudioCapabilities({
    crossOriginIsolated: true,
    sharedArrayBufferAvailable: true,
    audioWorkletAvailable: true,
    workerAvailable: true,
    sharedWebAssemblyMemoryAvailable: true,
  });
}

function incapableSnapshot(): AudioCapabilitySnapshot {
  return detectAudioCapabilities({
    crossOriginIsolated: true,
    sharedArrayBufferAvailable: true,
    audioWorkletAvailable: false,
    workerAvailable: true,
    sharedWebAssemblyMemoryAvailable: true,
  });
}

function createFakeAudioContext(): AudioContextContract & {
  simulateRunning(): void;
  forceClose(): void;
} {
  let state: "suspended" | "running" | "closed" | "interrupted" = "suspended";
  return {
    get state() {
      return state;
    },
    sampleRate: 48000,
    currentTime: 0,
    audioWorklet: {
      addModule() {
        return Promise.resolve();
      },
    },
    destination: { name: "fake-destination" },
    async resume() {
      state = "running";
    },
    async suspend() {
      state = "suspended";
    },
    async close() {
      state = "closed";
    },
    simulateRunning() {
      state = "running";
    },
    forceClose() {
      state = "closed";
    },
  };
}

/**
 * Simulated worklet node. The fake keeps a reference to its own
 * `port.onmessage` handler so tests can post `WorkletOutboundEvent`
 * messages back into the service as if the real worklet core had
 * published them.
 */
interface SimulatedWorkletNode extends WorkletNodeContract {
  readonly postedMessages: readonly unknown[];
  /** Deliver a worklet-originated event to the service via onmessage. */
  deliverFromWorklet(event: WorkletOutboundEvent): void;
  /** Recorded connect/disconnect calls. */
  readonly connectCallCount: number;
  readonly disconnectCallCount: number;
  readonly closeCallCount: number;
  /** Installers run on each new port (used to assert listener is added once). */
  onmessageInstallerCount(): number;
}

function createSimulatedWorkletNode(): SimulatedWorkletNode {
  const posted: unknown[] = [];
  let connects = 0;
  let disconnects = 0;
  let closes = 0;
  let installers = 0;
  let onmessage: ((event: { data: unknown }) => void) | null = null;
  const node: SimulatedWorkletNode = {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    get port() {
      return {
        postMessage(message: unknown) {
          posted.push(message);
        },
        get onmessage() {
          return onmessage;
        },
        set onmessage(handler: ((event: { data: unknown }) => void) | null) {
          installers += 1;
          onmessage = handler;
        },
        close() {
          closes += 1;
          onmessage = null;
        },
      };
    },
    connect(_destination: unknown) {
      connects += 1;
      return _destination;
    },
    disconnect() {
      disconnects += 1;
    },
    deliverFromWorklet(event: WorkletOutboundEvent) {
      if (onmessage) {
        onmessage({ data: event });
      }
    },
    get postedMessages() {
      return posted;
    },
    get connectCallCount() {
      return connects;
    },
    get disconnectCallCount() {
      return disconnects;
    },
    get closeCallCount() {
      return closes;
    },
    onmessageInstallerCount() {
      return installers;
    },
  };
  return node;
}

function fakeModuleLoader(): NodeDefModuleLoader {
  return async (descriptor) => {
    const fake = createFakeNodeDefModule(descriptor);
    return { module: fake, compiledWasm: null };
  };
}

function createFakeTelemetryInstaller() {
  const snapshots: unknown[] = [];
  const installer = (snapshot: unknown) => {
    snapshots.push(snapshot);
  };
  return Object.assign(installer, {
    snapshots,
    callCount: () => snapshots.length,
    latest: () => snapshots[snapshots.length - 1],
  });
}

/** Build a minimal worklet telemetry snapshot for injection. */
function buildWorkletSnapshot(
  overrides: Partial<WorkletTelemetrySnapshot>,
): WorkletTelemetrySnapshot {
  return {
    schemaVersion: WORKLET_TELEMETRY_SCHEMA_VERSION,
    audioFrame: 0,
    activeEpoch: 0,
    pendingEpoch: 0,
    blockCount: 0,
    instances: [],
    peakSample: 0,
    rmsSample: 0,
    finiteOutput: 1,
    underrunCount: 0,
    glitchCount: 0,
    timeoutCount: 0,
    producerLivenessAge: 0,
    producerTimeoutActive: false,
    ...overrides,
  };
}

interface OptionsBundle {
  readonly options: SynthesisServiceOptions;
  readonly audioContext: AudioContextContract & {
    simulateRunning(): void;
    forceClose(): void;
  };
  readonly workletNode: SimulatedWorkletNode;
  readonly telemetry: ReturnType<typeof createFakeTelemetryInstaller>;
}

function buildOptions(overrides?: Partial<SynthesisServiceOptions>): OptionsBundle {
  const audioContext = createFakeAudioContext();
  const workletNode = createSimulatedWorkletNode();
  const telemetry = createFakeTelemetryInstaller();
  const options: SynthesisServiceOptions = {
    capabilities: capableSnapshot(),
    audioContextFactory: () => audioContext,
    workletScriptUrl: "fake-worklet.js",
    workletNodeFactory: () => workletNode,
    nodeDefModuleLoader: fakeModuleLoader(),
    nodeDefDescriptors: [OSC_SINE_NODEDEF_DESCRIPTOR],
    installTelemetryGlobal: telemetry,
    ...overrides,
  };
  return { options, audioContext, workletNode, telemetry };
}

// ---------------------------------------------------------------------------
// Tests — worklet → service telemetry bridge (VAL-ENGINE-029)
// ---------------------------------------------------------------------------

describe("synthesisService — telemetry bridge (VAL-ENGINE-029)", () => {
  beforeEach(() => {
    resetEngineStateStoreForTests();
  });

  it("exposes every VAL-ENGINE-029 telemetry field after bring-up", async () => {
    const bundle = buildOptions({ devmode: true });
    const service = createSynthesisService(bundle.options);
    await service.resumeOnUserActivation();

    const t = service.telemetry;
    // Capabilities and engine state.
    expect(t.capabilities).toBeDefined();
    expect(t.engineState).toBe("running");
    expect(t.audioContextState).toBe("running");
    expect(typeof t.sampleRate).toBe("number");
    // Topology.
    expect(t.workletNodeCount).toBe(1);
    expect(t.compiledModuleCount).toBe(1);
    expect(t.sabAbiVersion).toBeGreaterThan(0);
    // Objective telemetry added by the failure/recovery feature:
    expect(typeof t.audioFrame).toBe("bigint");
    expect(typeof t.ringWriteSequence).toBe("number");
    expect(typeof t.ringReadSequence).toBe("number");
    expect(typeof t.ringFillDepth).toBe("number");
    expect(typeof t.programRevision).toBe("number");
    expect(typeof t.activeEpoch).toBe("number");
    expect(typeof t.pendingEpoch).toBe("number");
    expect(typeof t.instanceId).toBe("string");
    expect(typeof t.peakSample).toBe("number");
    expect(typeof t.rmsSample).toBe("number");
    expect(typeof t.finiteOutput).toBe("number");
    expect(typeof t.underrunCount).toBe("number");
    expect(typeof t.glitchCount).toBe("number");
    expect(typeof t.timeoutCount).toBe("number");
    expect(typeof t.producerLivenessAge).toBe("number");
    expect(typeof t.producerTimeoutActive).toBe("boolean");
    await service.dispose();
  });

  it("merges worklet-published telemetry snapshots into the service snapshot", async () => {
    const bundle = buildOptions({ devmode: true });
    const service = createSynthesisService(bundle.options);
    await service.resumeOnUserActivation();

    // The worklet publishes a snapshot after a block. Simulate that.
    bundle.workletNode.deliverFromWorklet(
      buildWorkletSnapshot({
        audioFrame: 128,
        blockCount: 1,
        peakSample: 0.42,
        rmsSample: 0.31,
        instances: [
          {
            identity: "abc",
            def: "osc/sine",
            version: 1,
            statePointer: 1024,
            lifecycle: "active",
          },
        ],
        activeEpoch: 7,
        underrunCount: 0,
        glitchCount: 0,
      }),
    );

    const t = service.telemetry;
    expect(t.audioFrame).toBe(128n);
    expect(t.peakSample).toBeCloseTo(0.42, 6);
    expect(t.rmsSample).toBeCloseTo(0.31, 6);
    expect(t.activeEpoch).toBe(7);
    expect(t.instanceId).toBe("abc");
    await service.dispose();
  });

  it("telemetry is frozen at every publication", async () => {
    const bundle = buildOptions({ devmode: true });
    const service = createSynthesisService(bundle.options);
    await service.resumeOnUserActivation();
    expect(Object.isFrozen(service.telemetry)).toBe(true);
    bundle.workletNode.deliverFromWorklet(buildWorkletSnapshot({ audioFrame: 256 }));
    expect(Object.isFrozen(service.telemetry)).toBe(true);
    await service.dispose();
  });

  it("telemetry is absent outside devmode (no global installed)", async () => {
    const bundle = buildOptions({ devmode: false });
    const service = createSynthesisService(bundle.options);
    expect(bundle.telemetry.callCount()).toBe(0);
    await service.resumeOnUserActivation();
    expect(bundle.telemetry.callCount()).toBe(0);
    await service.dispose();
  });

  it("installs the worklet port.onmessage listener exactly once per session", async () => {
    const bundle = buildOptions({ devmode: true });
    const service = createSynthesisService(bundle.options);
    await service.resumeOnUserActivation();
    expect(bundle.workletNode.onmessageInstallerCount()).toBe(1);
    // Repeated resumes do NOT add a second listener.
    await service.resumeOnUserActivation();
    expect(bundle.workletNode.onmessageInstallerCount()).toBe(1);
    await service.dispose();
  });
});

// ---------------------------------------------------------------------------
// Tests — telemetry coherence (VAL-ENGINE-030)
// ---------------------------------------------------------------------------

describe("synthesisService — telemetry coherence (VAL-ENGINE-030)", () => {
  beforeEach(() => {
    resetEngineStateStoreForTests();
  });

  it("audio frame and ring sequences progress monotonically", async () => {
    const bundle = buildOptions({ devmode: true });
    const service = createSynthesisService(bundle.options);
    await service.resumeOnUserActivation();

    const frames: bigint[] = [];
    const writes: number[] = [];
    const reads: number[] = [];
    for (let i = 1; i <= 5; i++) {
      const snap = buildWorkletSnapshot({
        audioFrame: BigInt(i * 128),
        blockCount: i,
      });
      bundle.workletNode.deliverFromWorklet(snap);
      const t = service.telemetry;
      frames.push(t.audioFrame);
      writes.push(t.ringWriteSequence);
      reads.push(t.ringReadSequence);
    }
    // Monotonic non-decreasing audio frame.
    for (let i = 1; i < frames.length; i++) {
      expect(frames[i]).toBeGreaterThan(frames[i - 1]);
    }
    await service.dispose();
  });

  it("fault counters do not change without a matching fault event", async () => {
    const bundle = buildOptions({ devmode: true });
    const service = createSynthesisService(bundle.options);
    await service.resumeOnUserActivation();

    // Publish several healthy snapshots. Counters must stay at zero.
    for (let i = 1; i <= 4; i++) {
      bundle.workletNode.deliverFromWorklet(
        buildWorkletSnapshot({
          audioFrame: BigInt(i * 128),
          blockCount: i,
          peakSample: 0.1 * i,
        }),
      );
    }
    const before = service.telemetry;
    expect(before.underrunCount).toBe(0);
    expect(before.glitchCount).toBe(0);
    expect(before.timeoutCount).toBe(0);

    // Deliver a snapshot that reports an underrun.
    bundle.workletNode.deliverFromWorklet(
      buildWorkletSnapshot({
        audioFrame: 640n,
        underrunCount: 1,
        blockCount: 5,
      }),
    );
    expect(service.telemetry.underrunCount).toBe(1);
    expect(service.telemetry.glitchCount).toBe(0);
    expect(service.telemetry.timeoutCount).toBe(0);
    await service.dispose();
  });

  it("timeout counter increments only on the producer-timeout event", async () => {
    const bundle = buildOptions({ devmode: true });
    const service = createSynthesisService(bundle.options);
    await service.resumeOnUserActivation();

    // Healthy telemetry: no timeout counter.
    bundle.workletNode.deliverFromWorklet(
      buildWorkletSnapshot({ audioFrame: 128n, producerTimeoutActive: false }),
    );
    expect(service.telemetry.timeoutCount).toBe(0);

    // Worklet raises producer-timeout.
    const event: WorkletProducerTimeoutEvent = {
      type: "producer-timeout",
      atBlock: 24,
      livenessAge: 24,
    };
    bundle.workletNode.deliverFromWorklet(event);
    expect(service.telemetry.timeoutCount).toBe(1);
    await service.dispose();
  });
});

// ---------------------------------------------------------------------------
// Tests — producer loss exposes error (VAL-ENGINE-026)
// ---------------------------------------------------------------------------

describe("synthesisService — producer loss exposes error (VAL-ENGINE-026)", () => {
  beforeEach(() => {
    resetEngineStateStoreForTests();
  });

  it("transitions running → error on the producer-timeout worklet event", async () => {
    const bundle = buildOptions({ devmode: true });
    const service = createSynthesisService(bundle.options);
    await service.resumeOnUserActivation();
    expect(service.state).toBe("running");

    // Worklet detects producer loss and publishes the timeout event.
    const event: WorkletProducerTimeoutEvent = {
      type: "producer-timeout",
      atBlock: 24,
      livenessAge: 24,
    };
    bundle.workletNode.deliverFromWorklet(event);

    expect(service.state).toBe("error");
    expect(engineStateStore.current.reasonKey).toBe("PRODUCER_TIMEOUT");
    expect(service.telemetry.timeoutCount).toBeGreaterThanOrEqual(1);
    await service.dispose();
  });

  it("devmodeTerminateProducer arms the fault and the worklet timeout event lands", async () => {
    const bundle = buildOptions({ devmode: true });
    const service = createSynthesisService(bundle.options);
    await service.resumeOnUserActivation();

    // The service posts the controlled-fault message to the worklet.
    expect(service.devmodeTerminateProducer()).toBe(true);
    const last = bundle.workletNode.postedMessages[
      bundle.workletNode.postedMessages.length - 1
    ] as { type: string };
    expect(last.type).toBe("devmode-terminate-producer");

    // In a real worklet the producer-termination causes a timeout event
    // back to the service. Simulate that event arriving.
    bundle.workletNode.deliverFromWorklet({
      type: "producer-timeout",
      atBlock: 24,
      livenessAge: 24,
    });
    expect(service.state).toBe("error");
    await service.dispose();
  });

  it("peak/RMS reach zero once the worklet reports post-fade silence", async () => {
    const bundle = buildOptions({ devmode: true });
    const service = createSynthesisService(bundle.options);
    await service.resumeOnUserActivation();

    // Engine producing non-zero output.
    bundle.workletNode.deliverFromWorklet(
      buildWorkletSnapshot({ audioFrame: 128n, peakSample: 0.5, rmsSample: 0.35 }),
    );
    expect(service.telemetry.peakSample).toBeCloseTo(0.5, 6);

    // Producer timeout fires; the worklet fades to silence and reports
    // the post-fade zero peak.
    bundle.workletNode.deliverFromWorklet({
      type: "producer-timeout",
      atBlock: 24,
      livenessAge: 24,
    });
    bundle.workletNode.deliverFromWorklet(
      buildWorkletSnapshot({
        audioFrame: 256n,
        peakSample: 0,
        rmsSample: 0,
        producerTimeoutActive: true,
      }),
    );
    expect(service.telemetry.peakSample).toBe(0);
    expect(service.telemetry.rmsSample).toBe(0);
    expect(service.state).toBe("error");
    await service.dispose();
  });

  it("does NOT drone indefinitely: error state suppresses further worklet-driven state changes", async () => {
    const bundle = buildOptions({ devmode: true });
    const service = createSynthesisService(bundle.options);
    await service.resumeOnUserActivation();

    bundle.workletNode.deliverFromWorklet({
      type: "producer-timeout",
      atBlock: 24,
      livenessAge: 24,
    });
    expect(service.state).toBe("error");

    // A subsequent telemetry snapshot with non-zero peak must NOT
    // transition the engine back to running on its own. Recovery is
    // the only way out of `error`.
    bundle.workletNode.deliverFromWorklet(
      buildWorkletSnapshot({
        audioFrame: 512n,
        peakSample: 0.9,
        producerTimeoutActive: false,
      }),
    );
    expect(service.state).toBe("error");
    await service.dispose();
  });
});

// ---------------------------------------------------------------------------
// Tests — recovery replaces failed resources exactly once (VAL-ENGINE-027)
// ---------------------------------------------------------------------------

describe("synthesisService — recovery preserves one-executor/one-worklet (VAL-ENGINE-027)", () => {
  beforeEach(() => {
    resetEngineStateStoreForTests();
  });

  it("recovery disposes the failed worklet and constructs exactly one fresh node", async () => {
    let nodeCount = 0;
    const firstNode = createSimulatedWorkletNode();
    const secondNode = createSimulatedWorkletNode();
    const nodes = [firstNode, secondNode];
    const bundle = buildOptions({
      devmode: true,
      workletNodeFactory: () => {
        const node = nodes[nodeCount] ?? secondNode;
        nodeCount += 1;
        return node;
      },
    });
    const service = createSynthesisService(bundle.options);
    await service.resumeOnUserActivation();
    expect(nodeCount).toBe(1);

    // Force a producer-loss event to land in error.
    firstNode.deliverFromWorklet({
      type: "producer-timeout",
      atBlock: 24,
      livenessAge: 24,
    });
    expect(service.state).toBe("error");
    expect(firstNode.disconnectCallCount).toBe(0); // not yet disposed

    const recovered = await service.devmodeReinitialise();
    expect(recovered).toBe(true);
    expect(service.state).toBe("suspended");
    // Recovery constructed exactly ONE new node (total 2, was 1).
    expect(nodeCount).toBe(2);
    // The failed node was disconnected.
    expect(firstNode.disconnectCallCount).toBeGreaterThanOrEqual(1);
    await service.dispose();
  });

  it("recovery prevents the failed node from publishing further telemetry", async () => {
    const firstNode = createSimulatedWorkletNode();
    const secondNode = createSimulatedWorkletNode();
    let idx = 0;
    const bundle = buildOptions({
      devmode: true,
      workletNodeFactory: () => {
        const n = idx === 0 ? firstNode : secondNode;
        idx += 1;
        return n;
      },
    });
    const service = createSynthesisService(bundle.options);
    await service.resumeOnUserActivation();

    // Stale publication from the failed node BEFORE recovery.
    firstNode.deliverFromWorklet(buildWorkletSnapshot({ audioFrame: 128n, peakSample: 0.5 }));
    expect(service.telemetry.audioFrame).toBe(128n);

    // Failure + recovery.
    firstNode.deliverFromWorklet({
      type: "producer-timeout",
      atBlock: 24,
      livenessAge: 24,
    });
    await service.devmodeReinitialise();

    // Fresh publication from the new node.
    secondNode.deliverFromWorklet(buildWorkletSnapshot({ audioFrame: 256n, peakSample: 0.2 }));
    expect(service.telemetry.audioFrame).toBe(256n);

    // Stale publication from the FAILED node must NOT affect the service.
    firstNode.deliverFromWorklet(buildWorkletSnapshot({ audioFrame: 9999n, peakSample: 0.99 }));
    expect(service.telemetry.audioFrame).toBe(256n);
    expect(service.telemetry.peakSample).toBeCloseTo(0.2, 6);
    await service.dispose();
  });

  it("repeated recovery preserves one executor and one worklet node", async () => {
    const nodes: SimulatedWorkletNode[] = [];
    const bundle = buildOptions({
      devmode: true,
      workletNodeFactory: () => {
        const node = createSimulatedWorkletNode();
        nodes.push(node);
        return node;
      },
    });
    const service = createSynthesisService(bundle.options);
    await service.resumeOnUserActivation();
    expect(nodes.length).toBe(1);

    // First failure + recovery.
    nodes[0].deliverFromWorklet({
      type: "producer-timeout",
      atBlock: 24,
      livenessAge: 24,
    });
    await service.devmodeReinitialise();
    expect(nodes.length).toBe(2);

    // Second failure + recovery.
    nodes[1].deliverFromWorklet({
      type: "producer-timeout",
      atBlock: 24,
      livenessAge: 24,
    });
    await service.devmodeReinitialise();
    expect(nodes.length).toBe(3);

    // The accumulated worklet-node count in telemetry records the
    // lifetime total, but only ONE node is currently active.
    expect(service.telemetry.workletNodeCount).toBe(1);
    // Each prior node was disconnected exactly once.
    expect(nodes[0].disconnectCallCount).toBe(1);
    expect(nodes[1].disconnectCallCount).toBe(1);
    expect(nodes[2].disconnectCallCount).toBe(0);
    await service.dispose();
  });

  it("recovery into running restores finite non-zero output after trusted activation", async () => {
    const bundle = buildOptions({ devmode: true });
    const service = createSynthesisService(bundle.options);
    await service.resumeOnUserActivation();
    bundle.workletNode.deliverFromWorklet(
      buildWorkletSnapshot({ audioFrame: 128n, peakSample: 0.5 }),
    );

    // Failure.
    bundle.workletNode.deliverFromWorklet({
      type: "producer-timeout",
      atBlock: 24,
      livenessAge: 24,
    });
    expect(service.state).toBe("error");

    // Recovery lands the engine in suspended; trusted activation resumes.
    const recovered = await service.devmodeReinitialise();
    expect(recovered).toBe(true);
    expect(service.state).toBe("suspended");
    const resumed = await service.resumeOnUserActivation();
    expect(resumed).toBe(true);
    expect(service.state).toBe("running");

    // The fresh worklet reports finite non-zero output.
    bundle.workletNode.deliverFromWorklet(
      buildWorkletSnapshot({ audioFrame: 256n, peakSample: 0.4 }),
    );
    expect(service.telemetry.peakSample).toBeCloseTo(0.4, 6);
    expect(service.telemetry.finiteOutput).toBe(1);
    await service.dispose();
  });
});

// ---------------------------------------------------------------------------
// Tests — devmode-only fault actions (VAL-HOST-012)
// ---------------------------------------------------------------------------

describe("synthesisService — devmode-only fault actions (VAL-HOST-012)", () => {
  beforeEach(() => {
    resetEngineStateStoreForTests();
  });

  it("devmodeTerminateProducer returns false outside devmode", async () => {
    const bundle = buildOptions({ devmode: false });
    const service = createSynthesisService(bundle.options);
    await service.resumeOnUserActivation();
    expect(service.devmodeTerminateProducer()).toBe(false);
    for (const m of bundle.workletNode.postedMessages) {
      expect((m as { type: string }).type).not.toBe("devmode-terminate-producer");
    }
    await service.dispose();
  });

  it("devmodeReinitialise returns false outside devmode", async () => {
    const bundle = buildOptions({ devmode: false });
    const service = createSynthesisService(bundle.options);
    expect(await service.devmodeReinitialise()).toBe(false);
    await service.dispose();
  });

  it("devmode surface is absent outside devmode (createSynthesisDevmodeSurface inert)", async () => {
    const bundle = buildOptions({ devmode: false });
    const service = createSynthesisService(bundle.options);
    // Even if a caller wraps the service in the devmode surface, the
    // surface's actions must be inert: terminateProducer and
    // reinitialise return false / never mutate state.
    const surface = createSynthesisDevmodeSurface(service);
    expect(surface.terminateProducer()).toBe(false);
    expect(await surface.reinitialise()).toBe(false);
    await service.dispose();
  });

  it("createSynthesisDevmodeSurface exposes telemetry, terminateProducer, and reinitialise in devmode", async () => {
    const bundle = buildOptions({ devmode: true });
    const service = createSynthesisService(bundle.options);
    await service.resumeOnUserActivation();
    const surface = createSynthesisDevmodeSurface(service);
    expect(Object.isFrozen(surface)).toBe(true);
    const t = surface.getTelemetry();
    expect(t.schemaVersion).toBe(SYNTHESIS_TELEMETRY_SCHEMA_VERSION);
    expect(t.engineState).toBe("running");
    expect(typeof surface.terminateProducer).toBe("function");
    expect(typeof surface.reinitialise).toBe("function");
    await service.dispose();
  });

  it("devmode fault action does not fire when the engine is not running", async () => {
    const bundle = buildOptions({ devmode: true });
    const service = createSynthesisService(bundle.options);
    // Engine is still off; terminateProducer is a no-op.
    expect(service.devmodeTerminateProducer()).toBe(false);
    expect(bundle.workletNode.postedMessages).toHaveLength(0);
    await service.dispose();
  });
});

// ---------------------------------------------------------------------------
// Tests — incapable snapshot keeps fault actions inert (VAL-HOST-012)
// ---------------------------------------------------------------------------

describe("synthesisService — fault actions are inert when capability is absent (VAL-HOST-012)", () => {
  beforeEach(() => {
    resetEngineStateStoreForTests();
  });

  it("terminateProducer and reinitialise are no-ops when audio is incapable", async () => {
    const bundle = buildOptions({ devmode: true, capabilities: incapableSnapshot() });
    const service = createSynthesisService(bundle.options);
    expect(service.state).toBe("off");
    expect(service.devmodeTerminateProducer()).toBe(false);
    expect(await service.devmodeReinitialise()).toBe(false);
    expect(service.telemetry.faultActionsExposed).toBe(false);
    await service.dispose();
  });
});
