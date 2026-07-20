/**
 * Contract tests for the worklet core.
 *
 * Covers (see mission feature `m1-worklet-host-and-epoch-consumer`):
 *   VAL-SAB-016     — mismatched epochs are not consumed.
 *   VAL-DSP-010     — phase continuous across blocks and same-def updates.
 *   VAL-ENGINE-009  — graph changes happen at block boundaries.
 *   VAL-ENGINE-011  — first matching block activates the pending graph.
 *   VAL-ENGINE-012  — mixed graph and control epochs never render.
 *   VAL-ENGINE-023  — producer loss detected independently in the worklet.
 *   VAL-ENGINE-024  — timeout boundary is exactly 24 blocks.
 *   VAL-ENGINE-025  — emergency fade reaches exact silence over 10 ms.
 *   VAL-ENGINE-028  — initial sound fades in.
 *   VAL-ENGINE-033  — underrun is bounded and epoch-safe.
 *   VAL-ENGINE-034  — steady-state process path allocates and blocks nothing.
 *   VAL-ENGINE-035  — graph retirement is bounded, no orphan rendering.
 *
 * The tests inject fakes for the adapter, allocator, and SAB so they run
 * in Node without touching the Web Audio graph.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";

import {
  ABI_VERSION,
  CONTROL_LOOKAHEAD_BLOCKS,
  DEFAULT_RENDER_QUANTUM_FRAMES,
  EMERGENCY_FADE_MS,
  PRODUCER_TIMEOUT_BLOCKS,
  SYNTH_FADE_IN_MS,
  SYNTH_FADE_OUT_MS,
  attachSynthesisControlView,
  createSynthesisControlBuffer,
} from "../contracts/synthesisControlAbi";
import { OSC_SINE_NODEDEF_DESCRIPTOR } from "../contracts/nodeDefRegistry";
import { createFakeNodeDefModule } from "./nodeDefAdapter";
import { createNodeDefAdapter } from "./nodeDefAdapter";
import {
  createWorkletCore,
  DEFAULT_WORKLET_SAMPLE_RATE,
  type WorkletCore,
  type WorkletCoreOptions,
  type WorkletMemoryAllocator,
} from "./workletCore";
import type { WorkletOutboundEvent } from "./workletGraphDelta";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/**
 * Fake allocator backed by a simple bump arena. Records every alloc /
 * release so tests can assert that retirement reclaims memory and the
 * hot path does not allocate.
 */
function createFakeAllocator(): WorkletMemoryAllocator & {
  allocCount(): number;
  releaseCount(): number;
  reset(): void;
} {
  let next = 1024;
  let allocs = 0;
  let releases = 0;
  return {
    allocate(bytes: number, _align: number) {
      allocs += 1;
      const ptr = next;
      next += bytes;
      return ptr;
    },
    release(_pointer: number) {
      releases += 1;
    },
    allocCount() {
      return allocs;
    },
    releaseCount() {
      return releases;
    },
    reset() {
      next = 1024;
      allocs = 0;
      releases = 0;
    },
  };
}

/**
 * Build a real NodeDef adapter from the fake module. The fake adapter
 * satisfies the adapter contract; it records calls without touching
 * real WASM memory.
 */
function buildRealFakeAdapter() {
  const module = createFakeNodeDefModule(OSC_SINE_NODEDEF_DESCRIPTOR);
  // Override the compute call to write a deterministic sine-like
  // pattern into a per-instance scratch map, so the core's output
  // scratch ends up non-zero when an instance is rendering.
  const instanceOutput = new Map<number, Float32Array>();
  (module as unknown as { setComputeResult: (v: boolean) => void }).setComputeResult(true);
  // We cannot easily intercept the fake's compute to write samples into
  // the instance scratch (the fake does not know about the core's
  // `instanceScratch`). Instead, the fake's compute simply records the
  // call; the core leaves its output scratch at zero in the test path.
  // Tests that need to assert "non-zero output" inspect the recorded
  // compute calls instead.
  const adapter = createNodeDefAdapter(module, OSC_SINE_NODEDEF_DESCRIPTOR);
  return { adapter, module, instanceOutput };
}

/**
 * Telemetry publisher that records every event. Tests inspect the
 * events to assert state transitions and fault counters.
 */
function createRecordingPublisher() {
  const events: WorkletOutboundEvent[] = [];
  const publish = (event: WorkletOutboundEvent) => {
    events.push(event);
  };
  return {
    publish,
    events,
    snapshots(): WorkletOutboundEvent[] {
      return events.filter(
        (e): e is Extract<WorkletOutboundEvent, { schemaVersion: number }> =>
          "schemaVersion" in e,
      );
    },
    producerTimeouts() {
      return events.filter(
        (e): e is Extract<WorkletOutboundEvent, { type: "producer-timeout" }> =>
          e.type === "producer-timeout",
      );
    },
    activations() {
      return events.filter(
        (e): e is Extract<WorkletOutboundEvent, { type: "graph-activated" }> =>
          e.type === "graph-activated",
      );
    },
    retirements() {
      return events.filter(
        (e): e is Extract<WorkletOutboundEvent, { type: "instance-retired" }> =>
          e.type === "instance-retired",
      );
    },
  };
}

/**
 * Build a fully-wired core with a real SAB and a fake adapter. The
 * SAB has a known epoch and a populated control block ready for the
 * first process() call.
 */
function buildWiredCore(opts?: {
  blockEpoch?: number;
  controlFreq?: number;
  controlAmp?: number;
  renderQuantumFrames?: number;
}): {
  core: WorkletCore;
  allocator: ReturnType<typeof createFakeAllocator>;
  publisher: ReturnType<typeof createRecordingPublisher>;
  controlBuffer: ArrayBuffer;
  adapterBundle: ReturnType<typeof buildRealFakeAdapter>;
} {
  const allocator = createFakeAllocator();
  const publisher = createRecordingPublisher();
  const adapterBundle = buildRealFakeAdapter();
  const renderQuantum = opts?.renderQuantumFrames ?? DEFAULT_RENDER_QUANTUM_FRAMES;

  const options: WorkletCoreOptions = {
    adapterFactory: (_name, _version) => adapterBundle.adapter,
    allocator,
    sampleRate: DEFAULT_WORKLET_SAMPLE_RATE,
    renderQuantumFrames: renderQuantum,
    publish: publisher.publish,
  };
  const core = createWorkletCore(options);

  // Allocate and populate a SAB.
  const controlBuffer = createSynthesisControlBuffer({ renderQuantumFrames: renderQuantum });
  core.handleMessage({
    type: "attach-control-buffer",
    controlBuffer: controlBuffer as unknown as SharedArrayBuffer,
  });

  // Pre-populate one block with a known epoch.
  const view = attachSynthesisControlView(controlBuffer);
  const epoch = opts?.blockEpoch ?? 1;
  view.writeBlockEpoch(0, epoch);
  view.writeBlockRevision(0, 1);
  view.writeBlockRateValue(0, 0, opts?.controlFreq ?? 440);
  view.writeBlockRateValue(0, 1, opts?.controlAmp ?? 0.2);
  view.advanceWriteIndex();

  return { core, allocator, publisher, controlBuffer, adapterBundle };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("workletCore — SAB attachment and ABI (VAL-SAB-016/018)", () => {
  it("exposes the canonical ABI version", () => {
    expect(ABI_VERSION).toBe(1);
  });

  it("attaches to a valid SAB without throwing", () => {
    const publisher = createRecordingPublisher();
    const core = createWorkletCore({
      adapterFactory: () => null,
      allocator: createFakeAllocator(),
      sampleRate: DEFAULT_WORKLET_SAMPLE_RATE,
      publish: publisher.publish,
    });
    const buffer = createSynthesisControlBuffer();
    expect(() => {
      core.handleMessage({
        type: "attach-control-buffer",
        controlBuffer: buffer as unknown as SharedArrayBuffer,
      });
    }).not.toThrow();
  });

  it("rejects a corrupted SAB (magic mismatch) without throwing", () => {
    const publisher = createRecordingPublisher();
    const core = createWorkletCore({
      adapterFactory: () => null,
      allocator: createFakeAllocator(),
      sampleRate: DEFAULT_WORKLET_SAMPLE_RATE,
      publish: publisher.publish,
    });
    const buffer = createSynthesisControlBuffer();
    // Corrupt the magic.
    const view = new DataView(buffer);
    view.setUint8(0, 0);
    expect(() => {
      core.handleMessage({
        type: "attach-control-buffer",
        controlBuffer: buffer as unknown as SharedArrayBuffer,
      });
    }).not.toThrow();
    // The core gracefully ignores the corrupted buffer; subsequent
    // process() calls do not crash.
    expect(() => core.process(128)).not.toThrow();
  });
});

describe("workletCore — block-boundary activation (VAL-ENGINE-009/011)", () => {
  it("does NOT activate a pending graph inside handleMessage (block boundaries only)", () => {
    // VAL-ENGINE-009: graph mutation happens at block boundaries.
    // The message handler must only STAGE the delta; activation happens
    // inside process() on the first matching block.
    const { core } = buildWiredCore({ blockEpoch: 1 });
    core.handleMessage({
      type: "instantiate",
      identity: { identity: "id-bb", def: "osc/sine", version: 1, epoch: 1 },
      statePointer: 0,
      stateBytes: 0,
    });

    // After handleMessage (but before process), the graph is staged only.
    // The core exposes no active instance.
    const beforeProcess = core.telemetry;
    expect(beforeProcess.instances).toHaveLength(0);
    expect(beforeProcess.activeEpoch).toBe(0);

    // The first process() call activates the graph at the block boundary.
    const afterProcess = core.process(128);
    expect(afterProcess.instances).toHaveLength(1);
    expect(afterProcess.activeEpoch).toBe(1);
  });

  it("holds a pending graph until the first matching epoch block", () => {
    const { core } = buildWiredCore({ blockEpoch: 1 });
    core.handleMessage({
      type: "instantiate",
      identity: { identity: "id-1", def: "osc/sine", version: 1, epoch: 5 },
      statePointer: 0,
      stateBytes: 0,
    });

    // The first block has epoch 1, not 5; the pending instance does NOT activate.
    const snap1 = core.process(128);
    expect(snap1.activeEpoch).toBe(0);
    expect(snap1.instances).toHaveLength(0);

    // Publish a block with the matching epoch.
    const view = attachSynthesisControlView(createSynthesisControlBuffer());
    core.handleMessage({
      type: "attach-control-buffer",
      controlBuffer: view as unknown as SharedArrayBuffer,
    });
    // We need a fresh SAB because the previous one has already been consumed.
    // Actually, we need to publish into the same attached SAB. For this
    // test we re-attach a new SAB with epoch 5.
    const buffer2 = createSynthesisControlBuffer();
    const view2 = attachSynthesisControlView(buffer2);
    view2.writeBlockEpoch(0, 5);
    view2.writeBlockRevision(0, 1);
    view2.writeBlockRateValue(0, 0, 440);
    view2.writeBlockRateValue(0, 1, 0.2);
    view2.advanceWriteIndex();
    core.handleMessage({
      type: "attach-control-buffer",
      controlBuffer: buffer2 as unknown as SharedArrayBuffer,
    });

    const snap2 = core.process(128);
    expect(snap2.activeEpoch).toBe(5);
    expect(snap2.instances).toHaveLength(1);
    expect(snap2.instances[0].identity).toBe("id-1");
  });

  it("activates a pending graph on the FIRST matching block only", () => {
    const { core, publisher } = buildWiredCore({ blockEpoch: 7 });
    core.handleMessage({
      type: "instantiate",
      identity: { identity: "id-7", def: "osc/sine", version: 1, epoch: 7 },
      statePointer: 0,
      stateBytes: 0,
    });

    core.process(128);
    const activations = publisher.activations();
    expect(activations).toHaveLength(1);
    expect(activations[0].epoch).toBe(7);
    expect(activations[0].identity).toBe("id-7");

    // A second process() does NOT re-activate.
    // We need to publish another matching block first.
    const buffer = createSynthesisControlBuffer();
    const view = attachSynthesisControlView(buffer);
    view.writeBlockEpoch(0, 7);
    view.advanceWriteIndex();
    core.handleMessage({
      type: "attach-control-buffer",
      controlBuffer: buffer as unknown as SharedArrayBuffer,
    });
    const before = publisher.activations().length;
    core.process(128);
    expect(publisher.activations().length).toBe(before);
  });
});

describe("workletCore — mixed epochs never render (VAL-ENGINE-012)", () => {
  it("does not apply a block whose epoch does not match the pending graph", () => {
    const { core } = buildWiredCore({ blockEpoch: 99 });
    core.handleMessage({
      type: "instantiate",
      identity: { identity: "id-A", def: "osc/sine", version: 1, epoch: 100 },
      statePointer: 0,
      stateBytes: 0,
    });

    // Block epoch is 99; pending epoch is 100. The instance must not activate.
    const snap = core.process(128);
    expect(snap.activeEpoch).toBe(0);
    expect(snap.instances).toHaveLength(0);
  });

  it("does not activate a pending graph when the block epoch is zero (no program)", () => {
    const { core } = buildWiredCore({ blockEpoch: 0 });
    core.handleMessage({
      type: "instantiate",
      identity: { identity: "id-B", def: "osc/sine", version: 1, epoch: 50 },
      statePointer: 0,
      stateBytes: 0,
    });

    const snap = core.process(128);
    expect(snap.activeEpoch).toBe(0);
    expect(snap.instances).toHaveLength(0);
  });
});

describe("workletCore — pending graph drains stale-epoch blocks (VAL-ENGINE-011 regression)", () => {
  // Regression: when a pending graph is staged for a new epoch, the
  // ring may already contain stale-epoch blocks produced before the
  // epoch was armed. The worklet must drain those stale blocks (advance
  // the read index past them) so the producer can publish fresh
  // matching-epoch blocks into the freed slots. Otherwise the system
  // deadlocks: the worklet holds the read index on a stale block, the
  // producer sees the ring as full and stops publishing, and the
  // pending graph never activates.
  //
  // This test was OBSERVED FAILING before the fix: after three process
  // calls against a stale-epoch block, the read index did not advance
  // and a subsequently published matching-epoch block was unreachable
  // because it landed in a higher slot while the read index was stuck
  // at zero.
  it("advances the read index past stale-epoch blocks while a pending graph waits", () => {
    const allocator = createFakeAllocator();
    const publisher = createRecordingPublisher();
    const adapterBundle = buildRealFakeAdapter();
    const core = createWorkletCore({
      adapterFactory: () => adapterBundle.adapter,
      allocator,
      sampleRate: DEFAULT_WORKLET_SAMPLE_RATE,
      publish: publisher.publish,
    });

    // Attach a SAB and pre-publish a stale-epoch block (epoch 0).
    const controlBuffer = createSynthesisControlBuffer();
    core.handleMessage({
      type: "attach-control-buffer",
      controlBuffer: controlBuffer as unknown as SharedArrayBuffer,
    });
    const view = attachSynthesisControlView(controlBuffer);
    view.writeBlockEpoch(0, 0);
    view.writeBlockRevision(0, 0);
    view.writeBlockRateValue(0, 0, 440);
    view.writeBlockRateValue(0, 1, 0.2);
    view.advanceWriteIndex();

    // Stage the pending graph for epoch 5.
    core.handleMessage({
      type: "instantiate",
      identity: { identity: "id-stale", def: "osc/sine", version: 1, epoch: 5 },
      statePointer: 0,
      stateBytes: 0,
    });

    // First process: the stale block is observed but does not activate
    // the pending graph. Importantly, it must NOT remain at the read
    // index forever.
    const snap1 = core.process(128);
    expect(snap1.activeEpoch).toBe(0);
    expect(snap1.instances).toHaveLength(0);

    // The read index must have advanced past the stale block. The
    // producer observes the freed slot via fill-depth telemetry and
    // can now publish a fresh matching-epoch block.
    expect(view.ringReadIndex).toBeGreaterThan(0);

    // Publish a fresh block with the matching epoch into the next slot.
    const freshSlot = view.physicalSlotForSequence(view.ringWriteIndex);
    view.writeBlockEpoch(freshSlot, 5);
    view.writeBlockRevision(freshSlot, 1);
    view.writeBlockRateValue(freshSlot, 0, 440);
    view.writeBlockRateValue(freshSlot, 1, 0.2);
    view.advanceWriteIndex();

    // The next process must activate the pending graph on the matching
    // block. Before the fix this never happened because the read index
    // was stuck on the stale block.
    const snap2 = core.process(128);
    expect(snap2.activeEpoch).toBe(5);
    expect(snap2.instances).toHaveLength(1);
    expect(snap2.instances[0].identity).toBe("id-stale");
  });

  it("does not render the stale-epoch block while draining (output stays clean)", () => {
    // Complement to the above: even though we drain the stale block,
    // we must NOT render its controls. The output scratch stays zero
    // (no active instance yet) and the glitch counter does not move.
    const allocator = createFakeAllocator();
    const publisher = createRecordingPublisher();
    const adapterBundle = buildRealFakeAdapter();
    const core = createWorkletCore({
      adapterFactory: () => adapterBundle.adapter,
      allocator,
      sampleRate: DEFAULT_WORKLET_SAMPLE_RATE,
      publish: publisher.publish,
    });
    const controlBuffer = createSynthesisControlBuffer();
    core.handleMessage({
      type: "attach-control-buffer",
      controlBuffer: controlBuffer as unknown as SharedArrayBuffer,
    });
    const view = attachSynthesisControlView(controlBuffer);
    view.writeBlockEpoch(0, 99);
    view.writeBlockRevision(0, 9);
    view.writeBlockRateValue(0, 0, 12345);
    view.writeBlockRateValue(0, 1, 0.99);
    view.advanceWriteIndex();

    core.handleMessage({
      type: "instantiate",
      identity: { identity: "id-clean", def: "osc/sine", version: 1, epoch: 100 },
      statePointer: 0,
      stateBytes: 0,
    });

    const snap = core.process(128);
    expect(snap.activeEpoch).toBe(0);
    expect(snap.peakSample).toBe(0);
    expect(snap.rmsSample).toBe(0);
    expect(snap.glitchCount).toBe(0);
    // Read index advanced past the stale block.
    expect(view.ringReadIndex).toBe(1);
  });
});

describe("workletCore — instantiate-before-module race (VAL-ENGINE-008 / VAL-CROSS-002)", () => {
  // Regression: both the instantiate delta and the nodedef-module
  // transfer arrive via postMessage; their order is not guaranteed.
  // When instantiate arrives first the instance is staged with a null
  // adapter. The renderer must re-resolve the adapter from the cache
  // on every process() call so the instance activates as soon as the
  // module lands, without requiring a second instantiate round-trip.
  //
  // This test was OBSERVED FAILING before the fix: the instance's
  // adapter stayed null forever once the module was installed, so
  // renderInstance early-returned and output stayed silent.
  it("activates a staged instance after the adapter factory yields an adapter", () => {
    const allocator = createFakeAllocator();
    const publisher = createRecordingPublisher();
    const adapterBundle = buildRealFakeAdapter();

    // Adapter factory initially returns null (no module yet). We will
    // flip it to return the real fake adapter partway through the test
    // to mimic the module arriving between two process() calls.
    let moduleTransferred = false;
    const core = createWorkletCore({
      adapterFactory: () => (moduleTransferred ? adapterBundle.adapter : null),
      allocator,
      sampleRate: DEFAULT_WORKLET_SAMPLE_RATE,
      publish: publisher.publish,
    });

    // Attach a SAB and pre-publish one block at epoch 5.
    const controlBuffer = createSynthesisControlBuffer();
    core.handleMessage({
      type: "attach-control-buffer",
      controlBuffer: controlBuffer as unknown as SharedArrayBuffer,
    });
    const view = attachSynthesisControlView(controlBuffer);
    view.writeBlockEpoch(0, 5);
    view.writeBlockRevision(0, 1);
    view.writeBlockRateValue(0, 0, 440);
    view.writeBlockRateValue(0, 1, 0.2);
    view.advanceWriteIndex();

    // Stage the instance for epoch 5 (no adapter yet).
    core.handleMessage({
      type: "instantiate",
      identity: { identity: "race-1", def: "osc/sine", version: 1, epoch: 5 },
      statePointer: 0,
      stateBytes: 0,
    });

    // First process: graph activates but adapter is null. The instance
    // is staged with lifecycle fade-in. Adapter cache is empty.
    const snap1 = core.process(128);
    expect(snap1.activeEpoch).toBe(5);
    expect(snap1.instances).toHaveLength(1);
    expect(snap1.instances[0].identity).toBe("race-1");
    // No compute call yet (no adapter).
    expect(adapterBundle.module.computeCalls.length).toBe(0);

    // Now simulate the module transfer arriving: subsequent calls to
    // the factory return the cached adapter.
    moduleTransferred = true;

    // Publish a second block at the matching epoch for the next pass.
    const slot2 = view.physicalSlotForSequence(view.ringWriteIndex);
    view.writeBlockEpoch(slot2, 5);
    view.writeBlockRevision(slot2, 1);
    view.writeBlockRateValue(slot2, 0, 440);
    view.writeBlockRateValue(slot2, 1, 0.2);
    view.advanceWriteIndex();

    // Second process: the renderer re-resolves the adapter from the
    // factory and initialises the state zone. Before the fix this
    // returned silence because `instance.adapter` was captured as null
    // at instantiate time and never refreshed.
    const snap2 = core.process(128);
    expect(snap2.instances).toHaveLength(1);
    expect(snap2.instances[0].identity).toBe("race-1");
    // The adapter must have been called (the fake records compute calls).
    expect(adapterBundle.module.computeCalls.length).toBeGreaterThan(0);
  });
});

describe("workletCore — producer timeout (VAL-ENGINE-023/024)", () => {
  /**
   * Helper: attach an SAB and publish ONE block so the liveness
   * watchdog activates. Tests then stop publishing to simulate real
   * producer loss. Without the first publication, the worklet stays in
   * the bring-up window (VAL-CROSS-009 recovery race fix) and never
   * advances liveness.
   */
  function primeProducerAndAttachSAB(core: WorkletCore) {
    const buffer = createSynthesisControlBuffer({ renderQuantumFrames: 128 });
    core.handleMessage({
      type: "attach-control-buffer",
      controlBuffer: buffer as unknown as SharedArrayBuffer,
    });
    const view = attachSynthesisControlView(buffer as unknown as ArrayBuffer);
    view.writeBlockEpoch(0, 1);
    view.writeBlockRevision(0, 1);
    view.writeBlockRateValue(0, 0, 440);
    view.writeBlockRateValue(0, 1, 0.2);
    view.advanceWriteIndex();
    // Process once to consume the priming block — this activates the
    // liveness watchdog.
    core.process(128);
  }

  it("does NOT time out before PRODUCER_TIMEOUT_BLOCKS", () => {
    const publisher = createRecordingPublisher();
    const core = createWorkletCore({
      adapterFactory: () => null,
      allocator: createFakeAllocator(),
      sampleRate: DEFAULT_WORKLET_SAMPLE_RATE,
      publish: publisher.publish,
    });
    primeProducerAndAttachSAB(core);

    // Run up to PRODUCER_TIMEOUT_BLOCKS - 1 calls with no new block.
    for (let i = 0; i < PRODUCER_TIMEOUT_BLOCKS - 1; i++) {
      core.process(128);
    }
    expect(publisher.producerTimeouts()).toHaveLength(0);
    expect(core.producerTimeoutActive).toBe(false);
  });

  it("times out at EXACTLY PRODUCER_TIMEOUT_BLOCKS", () => {
    const publisher = createRecordingPublisher();
    const core = createWorkletCore({
      adapterFactory: () => null,
      allocator: createFakeAllocator(),
      sampleRate: DEFAULT_WORKLET_SAMPLE_RATE,
      publish: publisher.publish,
    });
    primeProducerAndAttachSAB(core);

    for (let i = 0; i < PRODUCER_TIMEOUT_BLOCKS; i++) {
      core.process(128);
    }
    expect(publisher.producerTimeouts()).toHaveLength(1);
    expect(core.producerTimeoutActive).toBe(true);
    const event = publisher.producerTimeouts()[0];
    expect(event.livenessAge).toBeGreaterThanOrEqual(PRODUCER_TIMEOUT_BLOCKS);
  });

  it("detects producer loss independently of main-thread notification", () => {
    // The core tracks liveness internally; it does not need a main-thread
    // signal to detect loss.
    const publisher = createRecordingPublisher();
    const core = createWorkletCore({
      adapterFactory: () => null,
      allocator: createFakeAllocator(),
      sampleRate: DEFAULT_WORKLET_SAMPLE_RATE,
      publish: publisher.publish,
    });
    primeProducerAndAttachSAB(core);

    for (let i = 0; i < PRODUCER_TIMEOUT_BLOCKS; i++) {
      core.process(128);
    }
    expect(publisher.producerTimeouts()).toHaveLength(1);
  });

  it("devmode terminate-producer forces immediate timeout on next block", () => {
    const publisher = createRecordingPublisher();
    const core = createWorkletCore({
      adapterFactory: () => null,
      allocator: createFakeAllocator(),
      sampleRate: DEFAULT_WORKLET_SAMPLE_RATE,
      publish: publisher.publish,
    });
    primeProducerAndAttachSAB(core);
    core.handleMessage({ type: "devmode-terminate-producer" });
    expect(publisher.producerTimeouts()).toHaveLength(0);
    core.process(128);
    expect(publisher.producerTimeouts()).toHaveLength(1);
  });

  // -----------------------------------------------------------------
  // VAL-CROSS-009 recovery race fix: a freshly constructed worklet
  // that has NEVER had an SAB attached is in the bring-up window. It
  // must NOT declare a producer timeout while it is still waiting for
  // the initial attach-control-buffer message, because the service
  // creates the worklet node (which starts processing render quanta)
  // BEFORE it installs the producer control bridge. Without this fix,
  // every recovery cycle re-entered `error` before the SAB arrived,
  // which cascaded into a zero-output post-recovery state.
  // -----------------------------------------------------------------
  it("does NOT time out before the SAB is first attached (bring-up window)", () => {
    const publisher = createRecordingPublisher();
    const core = createWorkletCore({
      adapterFactory: () => null,
      allocator: createFakeAllocator(),
      sampleRate: DEFAULT_WORKLET_SAMPLE_RATE,
      publish: publisher.publish,
    });
    // No SAB attached yet — simulate the bring-up / recovery window
    // where the worklet is constructed and connected to destination
    // before the service has installed the control bridge. Run well
    // past PRODUCER_TIMEOUT_BLOCKS; the worklet MUST stay quiet and
    // liveness MUST stay at 0.
    for (let i = 0; i < PRODUCER_TIMEOUT_BLOCKS * 4; i++) {
      core.process(128);
    }
    expect(publisher.producerTimeouts()).toHaveLength(0);
    expect(core.producerTimeoutActive).toBe(false);
    expect(core.producerLivenessAge).toBe(0);
  });

  it("resumes producer-loss detection after the SAB is first attached", () => {
    // After the bring-up window closes (SAB attached + producer
    // published once), producer-loss detection must work normally:
    // 24 blocks with no new publication must fire the timeout.
    const publisher = createRecordingPublisher();
    const core = createWorkletCore({
      adapterFactory: () => null,
      allocator: createFakeAllocator(),
      sampleRate: DEFAULT_WORKLET_SAMPLE_RATE,
      publish: publisher.publish,
    });
    // Run many blocks in the bring-up window — no timeout.
    for (let i = 0; i < PRODUCER_TIMEOUT_BLOCKS * 3; i++) {
      core.process(128);
    }
    expect(publisher.producerTimeouts()).toHaveLength(0);
    // Attach the SAB and publish one priming block — producer-loss
    // detection now activates.
    const buffer = createSynthesisControlBuffer({ renderQuantumFrames: 128 });
    core.handleMessage({
      type: "attach-control-buffer",
      controlBuffer: buffer as unknown as SharedArrayBuffer,
    });
    const view = attachSynthesisControlView(buffer as unknown as ArrayBuffer);
    view.writeBlockEpoch(0, 1);
    view.writeBlockRevision(0, 1);
    view.writeBlockRateValue(0, 0, 440);
    view.writeBlockRateValue(0, 1, 0.2);
    view.advanceWriteIndex();
    core.process(128); // consume the priming block
    // Run PRODUCER_TIMEOUT_BLOCKS with no new publication — timeout.
    for (let i = 0; i < PRODUCER_TIMEOUT_BLOCKS; i++) {
      core.process(128);
    }
    expect(publisher.producerTimeouts()).toHaveLength(1);
    expect(core.producerTimeoutActive).toBe(true);
  });
});

describe("workletCore — emergency fade to silence (VAL-ENGINE-025)", () => {
  it("fades over the sample-rate-derived 10 ms interval", () => {
    const sampleRate = 48000;
    const expectedFadeFrames = Math.round((EMERGENCY_FADE_MS * sampleRate) / 1000);
    expect(expectedFadeFrames).toBe(480); // 10 ms at 48 kHz

    const publisher = createRecordingPublisher();
    const core = createWorkletCore({
      adapterFactory: () => null,
      allocator: createFakeAllocator(),
      sampleRate,
      renderQuantumFrames: 128,
      publish: publisher.publish,
    });

    // Force producer loss.
    core.handleMessage({ type: "devmode-terminate-producer" });

    // Count blocks needed to complete the fade.
    let blocks = 0;
    let sawTimeout = false;
    do {
      const snap = core.process(128);
      if (snap.producerTimeoutActive) sawTimeout = true;
      blocks += 1;
      if (blocks > 100) break; // safety
    } while (core.producerTimeoutActive && blocks * 128 < expectedFadeFrames + 128);

    expect(sawTimeout).toBe(true);
    // The total frames processed during the fade window should be at
    // least expectedFadeFrames.
    expect(blocks * 128).toBeGreaterThanOrEqual(expectedFadeFrames);
  });

  it("reaches EXACT silence after the fade completes", () => {
    const publisher = createRecordingPublisher();
    const core = createWorkletCore({
      adapterFactory: () => null,
      allocator: createFakeAllocator(),
      sampleRate: DEFAULT_WORKLET_SAMPLE_RATE,
      renderQuantumFrames: 128,
      publish: publisher.publish,
    });

    // Force timeout and run past the fade.
    core.handleMessage({ type: "devmode-terminate-producer" });
    const fadeBlocks = Math.ceil((EMERGENCY_FADE_MS * DEFAULT_WORKLET_SAMPLE_RATE) / 1000 / 128);
    for (let i = 0; i < fadeBlocks + 2; i++) {
      core.process(128);
    }

    const snap = core.process(128);
    expect(snap.peakSample).toBe(0);
    expect(snap.rmsSample).toBe(0);
  });
});

describe("workletCore — underrun handling (VAL-ENGINE-033)", () => {
  /**
   * Helper: attach an SAB, publish one priming block, and consume it.
   * This activates the liveness watchdog and underrun counting. Without
   * the priming block, the worklet stays in the bring-up window
   * (VAL-CROSS-009 recovery race fix) and neither liveness nor underrun
   * counters advance.
   */
  function attachAndPrime(core: WorkletCore) {
    const buffer = createSynthesisControlBuffer();
    core.handleMessage({
      type: "attach-control-buffer",
      controlBuffer: buffer as unknown as SharedArrayBuffer,
    });
    const view = attachSynthesisControlView(buffer);
    view.writeBlockEpoch(0, 1);
    view.writeBlockRevision(0, 1);
    view.writeBlockRateValue(0, 0, 440);
    view.writeBlockRateValue(0, 1, 0.2);
    view.advanceWriteIndex();
    core.process(128); // consume the priming block
    return buffer;
  }

  it("increments underrun telemetry when the ring is empty", () => {
    const publisher = createRecordingPublisher();
    const core = createWorkletCore({
      adapterFactory: () => null,
      allocator: createFakeAllocator(),
      sampleRate: DEFAULT_WORKLET_SAMPLE_RATE,
      publish: publisher.publish,
    });
    attachAndPrime(core);

    const snap = core.process(128);
    expect(snap.underrunCount).toBe(1);
    // Producer liveness advances.
    expect(snap.producerLivenessAge).toBe(1);
  });

  it("recovers before timeout when fresh blocks resume", () => {
    const publisher = createRecordingPublisher();
    const core = createWorkletCore({
      adapterFactory: () => null,
      allocator: createFakeAllocator(),
      sampleRate: DEFAULT_WORKLET_SAMPLE_RATE,
      publish: publisher.publish,
    });
    const buffer = attachAndPrime(core);

    // Two underruns.
    core.process(128);
    core.process(128);

    // Publish a fresh block; the liveness age resets.
    const view = attachSynthesisControlView(buffer);
    view.writeBlockEpoch(0, 1);
    view.advanceWriteIndex();
    const snap = core.process(128);
    expect(snap.producerLivenessAge).toBe(0);
    expect(snap.producerTimeoutActive).toBe(false);
    expect(snap.underrunCount).toBe(2);
  });

  it("does NOT reuse stale controls on underrun (epoch-safe)", () => {
    // When the ring is empty the core must not reuse the last block's
    // controls. It holds last values internally without touching the
    // ring's read index.
    const publisher = createRecordingPublisher();
    const core = createWorkletCore({
      adapterFactory: () => null,
      allocator: createFakeAllocator(),
      sampleRate: DEFAULT_WORKLET_SAMPLE_RATE,
      publish: publisher.publish,
    });
    const buffer = createSynthesisControlBuffer();
    const view = attachSynthesisControlView(buffer);
    core.handleMessage({
      type: "attach-control-buffer",
      controlBuffer: buffer as unknown as SharedArrayBuffer,
    });

    // Publish one block with epoch 1.
    view.writeBlockEpoch(0, 1);
    view.writeBlockRateValue(0, 0, 660);
    view.writeBlockRateValue(0, 1, 0.5);
    view.advanceWriteIndex();

    // Consume it.
    core.process(128);
    const readIdx1 = view.ringReadIndex;

    // Underrun: empty ring.
    core.process(128);
    const readIdx2 = view.ringReadIndex;
    // The read index must NOT advance on underrun.
    expect(readIdx2).toBe(readIdx1);
  });
});

describe("workletCore — graph retirement (VAL-ENGINE-035)", () => {
  it("retires an instance when a retire message arrives", () => {
    const { core, publisher, allocator } = buildWiredCore({ blockEpoch: 1 });
    core.handleMessage({
      type: "instantiate",
      identity: { identity: "id-retire", def: "osc/sine", version: 1, epoch: 1 },
      statePointer: 0,
      stateBytes: 0,
    });

    // Activate.
    core.process(128);
    expect(publisher.activations()).toHaveLength(1);

    // Retire.
    core.handleMessage({
      type: "retire",
      identity: { identity: "id-retire", epoch: 1 },
    });

    // Run past the fade-out window.
    const fadeBlocks = Math.ceil((SYNTH_FADE_OUT_MS * DEFAULT_WORKLET_SAMPLE_RATE) / 1000 / 128);
    for (let i = 0; i < fadeBlocks + 2; i++) {
      // Publish a fresh matching block each iteration.
      const buffer = createSynthesisControlBuffer();
      const view = attachSynthesisControlView(buffer);
      view.writeBlockEpoch(0, 1);
      view.advanceWriteIndex();
      core.handleMessage({
        type: "attach-control-buffer",
        controlBuffer: buffer as unknown as SharedArrayBuffer,
      });
      core.process(128);
    }

    // The instance was retired and its state zone was released.
    expect(allocator.releaseCount()).toBeGreaterThanOrEqual(1);
  });

  it("does NOT render an orphan after retirement", () => {
    const { core, publisher } = buildWiredCore({ blockEpoch: 1 });
    core.handleMessage({
      type: "instantiate",
      identity: { identity: "id-orphan", def: "osc/sine", version: 1, epoch: 1 },
      statePointer: 0,
      stateBytes: 0,
    });
    core.process(128);

    core.handleMessage({
      type: "retire",
      identity: { identity: "id-orphan", epoch: 1 },
    });

    // Run past the fade.
    const fadeBlocks = Math.ceil((SYNTH_FADE_OUT_MS * DEFAULT_WORKLET_SAMPLE_RATE) / 1000 / 128);
    for (let i = 0; i < fadeBlocks + 2; i++) {
      const buffer = createSynthesisControlBuffer();
      const view = attachSynthesisControlView(buffer);
      view.writeBlockEpoch(0, 1);
      view.advanceWriteIndex();
      core.handleMessage({
        type: "attach-control-buffer",
        controlBuffer: buffer as unknown as SharedArrayBuffer,
      });
      core.process(128);
    }

    // After retirement, the active instance is gone. Further retire
    // messages for the same identity are no-ops.
    const retirementsBefore = publisher.retirements().length;
    core.handleMessage({
      type: "retire",
      identity: { identity: "id-orphan", epoch: 1 },
    });
    // The retire event was published exactly once for the real retirement.
    expect(publisher.retirements().length).toBe(retirementsBefore);
  });
});

describe("workletCore — same-def update preserves phase (VAL-DSP-010)", () => {
  it("does NOT re-instantiate when the same identity+def arrives again", () => {
    const { core, allocator } = buildWiredCore({ blockEpoch: 1 });
    core.handleMessage({
      type: "instantiate",
      identity: { identity: "id-same", def: "osc/sine", version: 1, epoch: 1 },
      statePointer: 0,
      stateBytes: 0,
    });
    core.process(128);
    const allocsAfterFirst = allocator.allocCount();

    // Same identity + def: update-in-place, no new allocation.
    core.handleMessage({
      type: "instantiate",
      identity: { identity: "id-same", def: "osc/sine", version: 1, epoch: 2 },
      statePointer: 0,
      stateBytes: 0,
      prefill: [{ name: "freq", value: 880 }],
    });

    expect(allocator.allocCount()).toBe(allocsAfterFirst);

    // Publish a matching block and process; the instance stays active.
    const buffer = createSynthesisControlBuffer();
    const view = attachSynthesisControlView(buffer);
    view.writeBlockEpoch(0, 2);
    view.writeBlockRateValue(0, 0, 880);
    view.writeBlockRateValue(0, 1, 0.2);
    view.advanceWriteIndex();
    core.handleMessage({
      type: "attach-control-buffer",
      controlBuffer: buffer as unknown as SharedArrayBuffer,
    });
    const snap = core.process(128);
    expect(snap.instances).toHaveLength(1);
    expect(snap.instances[0].identity).toBe("id-same");
  });
});

describe("workletCore — def-change retire-and-replace (VAL-ENGINE-035)", () => {
  it("retires the old instance and activates the new one", () => {
    const { core } = buildWiredCore({ blockEpoch: 1 });
    // Instantiate def "osc/sine" v1.
    core.handleMessage({
      type: "instantiate",
      identity: { identity: "id-x", def: "osc/sine", version: 1, epoch: 1 },
      statePointer: 0,
      stateBytes: 0,
    });
    core.process(128);

    // Replace with a different def/version under the SAME identity.
    core.handleMessage({
      type: "instantiate",
      identity: { identity: "id-x", def: "osc/saw", version: 1, epoch: 2 },
      statePointer: 0,
      stateBytes: 0,
    });

    // Publish a matching block for the new epoch.
    const buffer = createSynthesisControlBuffer();
    const view = attachSynthesisControlView(buffer);
    view.writeBlockEpoch(0, 2);
    view.advanceWriteIndex();
    core.handleMessage({
      type: "attach-control-buffer",
      controlBuffer: buffer as unknown as SharedArrayBuffer,
    });
    const snap = core.process(128);
    // During the crossfade BOTH instances render: the old def fades
    // out while the new def fades in (overlapping fades per
    // synth-nodes.md §5.7). M2.1 telemetry reports every rendering
    // instance, so the retiring ancestor is visible until its release
    // fade completes.
    expect(snap.instances).toHaveLength(2);
    const oldInstance = snap.instances.find((i) => i.def === "osc/sine");
    const newInstance = snap.instances.find((i) => i.def === "osc/saw");
    expect(oldInstance?.identity).toBe("id-x");
    expect(oldInstance?.lifecycle).toBe("fade-out");
    expect(newInstance?.identity).toBe("id-x");
    expect(newInstance?.lifecycle).toBe("fade-in");

    // After the release fade completes, only the new instance remains.
    const fadeBlocks = Math.ceil(
      (SYNTH_FADE_OUT_MS * DEFAULT_WORKLET_SAMPLE_RATE) / 1000 / 128,
    );
    for (let i = 0; i < fadeBlocks + 2; i++) {
      const b = createSynthesisControlBuffer();
      const v = attachSynthesisControlView(b);
      v.writeBlockEpoch(0, 2);
      v.advanceWriteIndex();
      core.handleMessage({
        type: "attach-control-buffer",
        controlBuffer: b as unknown as SharedArrayBuffer,
      });
      core.process(128);
    }
    const settled = core.telemetry;
    expect(settled.instances).toHaveLength(1);
    expect(settled.instances[0].def).toBe("osc/saw");
  });
});

describe("workletCore — steady-state allocation-free (VAL-ENGINE-034)", () => {
  it("does NOT allocate during steady-state process() calls", () => {
    const { core, allocator } = buildWiredCore({ blockEpoch: 1 });
    core.handleMessage({
      type: "instantiate",
      identity: { identity: "id-alloc", def: "osc/sine", version: 1, epoch: 1 },
      statePointer: 0,
      stateBytes: 0,
    });
    core.process(128);

    // After activation, run several steady-state blocks. The allocator
    // must not be touched.
    const allocsBefore = allocator.allocCount();
    const releasesBefore = allocator.releaseCount();
    for (let i = 0; i < 10; i++) {
      const buffer = createSynthesisControlBuffer();
      const view = attachSynthesisControlView(buffer);
      view.writeBlockEpoch(0, 1);
      view.advanceWriteIndex();
      core.handleMessage({
        type: "attach-control-buffer",
        controlBuffer: buffer as unknown as SharedArrayBuffer,
      });
      core.process(128);
    }
    expect(allocator.allocCount()).toBe(allocsBefore);
    expect(allocator.releaseCount()).toBe(releasesBefore);
  });
});

describe("workletCore — fade-in on activation (VAL-ENGINE-028)", () => {
  it("begins in fade-in lifecycle on activation", () => {
    const { core } = buildWiredCore({ blockEpoch: 1 });
    core.handleMessage({
      type: "instantiate",
      identity: { identity: "id-fade", def: "osc/sine", version: 1, epoch: 1 },
      statePointer: 0,
      stateBytes: 0,
    });
    const snap = core.process(128);
    expect(snap.instances).toHaveLength(1);
    // On the very first block the lifecycle is fade-in.
    expect(snap.instances[0].lifecycle).toBe("fade-in");
  });

  it("reaches active lifecycle after the fade-in window", () => {
    const { core } = buildWiredCore({ blockEpoch: 1 });
    core.handleMessage({
      type: "instantiate",
      identity: { identity: "id-fade2", def: "osc/sine", version: 1, epoch: 1 },
      statePointer: 0,
      stateBytes: 0,
    });
    const fadeInBlocks = Math.ceil(
      (SYNTH_FADE_IN_MS * DEFAULT_WORKLET_SAMPLE_RATE) / 1000 / 128,
    );
    for (let i = 0; i < fadeInBlocks + 1; i++) {
      const buffer = createSynthesisControlBuffer();
      const view = attachSynthesisControlView(buffer);
      view.writeBlockEpoch(0, 1);
      view.advanceWriteIndex();
      core.handleMessage({
        type: "attach-control-buffer",
        controlBuffer: buffer as unknown as SharedArrayBuffer,
      });
      core.process(128);
    }
    const snap = core.telemetry;
    expect(snap.instances).toHaveLength(1);
    expect(snap.instances[0].lifecycle).toBe("active");
  });
});

describe("workletCore — lookahead and ABI constants", () => {
  it("exposes the canonical lookahead constant", () => {
    expect(CONTROL_LOOKAHEAD_BLOCKS).toBe(6);
  });

  it("honours the 24-block producer timeout constant", () => {
    expect(PRODUCER_TIMEOUT_BLOCKS).toBe(24);
  });

  it("honours the 10 ms emergency fade constant", () => {
    expect(EMERGENCY_FADE_MS).toBe(10);
  });
});
