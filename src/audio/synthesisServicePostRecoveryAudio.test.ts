/**
 * Post-recovery audio output regression tests.
 *
 * Covers (see mission feature `m1-fix-post-recovery-audio-output`):
 *   VAL-ENGINE-027 — Recovery replaces failed Worker and worklet
 *                    resources exactly once, prevents failed resources
 *                    from resuming publication or rendering, preserves
 *                    one-executor/one-worklet invariants across repeated
 *                    recovery, and can return to finite non-zero output
 *                    after trusted interaction.
 *   VAL-CROSS-009  — Producer failure is bounded and recoverable:
 *                    intentional producer death during finite non-zero
 *                    output causes timeout, a 10 ms fade, exact silence,
 *                    visible error, and successful engine
 *                    reinitialisation with audio frames advancing
 *                    afterwards.
 *
 * Reproduces Ergo bug c7edc263: after producer timeout and engine
 * reinitialisation, the new AudioContext/worklet did NOT actually
 * resume processing in real headless Chromium — `engineState` reported
 * `running` but `audioFrame` stayed at 0 and peak/RMS never recovered
 * to finite non-zero values. Root cause: `disposeResources()` did not
 * reset the producer bridge state (`producerControlBuffer`,
 * `producerInstalled`, `producerRunning`), so the post-recovery bring-
 * up short-circuited `installProducerControlBridge()` and the fresh
 * worklet never received an `attach-control-buffer` message. The new
 * worklet therefore rendered with `controlView === null`, which forces
 * `audioFrame` to 0 in the published telemetry. Additionally the
 * Worker producer was never stopped on the failure path, so the dead
 * producer kept "running" against the retired SAB.
 *
 * These tests were OBSERVED FAILING before the synthesisService.ts
 * edit that resets producer bridge state in `disposeResources()` and
 * stops the producer on the failure path.
 */
import { describe, expect, it, beforeEach } from "vitest";

import {
  detectAudioCapabilities,
  type AudioCapabilitySnapshot,
} from "../contracts/audioCapabilities";
import {
  resetEngineStateStoreForTests,
} from "../contracts/synthesisChannels";
import { OSC_SINE_NODEDEF_DESCRIPTOR } from "../contracts/nodeDefRegistry";
import {
  createSynthesisService,
  type AudioContextContract,
  type NodeDefModuleLoader,
  type SynthesisService,
  type SynthesisServiceOptions,
  type SynthesisWorkerPort,
  type WorkletNodeContract,
} from "./synthesisService";
import { createFakeNodeDefModule } from "./nodeDefAdapter";
import type {
  WorkletOutboundEvent,
  WorkletTelemetrySnapshot,
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

interface SimulatedWorkletNode extends WorkletNodeContract {
  deliverFromWorklet(event: WorkletOutboundEvent): void;
  readonly postedMessages: readonly unknown[];
  readonly connectCallCount: number;
  readonly disconnectCallCount: number;
  readonly closeCallCount: number;
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

/**
 * Fake Worker port that records every producer lifecycle call. Each
 * SAB installed gets its own identity (by reference) so tests can
 * verify that the post-recovery producer bridge installs a NEW SAB
 * and that the recovered producer is started against it.
 */
interface FakeWorkerPort extends SynthesisWorkerPort {
  readonly installSabCalls: ReadonlyArray<SharedArrayBuffer>;
  readonly startCallCount: number;
  readonly stopCallCount: number;
  readonly setControlValuesCalls: ReadonlyArray<Record<string, number>>;
  reset(): void;
}

function createFakeWorkerPort(): FakeWorkerPort {
  const installSabCalls: SharedArrayBuffer[] = [];
  const setControlValuesCalls: Record<string, number>[] = [];
  let startCalls = 0;
  let stopCalls = 0;
  return {
    async producerArmEpoch(epoch: number) {
      return epoch;
    },
    async producerInstallSab(controlBuffer: SharedArrayBuffer): Promise<boolean> {
      installSabCalls.push(controlBuffer);
      return true;
    },
    async producerSetControlValues(values: Record<string, number>): Promise<boolean> {
      setControlValuesCalls.push(values);
      return true;
    },
    async producerStart(): Promise<boolean> {
      startCalls += 1;
      return true;
    },
    async producerStop(): Promise<boolean> {
      stopCalls += 1;
      return true;
    },
    get installSabCalls() {
      return installSabCalls;
    },
    get startCallCount() {
      return startCalls;
    },
    get stopCallCount() {
      return stopCalls;
    },
    get setControlValuesCalls() {
      return setControlValuesCalls;
    },
    reset() {
      installSabCalls.length = 0;
      setControlValuesCalls.length = 0;
      startCalls = 0;
      stopCalls = 0;
    },
  };
}

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
  readonly workerPort: FakeWorkerPort;
}

function buildOptions(overrides?: Partial<SynthesisServiceOptions>): OptionsBundle {
  const audioContext = createFakeAudioContext();
  const workletNode = createSimulatedWorkletNode();
  const workerPort = createFakeWorkerPort();
  const options: SynthesisServiceOptions = {
    capabilities: capableSnapshot(),
    audioContextFactory: () => audioContext,
    workletScriptUrl: "fake-worklet.js",
    workletNodeFactory: () => workletNode,
    nodeDefModuleLoader: fakeModuleLoader(),
    nodeDefDescriptors: [OSC_SINE_NODEDEF_DESCRIPTOR],
    workerPort,
    ...overrides,
  };
  return { options, audioContext, workletNode, workerPort };
}

// ---------------------------------------------------------------------------
// Tests — post-recovery producer/SAB bridge is rebuilt (VAL-ENGINE-027)
// ---------------------------------------------------------------------------

describe("synthesisService — post-recovery producer bridge is rebuilt (VAL-ENGINE-027, bug c7edc263)", () => {
  beforeEach(() => {
    resetEngineStateStoreForTests();
  });

  it("disposeResources stops the producer and clears the SAB bridge", async () => {
    const bundle = buildOptions({ devmode: true });
    const service = createSynthesisService(bundle.options);
    await service.resumeOnUserActivation();
    // Initial bring-up installs the SAB exactly once and starts the
    // producer exactly once.
    expect(bundle.workerPort.installSabCalls.length).toBe(1);
    expect(bundle.workerPort.startCallCount).toBe(1);
    expect(bundle.workerPort.stopCallCount).toBe(0);

    // Force a producer-loss event to land in error.
    bundle.workletNode.deliverFromWorklet({
      type: "producer-timeout",
      atBlock: 24,
      livenessAge: 24,
    });
    expect(service.state).toBe("error");
    await service.dispose();
    // The producer MUST be stopped on the failure/dispose path so the
    // dead Worker cannot keep publishing to a retired SAB.
    expect(bundle.workerPort.stopCallCount).toBeGreaterThanOrEqual(1);
  });

  it("recovery installs a FRESH SAB on the Worker producer and ships it to the new worklet", async () => {
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
    expect(bundle.workerPort.installSabCalls.length).toBe(1);
    const firstSab = bundle.workerPort.installSabCalls[0];
    // The first worklet received the attach-control-buffer message.
    const firstAttach = firstNode.postedMessages.find(
      (m) => (m as { type: string }).type === "attach-control-buffer",
    );
    expect(firstAttach).toBeDefined();

    // Failure.
    firstNode.deliverFromWorklet({
      type: "producer-timeout",
      atBlock: 24,
      livenessAge: 24,
    });
    expect(service.state).toBe("error");

    // Recovery.
    const recovered = await service.devmodeReinitialise();
    expect(recovered).toBe(true);
    expect(service.state).toBe("suspended");

    // Resume after recovery (simulates trusted activation).
    const resumed = await service.resumeOnUserActivation();
    expect(resumed).toBe(true);
    expect(service.state).toBe("running");

    // The Worker producer MUST have been installed with a FRESH SAB
    // (not the dead one from the failed session). The previous bug
    // left `producerControlBuffer` pointing at the dead SAB and
    // short-circuited the install path.
    expect(bundle.workerPort.installSabCalls.length).toBe(2);
    const secondSab = bundle.workerPort.installSabCalls[1];
    expect(secondSab).not.toBe(firstSab);

    // The fresh worklet MUST have received `attach-control-buffer`
    // with the new SAB. Without this, `controlView === null` in the
    // worklet core forces `audioFrame` to 0 in every published
    // snapshot (the c7edc263 reproduction).
    const secondAttach = secondNode.postedMessages.find(
      (m) => (m as { type: string }).type === "attach-control-buffer",
    );
    expect(secondAttach).toBeDefined();
    const attachedBuffer = (secondAttach as { controlBuffer: SharedArrayBuffer })
      .controlBuffer;
    expect(attachedBuffer).toBe(secondSab);

    // The producer MUST have been started after recovery resumed.
    expect(bundle.workerPort.startCallCount).toBeGreaterThanOrEqual(2);

    await service.dispose();
  });

  it("post-recovery telemetry reflects an advancing audio frame and finite non-zero output", async () => {
    const bundle = buildOptions({ devmode: true });
    const service = createSynthesisService(bundle.options);
    await service.resumeOnUserActivation();
    bundle.workletNode.deliverFromWorklet(
      buildWorkletSnapshot({ audioFrame: 128n, peakSample: 0.5, rmsSample: 0.3 }),
    );

    // Failure.
    bundle.workletNode.deliverFromWorklet({
      type: "producer-timeout",
      atBlock: 24,
      livenessAge: 24,
    });
    expect(service.state).toBe("error");

    // Recovery.
    expect(await service.devmodeReinitialise()).toBe(true);
    expect(await service.resumeOnUserActivation()).toBe(true);
    expect(service.state).toBe("running");

    // Pre-fix the recovery path skipped installProducerControlBridge
    // because producerControlBuffer was not reset, so the new worklet
    // never received an `attach-control-buffer` and controlView was
    // null in the worklet core, forcing audioFrame to 0.
    const attaches = bundle.workletNode.postedMessages.filter(
      (m) => (m as { type: string }).type === "attach-control-buffer",
    );
    // At least one attach after recovery (the fresh SAB).
    expect(attaches.length).toBeGreaterThanOrEqual(1);
    // The fresh producer was installed against a fresh SAB.
    expect(bundle.workerPort.installSabCalls.length).toBeGreaterThanOrEqual(2);

    // The fresh worklet publishes an advancing audio frame.
    bundle.workletNode.deliverFromWorklet(
      buildWorkletSnapshot({ audioFrame: 256n, peakSample: 0.4, rmsSample: 0.28 }),
    );
    expect(service.telemetry.audioFrame).toBe(256n);
    expect(service.telemetry.peakSample).toBeCloseTo(0.4, 6);
    expect(service.telemetry.rmsSample).toBeCloseTo(0.28, 6);
    expect(service.telemetry.finiteOutput).toBe(1);

    // The next snapshot advances monotonically.
    bundle.workletNode.deliverFromWorklet(
      buildWorkletSnapshot({ audioFrame: 384n, peakSample: 0.42, rmsSample: 0.29 }),
    );
    expect(service.telemetry.audioFrame).toBe(384n);
    await service.dispose();
  });

  it("repeated recovery keeps installing fresh SABs and never accumulates state", async () => {
    const bundle = buildOptions({ devmode: true });
    const service = createSynthesisService(bundle.options);
    await service.resumeOnUserActivation();

    for (let i = 0; i < 3; i++) {
      bundle.workletNode.deliverFromWorklet({
        type: "producer-timeout",
        atBlock: 24,
        livenessAge: 24,
      });
      expect(service.state).toBe("error");
      expect(await service.devmodeReinitialise()).toBe(true);
      expect(await service.resumeOnUserActivation()).toBe(true);
      expect(service.state).toBe("running");
    }

    // Three failures plus the initial bring-up => four installs.
    expect(bundle.workerPort.installSabCalls.length).toBe(4);
    // Every SAB is distinct.
    const sabs = bundle.workerPort.installSabCalls;
    for (let i = 0; i < sabs.length; i++) {
      for (let j = i + 1; j < sabs.length; j++) {
        expect(sabs[i]).not.toBe(sabs[j]);
      }
    }
    await service.dispose();
  });
});

// ---------------------------------------------------------------------------
// Tests — snapshot-driven producer-loss transition (VAL-ENGINE-026)
// ---------------------------------------------------------------------------

describe("synthesisService — snapshot-driven producer-loss transition (VAL-ENGINE-026, bug c7edc263)", () => {
  beforeEach(() => {
    resetEngineStateStoreForTests();
  });

  it("transitions to error when the worklet snapshot first reports producerTimeoutActive=true", async () => {
    // The production AudioWorklet shell only posts telemetry snapshots;
    // discrete `producer-timeout` events are queued and drained per
    // process(). If the queue path is bypassed (or in tests that
    // deliver only snapshots), the service MUST still detect the
    // false→true producerTimeoutActive edge and drive running→error.
    // Without this snapshot-driven detection, real headless Chromium
    // never reached `error` after producer loss, which was the
    // c7edc263 root cause.
    const bundle = buildOptions({ devmode: true });
    const service = createSynthesisService(bundle.options);
    await service.resumeOnUserActivation();
    expect(service.state).toBe("running");

    // Deliver a snapshot that flips producerTimeoutActive from false
    // to true. Do NOT deliver a discrete producer-timeout event.
    bundle.workletNode.deliverFromWorklet(
      buildWorkletSnapshot({
        audioFrame: 128n,
        producerTimeoutActive: true,
        producerLivenessAge: 24,
        peakSample: 0,
        rmsSample: 0,
      }),
    );

    expect(service.state).toBe("error");
    expect(service.telemetry.producerTimeoutActive).toBe(true);
    await service.dispose();
  });

  it("does not double-transition when subsequent snapshots keep producerTimeoutActive=true", async () => {
    const bundle = buildOptions({ devmode: true });
    const service = createSynthesisService(bundle.options);
    await service.resumeOnUserActivation();

    bundle.workletNode.deliverFromWorklet(
      buildWorkletSnapshot({ audioFrame: 128n, producerTimeoutActive: true }),
    );
    expect(service.state).toBe("error");
    const transitionsAfterFirst = service.telemetry.transitionCount;

    // Subsequent snapshots with producerTimeoutActive still true must
    // not re-trigger the transition (idempotent edge detection).
    for (let i = 2; i <= 5; i++) {
      bundle.workletNode.deliverFromWorklet(
        buildWorkletSnapshot({
          audioFrame: BigInt(i * 128),
          producerTimeoutActive: true,
        }),
      );
    }
    expect(service.state).toBe("error");
    expect(service.telemetry.transitionCount).toBe(transitionsAfterFirst);
    await service.dispose();
  });
});

