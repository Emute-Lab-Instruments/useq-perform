/**
 * Multi-node worklet host tests (synthesis epic M2.1, ergo 9a9370af;
 * quantum-growth fix, ergo 10271a1d).
 *
 * Normative contract (`synthesis.md` §2.3, §3.1, §1.4):
 *   - one AudioWorkletProcessor hosts the whole patch graph; N live
 *     instances execute in topological order per block;
 *   - node ports are offsets into the host-owned shared memory: each
 *     node's output zone feeds downstream nodes' input ports (pointer
 *     wiring, never per-block copying);
 *   - terminal nodes (no downstream consumer) sum into the output
 *     scratch;
 *   - zone exhaustion and the node limit produce diagnostics, never
 *     glitches;
 *   - the actual render quantum may vary (`renderSizeHint`); growth
 *     must never orphan the shared-memory views the DSP writes into.
 *
 * The tests drive the core with SYNTHETIC multi-node payloads: the live
 * compiler still caps at one node until M2.2 lifts it. Fake adapters
 * write real samples into a plain ArrayBuffer arena so summation,
 * wiring, and fades are observable end to end.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_RENDER_QUANTUM_FRAMES,
  MAX_SYNTH_NODES,
  SYNTH_ARENA_NULL_GUARD_BYTES,
  SYNTH_FADE_IN_MS,
  SYNTH_FADE_OUT_MS,
  attachSynthesisControlView,
  createSynthesisControlBuffer,
  type SynthesisControlView,
} from "../contracts/synthesisControlAbi";
import {
  OSC_SINE_NODEDEF_DESCRIPTOR,
  buildNodeDefParamTable,
  type NodeDefDescriptor,
} from "../contracts/nodeDefRegistry";
import type { NodeDefAdapter } from "./nodeDefAdapter";
import {
  createWorkletCore,
  DEFAULT_WORKLET_SAMPLE_RATE,
  type WorkletCore,
} from "./workletCore";
import { createZoneAllocator } from "./workletZoneAllocator";
import type { WorkletOutboundEvent } from "./workletGraphDelta";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const BYTES_PER_DOUBLE = Float64Array.BYTES_PER_ELEMENT;

/** Fade windows in 128-frame blocks (rounded up), plus safety. */
const FADE_IN_BLOCKS =
  Math.ceil((SYNTH_FADE_IN_MS * DEFAULT_WORKLET_SAMPLE_RATE) / 1000 / 128) + 2;
const FADE_OUT_BLOCKS =
  Math.ceil((SYNTH_FADE_OUT_MS * DEFAULT_WORKLET_SAMPLE_RATE) / 1000 / 128) + 2;

function makeDescriptor(
  name: string,
  audioInputs: number,
): NodeDefDescriptor {
  return Object.freeze({
    ...OSC_SINE_NODEDEF_DESCRIPTOR,
    name,
    audioInputs,
    audioInputNames: audioInputs === 0 ? Object.freeze([]) : Object.freeze(["in"]),
  });
}

interface FakeGraphAdapter extends NodeDefAdapter {
  /** Output pointers observed on compute calls (byte offsets). */
  readonly outputPtrs: number[];
  /** Input pointer vectors observed on computeWithInputs calls. */
  readonly inputPtrVectors: number[][];
}

/**
 * Adapter that writes a constant into its output zone every block.
 * Zero audio inputs (a source node).
 */
function createConstAdapter(
  arena: ArrayBuffer,
  name: string,
  value: number,
  callOrder: string[],
): FakeGraphAdapter {
  const descriptor = makeDescriptor(name, 0);
  const outputPtrs: number[] = [];
  const inputPtrVectors: number[][] = [];
  return {
    descriptor,
    params: buildNodeDefParamTable(descriptor),
    sampleRate: descriptor.sampleRate,
    validateLayout: () => true,
    init: () => true,
    compute(_statePtr, _freqPtr, _ampPtr, outputPtr, frameCount) {
      callOrder.push(name);
      outputPtrs.push(outputPtr);
      const out = new Float64Array(arena, outputPtr, frameCount);
      out.fill(value);
      return true;
    },
    getPhase: () => 0,
    getSmoothedAmp: () => 0,
    resetPhase: () => undefined,
    outputPtrs,
    inputPtrVectors,
  };
}

/**
 * Adapter that multiplies its single audio input by a constant gain.
 * One audio input (a processor node) — exercises port-offset wiring.
 */
function createGainAdapter(
  arena: ArrayBuffer,
  name: string,
  gain: number,
  callOrder: string[],
): FakeGraphAdapter {
  const descriptor = makeDescriptor(name, 1);
  const outputPtrs: number[] = [];
  const inputPtrVectors: number[][] = [];
  return {
    descriptor,
    params: buildNodeDefParamTable(descriptor),
    sampleRate: descriptor.sampleRate,
    validateLayout: () => true,
    init: () => true,
    compute(_statePtr, _freqPtr, _ampPtr, outputPtr, frameCount) {
      // Input-less fallback: silence.
      callOrder.push(name);
      outputPtrs.push(outputPtr);
      new Float64Array(arena, outputPtr, frameCount).fill(0);
      return true;
    },
    computeWithInputs(_statePtr, inputPtrs, _freqPtr, _ampPtr, outputPtr, frameCount) {
      callOrder.push(name);
      outputPtrs.push(outputPtr);
      inputPtrVectors.push(inputPtrs.slice());
      const out = new Float64Array(arena, outputPtr, frameCount);
      const input = new Float64Array(arena, inputPtrs[0], frameCount);
      for (let i = 0; i < frameCount; i++) {
        out[i] = input[i] * gain;
      }
      return true;
    },
    getPhase: () => 0,
    getSmoothedAmp: () => 0,
    resetPhase: () => undefined,
    outputPtrs,
    inputPtrVectors,
  };
}

/**
 * Adapter that echoes its block-rate `freq` control into its output —
 * proves per-(node, param) control-channel routing.
 */
function createControlEchoAdapter(
  arena: ArrayBuffer,
  name: string,
  callOrder: string[],
): FakeGraphAdapter {
  const descriptor = makeDescriptor(name, 0);
  const outputPtrs: number[] = [];
  const inputPtrVectors: number[][] = [];
  return {
    descriptor,
    params: buildNodeDefParamTable(descriptor),
    sampleRate: descriptor.sampleRate,
    validateLayout: () => true,
    init: () => true,
    compute(_statePtr, freqPtr, _ampPtr, outputPtr, frameCount) {
      callOrder.push(name);
      outputPtrs.push(outputPtr);
      const freq = new Float64Array(arena, freqPtr, 1)[0];
      new Float64Array(arena, outputPtr, frameCount).fill(freq);
      return true;
    },
    getPhase: () => 0,
    getSmoothedAmp: () => 0,
    resetPhase: () => undefined,
    outputPtrs,
    inputPtrVectors,
  };
}

interface GraphHarness {
  core: WorkletCore;
  view: SynthesisControlView;
  arena: ArrayBuffer;
  callOrder: string[];
  events: WorkletOutboundEvent[];
  allocCount(): number;
  releaseCount(): number;
  /** Publish one ring block with the given epoch and channel values. */
  pushBlock(epoch: number, channels?: readonly number[]): void;
  /** Push a block and process one quantum. */
  step(epoch: number, channels?: readonly number[], frames?: number): void;
  diagnostics(): Array<Extract<WorkletOutboundEvent, { type: "graph-diagnostic" }>>;
}

function buildGraphHarness(opts: {
  adapters: Record<string, FakeGraphAdapter>;
  arena: ArrayBuffer;
  limitBytes?: number;
  renderQuantumFrames?: number;
  /** Shared compute-call recorder (the same array the adapters push into). */
  callOrder?: string[];
}): GraphHarness {
  const arena = opts.arena;
  const allocator = createZoneAllocator({
    limitBytes: opts.limitBytes ?? arena.byteLength,
  });
  let allocs = 0;
  let releases = 0;
  const countingAllocator = {
    allocate(bytes: number, align: number) {
      allocs += 1;
      return allocator.allocate(bytes, align);
    },
    release(pointer: number) {
      releases += 1;
      allocator.release(pointer);
    },
  };

  // Control scratches must live in the arena so control-echo adapters
  // can read them back through their pointers.
  const freqPtr = allocator.allocate(BYTES_PER_DOUBLE, 8);
  const ampPtr = allocator.allocate(BYTES_PER_DOUBLE, 8);
  const freqControlScratch = new Float64Array(arena, freqPtr, 1);
  const ampControlScratch = new Float64Array(arena, ampPtr, 1);

  const events: WorkletOutboundEvent[] = [];
  const callOrder = opts.callOrder ?? [];

  const core = createWorkletCore({
    adapterFactory: (name) => opts.adapters[name] ?? null,
    allocator: countingAllocator,
    sampleRate: DEFAULT_WORKLET_SAMPLE_RATE,
    renderQuantumFrames: opts.renderQuantumFrames ?? DEFAULT_RENDER_QUANTUM_FRAMES,
    publish: (e) => events.push(e),
    createArenaView: (byteOffset, lengthDoubles) =>
      new Float64Array(arena, byteOffset, lengthDoubles),
    freqControlScratch,
    ampControlScratch,
  });

  const controlBuffer = createSynthesisControlBuffer();
  core.handleMessage({
    type: "attach-control-buffer",
    controlBuffer: controlBuffer as unknown as SharedArrayBuffer,
  });
  const view = attachSynthesisControlView(controlBuffer);

  function pushBlock(epoch: number, channels: readonly number[] = [440, 1]) {
    const slot = view.physicalSlotForSequence(view.ringWriteIndex);
    view.writeBlockEpoch(slot, epoch);
    view.writeBlockRevision(slot, 1);
    for (let i = 0; i < channels.length && i < view.blockRateCount; i++) {
      view.writeBlockRateValue(slot, i, channels[i]);
    }
    view.advanceWriteIndex();
  }

  return {
    core,
    view,
    arena,
    callOrder,
    events,
    allocCount: () => allocs,
    releaseCount: () => releases,
    pushBlock,
    step(epoch, channels, frames = 128) {
      pushBlock(epoch, channels);
      core.process(frames);
    },
    diagnostics: () =>
      events.filter(
        (e): e is Extract<WorkletOutboundEvent, { type: "graph-diagnostic" }> =>
          "type" in e && e.type === "graph-diagnostic",
      ),
  };
}

function instantiate(
  core: WorkletCore,
  identity: string,
  def: string,
  epoch: number,
  extra?: Record<string, unknown>,
) {
  core.handleMessage({
    type: "instantiate",
    identity: { identity, def, version: 1, epoch },
    statePointer: 0,
    stateBytes: 0,
    ...extra,
  });
}

// ---------------------------------------------------------------------------
// Multi-node execution
// ---------------------------------------------------------------------------

describe("workletCore graph — multiple live instances (synthesis.md §3.1)", () => {
  it("renders two independent nodes and sums them into the output", () => {
    const arena = new ArrayBuffer(1024 * 1024);
    const callOrder: string[] = [];
    const h = buildGraphHarness({
      adapters: {
        "src/a": createConstAdapter(arena, "src/a", 0.25, callOrder),
        "src/b": createConstAdapter(arena, "src/b", 0.5, callOrder),
      },
      arena,
      callOrder,
    });
    instantiate(h.core, "id-a", "src/a", 1);
    instantiate(h.core, "id-b", "src/b", 1);
    for (let i = 0; i < FADE_IN_BLOCKS + 2; i++) h.step(1);

    const out = h.core.readOutput();
    expect(out[0]).toBeCloseTo(0.75, 6);
    expect(out[127]).toBeCloseTo(0.75, 6);
    expect(h.core.telemetry.instances).toHaveLength(2);
  });

  it("activates a staged multi-node set atomically at the first matching block", () => {
    const arena = new ArrayBuffer(1024 * 1024);
    const callOrder: string[] = [];
    const h = buildGraphHarness({
      adapters: {
        "src/a": createConstAdapter(arena, "src/a", 0.25, callOrder),
        "src/b": createConstAdapter(arena, "src/b", 0.5, callOrder),
      },
      arena,
      callOrder,
    });
    instantiate(h.core, "id-a", "src/a", 3);
    instantiate(h.core, "id-b", "src/b", 3);

    // A mismatched-epoch block must NOT activate or render either node.
    h.step(7);
    expect(h.callOrder).toHaveLength(0);
    expect(h.core.telemetry.instances).toHaveLength(0);

    // First matching block activates both together.
    h.step(3);
    expect(h.core.telemetry.instances).toHaveLength(2);
    expect(h.callOrder).toContain("src/a");
    expect(h.callOrder).toContain("src/b");
  });
});

// ---------------------------------------------------------------------------
// Topological order and port wiring
// ---------------------------------------------------------------------------

describe("workletCore graph — topological execution and port wiring", () => {
  it("executes upstream before downstream even when staged in reverse order", () => {
    const arena = new ArrayBuffer(1024 * 1024);
    const callOrder: string[] = [];
    const h = buildGraphHarness({
      adapters: {
        "src/a": createConstAdapter(arena, "src/a", 0.5, callOrder),
        "fx/gain": createGainAdapter(arena, "fx/gain", 2, callOrder),
      },
      arena,
      callOrder,
    });
    // Downstream (B consumes A) instantiated FIRST — topological order
    // must still run A before B.
    instantiate(h.core, "id-b", "fx/gain", 1, {
      audioInputs: [{ port: 0, sourceIdentity: "id-a", sourcePort: 0 }],
    });
    instantiate(h.core, "id-a", "src/a", 1);
    h.step(1);

    expect(h.callOrder).toEqual(["src/a", "fx/gain"]);
  });

  it("feeds the upstream output zone into the downstream input port (audible)", () => {
    const arena = new ArrayBuffer(1024 * 1024);
    const callOrder: string[] = [];
    const constAdapter = createConstAdapter(arena, "src/a", 0.5, callOrder);
    const gainAdapter = createGainAdapter(arena, "fx/gain", 2, callOrder);
    const h = buildGraphHarness({
      adapters: { "src/a": constAdapter, "fx/gain": gainAdapter },
      arena,
      callOrder,
    });
    instantiate(h.core, "id-a", "src/a", 1);
    instantiate(h.core, "id-b", "fx/gain", 1, {
      audioInputs: [{ port: 0, sourceIdentity: "id-a", sourcePort: 0 }],
    });
    for (let i = 0; i < FADE_IN_BLOCKS + 2; i++) h.step(1);

    // Pointer wiring: the gain node's input pointer IS the const node's
    // output pointer (offset arithmetic, no copying).
    expect(gainAdapter.inputPtrVectors.length).toBeGreaterThan(0);
    const lastInputs = gainAdapter.inputPtrVectors[gainAdapter.inputPtrVectors.length - 1];
    const lastConstOut = constAdapter.outputPtrs[constAdapter.outputPtrs.length - 1];
    expect(lastInputs[0]).toBe(lastConstOut);

    // Only the terminal node reaches the output: 0.5 × 2 = 1.0.
    const out = h.core.readOutput();
    expect(out[0]).toBeCloseTo(1.0, 6);
    expect(out[64]).toBeCloseTo(1.0, 6);
  });

  it("routes per-node block-rate controls via the per-(node, param) table", () => {
    const arena = new ArrayBuffer(1024 * 1024);
    const callOrder: string[] = [];
    const h = buildGraphHarness({
      adapters: {
        "src/echo-a": createControlEchoAdapter(arena, "src/echo-a", callOrder),
        "src/echo-b": createControlEchoAdapter(arena, "src/echo-b", callOrder),
      },
      arena,
      callOrder,
    });
    instantiate(h.core, "id-a", "src/echo-a", 1, {
      controlChannels: [
        { param: "freq", channel: 0 },
        { param: "amp", channel: 1 },
      ],
    });
    instantiate(h.core, "id-b", "src/echo-b", 1, {
      controlChannels: [
        { param: "freq", channel: 2 },
        { param: "amp", channel: 3 },
      ],
    });
    // Channels: node A freq=100 amp=1, node B freq=200 amp=1.
    for (let i = 0; i < FADE_IN_BLOCKS + 2; i++) h.step(1, [100, 1, 200, 1]);

    const out = h.core.readOutput();
    expect(out[0]).toBeCloseTo(300, 4);
  });

  it("holds prefill values for params without a channel (sparse binding)", () => {
    const arena = new ArrayBuffer(1024 * 1024);
    const callOrder: string[] = [];
    const h = buildGraphHarness({
      adapters: {
        "src/echo-a": createControlEchoAdapter(arena, "src/echo-a", callOrder),
      },
      arena,
      callOrder,
    });
    // Only amp is bound to a channel; freq is unbound and must hold its
    // prefill value even while the SAB carries junk in channel 0 (which
    // the interim per-node window would have read as freq).
    instantiate(h.core, "id-a", "src/echo-a", 1, {
      controlChannels: [{ param: "amp", channel: 1 }],
      prefill: [
        { name: "freq", value: 150 },
        { name: "amp", value: 0.5 },
      ],
    });
    for (let i = 0; i < FADE_IN_BLOCKS + 2; i++) h.step(1, [999, 1, 0, 0]);

    // The echo adapter outputs its freq control: the prefilled 150 must
    // hold — the 999 in channel 0 must never reach the unbound freq.
    const out = h.core.readOutput();
    expect(out[0]).toBeCloseTo(150, 4);
  });
});

// ---------------------------------------------------------------------------
// Multi-node retirement
// ---------------------------------------------------------------------------

describe("workletCore graph — multi-node retirement (VAL-ENGINE-035)", () => {
  it("retires one node with a release fade while the other keeps sounding", () => {
    const arena = new ArrayBuffer(1024 * 1024);
    const callOrder: string[] = [];
    const h = buildGraphHarness({
      adapters: {
        "src/a": createConstAdapter(arena, "src/a", 0.25, callOrder),
        "src/b": createConstAdapter(arena, "src/b", 0.5, callOrder),
      },
      arena,
      callOrder,
    });
    instantiate(h.core, "id-a", "src/a", 1);
    instantiate(h.core, "id-b", "src/b", 1);
    for (let i = 0; i < FADE_IN_BLOCKS + 2; i++) h.step(1);

    const releasesBefore = h.releaseCount();
    h.core.handleMessage({ type: "retire", identity: { identity: "id-a", epoch: 1 } });
    for (let i = 0; i < FADE_OUT_BLOCKS + 2; i++) h.step(1);

    // The retired node's zones (state + output) were released; the
    // survivor still renders alone.
    expect(h.releaseCount()).toBeGreaterThan(releasesBefore);
    expect(h.core.telemetry.instances).toHaveLength(1);
    expect(h.core.telemetry.instances[0].identity).toBe("id-b");
    const out = h.core.readOutput();
    expect(out[0]).toBeCloseTo(0.5, 6);
  });

  it("repoints a downstream consumer to silence after its source retires", () => {
    const arena = new ArrayBuffer(1024 * 1024);
    const callOrder: string[] = [];
    const h = buildGraphHarness({
      adapters: {
        "src/a": createConstAdapter(arena, "src/a", 0.5, callOrder),
        "fx/gain": createGainAdapter(arena, "fx/gain", 2, callOrder),
      },
      arena,
      callOrder,
    });
    instantiate(h.core, "id-a", "src/a", 1);
    instantiate(h.core, "id-b", "fx/gain", 1, {
      audioInputs: [{ port: 0, sourceIdentity: "id-a", sourcePort: 0 }],
    });
    for (let i = 0; i < FADE_IN_BLOCKS + 2; i++) h.step(1);
    expect(h.core.readOutput()[0]).toBeCloseTo(1.0, 6);

    h.core.handleMessage({ type: "retire", identity: { identity: "id-a", epoch: 1 } });
    for (let i = 0; i < FADE_OUT_BLOCKS + 2; i++) h.step(1);

    // The source is gone; the consumer must read silence (never a
    // dangling zone) and stay alive.
    expect(h.core.telemetry.instances).toHaveLength(1);
    expect(h.core.telemetry.instances[0].identity).toBe("id-b");
    expect(h.core.readOutput()[0]).toBeCloseTo(0, 6);
  });
});

describe("workletCore graph — failure-atomic prepare/commit/activate", () => {
  function transactionAck(h: GraphHarness, transactionId: number, phase: string) {
    return h.events.find((event) =>
      "type" in event &&
      event.type === "graph-transaction-ack" &&
      event.transactionId === transactionId &&
      event.phase === phase
    ) as Extract<WorkletOutboundEvent, { type: "graph-transaction-ack" }> | undefined;
  }

  function prepareAdd(identity: string, def: string, epoch: number) {
    return {
      type: "prepare-graph" as const,
      transactionId: epoch,
      epoch,
      deltas: [{
        type: "instantiate" as const,
        identity: { identity, def, version: 1, epoch },
        statePointer: 0,
        stateBytes: 0,
        audioOutputs: 1,
      }],
    };
  }

  it("reclaims a partially allocated candidate and keeps the old graph live", () => {
    const arena = new ArrayBuffer(1024 * 1024);
    const callOrder: string[] = [];
    const limitBytes =
      SYNTH_ARENA_NULL_GUARD_BYTES +
      128 * BYTES_PER_DOUBLE +
      2 * BYTES_PER_DOUBLE +
      24 +
      128 * BYTES_PER_DOUBLE +
      24 +
      64;
    const h = buildGraphHarness({
      adapters: {
        "src/a": createConstAdapter(arena, "src/a", 0.25, callOrder),
        "src/b": createConstAdapter(arena, "src/b", 0.5, callOrder),
      },
      arena,
      callOrder,
      limitBytes,
    });
    instantiate(h.core, "old", "src/a", 1);
    for (let i = 0; i < FADE_IN_BLOCKS + 2; i++) h.step(1);
    const releasesBefore = h.releaseCount();

    h.core.handleMessage(prepareAdd("candidate", "src/b", 2));
    expect(transactionAck(h, 2, "prepare")?.ok).toBe(false);
    expect(h.releaseCount()).toBeGreaterThan(releasesBefore);
    h.step(1);
    expect(h.core.telemetry.instances.map((instance) => instance.identity)).toEqual(["old"]);
    expect(h.core.readOutput()[0]).toBeCloseTo(0.25, 6);
  });

  it("does not expose a committed candidate before the explicit activation gate", () => {
    const arena = new ArrayBuffer(1024 * 1024);
    const callOrder: string[] = [];
    const h = buildGraphHarness({
      adapters: {
        "src/a": createConstAdapter(arena, "src/a", 0.25, callOrder),
        "src/b": createConstAdapter(arena, "src/b", 0.5, callOrder),
      },
      arena,
      callOrder,
    });
    instantiate(h.core, "old", "src/a", 1);
    for (let i = 0; i < FADE_IN_BLOCKS + 2; i++) h.step(1);

    h.core.handleMessage(prepareAdd("candidate", "src/b", 2));
    h.core.handleMessage({ type: "commit-graph", transactionId: 2 });
    h.step(2);
    expect(h.core.telemetry.instances.map((instance) => instance.identity)).toEqual(["old"]);
    expect(h.core.readOutput()[0]).toBeCloseTo(0.25, 6);

    const releasesBefore = h.releaseCount();
    h.core.handleMessage({ type: "abort-graph", transactionId: 2 });
    expect(h.releaseCount()).toBeGreaterThan(releasesBefore);
    expect(transactionAck(h, 2, "abort")?.ok).toBe(true);
  });

  it("activates the complete candidate exactly once on its matching epoch", () => {
    const arena = new ArrayBuffer(1024 * 1024);
    const callOrder: string[] = [];
    const h = buildGraphHarness({
      adapters: {
        "src/a": createConstAdapter(arena, "src/a", 0.25, callOrder),
        "src/b": createConstAdapter(arena, "src/b", 0.5, callOrder),
      },
      arena,
      callOrder,
    });
    instantiate(h.core, "old", "src/a", 1);
    for (let i = 0; i < FADE_IN_BLOCKS + 2; i++) h.step(1);

    h.core.handleMessage(prepareAdd("candidate", "src/b", 2));
    h.core.handleMessage({ type: "commit-graph", transactionId: 2 });
    h.core.handleMessage({ type: "activate-graph", transactionId: 2 });
    // Gate acceptance is not activation: acknowledgement waits for the
    // matching epoch to swap at the audio block boundary.
    expect(transactionAck(h, 2, "activate")).toBeUndefined();
    h.step(2);
    expect(transactionAck(h, 2, "activate")?.ok).toBe(true);
    h.step(2);

    expect(h.core.telemetry.instances.map((instance) => instance.identity).sort()).toEqual([
      "candidate",
      "old",
    ]);
    const activations = h.events.filter((event) =>
      "type" in event && event.type === "graph-activated" && event.epoch === 2
    );
    expect(activations).toHaveLength(1);
  });
});

describe("workletCore graph — per-instance trap containment", () => {
  it("rejects an init-trapping candidate and keeps the old graph audible", () => {
    const arena = new ArrayBuffer(1024 * 1024);
    const callOrder: string[] = [];
    const bad = createConstAdapter(arena, "src/bad-init", 0.75, callOrder);
    (bad as { init: NodeDefAdapter["init"] }).init = () => {
      throw new WebAssembly.RuntimeError("synthetic init trap");
    };
    const h = buildGraphHarness({
      adapters: {
        "src/good": createConstAdapter(arena, "src/good", 0.25, callOrder),
        "src/bad-init": bad,
      },
      arena,
      callOrder,
    });
    instantiate(h.core, "old", "src/good", 1);
    for (let i = 0; i < FADE_IN_BLOCKS + 2; i++) h.step(1);

    expect(() => h.core.handleMessage({
      type: "prepare-graph",
      transactionId: 2,
      epoch: 2,
      deltas: [{
        type: "instantiate",
        identity: {
          identity: "candidate",
          def: "src/bad-init",
          version: 1,
          epoch: 2,
        },
        statePointer: 0,
        stateBytes: 0,
        audioOutputs: 1,
      }],
    })).not.toThrow();
    h.step(1);

    expect(h.diagnostics()).toContainEqual({
      type: "graph-diagnostic",
      code: "nodedef-trap",
      identity: "candidate",
    });
    expect(h.events).toContainEqual(expect.objectContaining({
      type: "graph-transaction-ack",
      transactionId: 2,
      phase: "prepare",
      ok: false,
    }));
    expect(h.core.telemetry.instances.map((instance) => instance.identity))
      .toEqual(["old"]);
    expect(h.core.readOutput()[0]).toBeCloseTo(0.25, 6);
  });

  it("quarantines a throwing NodeDef while sibling instances keep rendering", () => {
    const arena = new ArrayBuffer(1024 * 1024);
    const callOrder: string[] = [];
    const bad = createConstAdapter(arena, "src/bad", 0.75, callOrder);
    (bad as { compute: NodeDefAdapter["compute"] }).compute = () => {
      callOrder.push("src/bad");
      throw new WebAssembly.RuntimeError("synthetic trap");
    };
    const h = buildGraphHarness({
      adapters: {
        "src/bad": bad,
        "src/good": createConstAdapter(arena, "src/good", 0.25, callOrder),
      },
      arena,
      callOrder,
    });
    instantiate(h.core, "bad", "src/bad", 1);
    instantiate(h.core, "good", "src/good", 1);

    expect(() => h.step(1)).not.toThrow();
    for (let i = 0; i < FADE_IN_BLOCKS + 2; i++) h.step(1);

    expect(h.diagnostics()).toContainEqual({
      type: "graph-diagnostic",
      code: "nodedef-trap",
      identity: "bad",
    });
    expect(h.core.telemetry.instances.map((instance) => instance.identity))
      .toEqual(["good"]);
    expect(h.core.readOutput()[0]).toBeCloseTo(0.25, 6);
  });
});

// ---------------------------------------------------------------------------
// Resource limits and diagnostics
// ---------------------------------------------------------------------------

describe("workletCore graph — zone exhaustion and node limit (synthesis.md §3.5)", () => {
  it("publishes a zone-exhausted diagnostic instead of glitching", () => {
    const arena = new ArrayBuffer(1024 * 1024);
    const callOrder: string[] = [];
    // Arena bounded so the FIRST node fits but the second's output zone
    // does not: null guard + silence zone (128 doubles) + control
    // scratches + state A + output A + state B, then output B fails.
    const limitBytes =
      SYNTH_ARENA_NULL_GUARD_BYTES +
      128 * BYTES_PER_DOUBLE + // silence zone
      2 * BYTES_PER_DOUBLE + // control scratches
      24 + // state A
      128 * BYTES_PER_DOUBLE + // output A
      24 + // state B
      64; // slack below a second 1 KiB output zone
    const h = buildGraphHarness({
      adapters: {
        "src/a": createConstAdapter(arena, "src/a", 0.25, callOrder),
        "src/b": createConstAdapter(arena, "src/b", 0.5, callOrder),
      },
      arena,
      callOrder,
      limitBytes,
    });
    instantiate(h.core, "id-a", "src/a", 1);
    instantiate(h.core, "id-b", "src/b", 1);
    for (let i = 0; i < FADE_IN_BLOCKS + 2; i++) h.step(1);

    const diags = h.diagnostics();
    expect(diags.some((d) => d.code === "zone-exhausted" && d.identity === "id-b")).toBe(true);
    // The first node still renders cleanly.
    expect(h.core.readOutput()[0]).toBeCloseTo(0.25, 6);
  });

  it("refuses the node beyond MAX_SYNTH_NODES with a node-limit diagnostic", () => {
    const arena = new ArrayBuffer(8 * 1024 * 1024);
    const callOrder: string[] = [];
    const h = buildGraphHarness({
      adapters: {
        "src/a": createConstAdapter(arena, "src/a", 0.001, callOrder),
      },
      arena,
      callOrder,
    });
    for (let i = 0; i < MAX_SYNTH_NODES; i++) {
      instantiate(h.core, `id-${i}`, "src/a", 1);
    }
    expect(h.diagnostics()).toHaveLength(0);
    instantiate(h.core, `id-${MAX_SYNTH_NODES}`, "src/a", 1);
    const diags = h.diagnostics();
    expect(
      diags.some(
        (d) => d.code === "node-limit" && d.identity === `id-${MAX_SYNTH_NODES}`,
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Steady-state allocation freedom with multiple nodes
// ---------------------------------------------------------------------------

describe("workletCore graph — steady state stays allocation-free (VAL-ENGINE-034)", () => {
  it("does not touch the allocator during steady-state multi-node blocks", () => {
    const arena = new ArrayBuffer(1024 * 1024);
    const callOrder: string[] = [];
    const h = buildGraphHarness({
      adapters: {
        "src/a": createConstAdapter(arena, "src/a", 0.25, callOrder),
        "src/b": createConstAdapter(arena, "src/b", 0.5, callOrder),
        "fx/gain": createGainAdapter(arena, "fx/gain", 2, callOrder),
      },
      arena,
      callOrder,
    });
    instantiate(h.core, "id-a", "src/a", 1);
    instantiate(h.core, "id-b", "src/b", 1);
    instantiate(h.core, "id-c", "fx/gain", 1, {
      audioInputs: [{ port: 0, sourceIdentity: "id-a", sourcePort: 0 }],
    });
    for (let i = 0; i < FADE_IN_BLOCKS + 2; i++) h.step(1);

    const allocsBefore = h.allocCount();
    const releasesBefore = h.releaseCount();
    for (let i = 0; i < 10; i++) h.step(1);
    expect(h.allocCount()).toBe(allocsBefore);
    expect(h.releaseCount()).toBe(releasesBefore);
  });
});

// ---------------------------------------------------------------------------
// Render-quantum growth keeps shared-memory linkage (ergo 10271a1d)
// ---------------------------------------------------------------------------

describe("workletCore graph — quantum growth re-derives arena views (synthesis.md §1.4)", () => {
  it("keeps DSP output audible when frameCount grows past the constructed size", () => {
    const arena = new ArrayBuffer(1024 * 1024);
    const callOrder: string[] = [];
    const h = buildGraphHarness({
      adapters: {
        "src/a": createConstAdapter(arena, "src/a", 0.5, callOrder),
      },
      arena,
      callOrder,
      renderQuantumFrames: 128,
    });
    instantiate(h.core, "id-a", "src/a", 1);
    for (let i = 0; i < FADE_IN_BLOCKS + 2; i++) h.step(1);
    expect(h.core.readOutput()[0]).toBeCloseTo(0.5, 6);

    // The runtime hands us a larger quantum. The pre-fix growth path
    // replaced the scratch views with fresh non-shared arrays, severing
    // the WASM link and producing permanent silence. Growth must
    // instead re-derive views over the arena.
    for (let i = 0; i < 3; i++) h.step(1, undefined, 256);
    const out = h.core.readOutput();
    expect(out.length).toBeGreaterThanOrEqual(256);
    expect(out[0]).toBeCloseTo(0.5, 6);
    expect(out[200]).toBeCloseTo(0.5, 6);
  });
});
