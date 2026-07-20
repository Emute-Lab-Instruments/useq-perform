/**
 * M2.2 routing integration: real compiler artefacts drive the engine.
 *
 * Loads the REAL interpreter WASM (public/wasm/useq.wasm), evaluates a
 * two-node FM chain, reads the synth artefact payload (declarations +
 * per-(node, param) controls + connections), builds the engine commit
 * plan, and executes the resulting worklet deltas on the simulated
 * worklet core — proving the full spine:
 *
 *   ModuLisp program → compiler artefact (edges + channel table)
 *     → engine commit plan → worklet deltas → topological execution
 *       with real port wiring and per-node control channels.
 *
 * Audio-thread behaviour (real AudioWorklet, fades, SAB pacing) is
 * covered by the M2.1 suites; the DSP adapters here are instrumented
 * fakes so the chain's data flow is observable exactly.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  DEFAULT_RENDER_QUANTUM_FRAMES,
  attachSynthesisControlView,
  createSynthesisControlBuffer,
  type SynthesisControlView,
} from "../contracts/synthesisControlAbi";
import {
  OSC_SINE_NODEDEF_DESCRIPTOR,
  buildNodeDefParamTable,
} from "../contracts/nodeDefRegistry";
import {
  isSynthArtifactsPayload,
  type SynthArtifactsPayload,
} from "../contracts/runtimeTypes";
import type { NodeDefAdapter } from "./nodeDefAdapter";
import {
  buildEngineCommitPlan,
  createEpochAllocator,
} from "./engineCommitCoordinator";
import {
  createWorkletCore,
  DEFAULT_WORKLET_SAMPLE_RATE,
  type WorkletCore,
} from "./workletCore";
import { createZoneAllocator } from "./workletZoneAllocator";
import type { WorkletOutboundEvent } from "./workletGraphDelta";

const BYTES_PER_DOUBLE = Float64Array.BYTES_PER_ELEMENT;

// ---------------------------------------------------------------------------
// Real interpreter bootstrap (mirrors test/synthRoutingWasm.test.mjs)
// ---------------------------------------------------------------------------

interface InterpreterModule {
  ccall(
    name: string,
    returnType: string | null,
    argTypes: string[],
    args: unknown[],
  ): unknown;
}

async function loadInterpreter(): Promise<InterpreterModule> {
  const root = process.cwd();
  const wasmBinary = readFileSync(resolve(root, "public/wasm/useq.wasm"));
  const glueSource = readFileSync(resolve(root, "public/wasm/useq.js"), "utf8");
  const createModule = new Function(`${glueSource}; return createModule;`)() as (
    options: Record<string, unknown>,
  ) => Promise<InterpreterModule>;
  const mod = await createModule({ wasmBinary });
  mod.ccall("useq_init", null, [], []);
  return mod;
}

// ---------------------------------------------------------------------------
// Instrumented input-capable adapter
// ---------------------------------------------------------------------------

interface ChainAdapter extends NodeDefAdapter {
  readonly outputPtrs: number[];
  readonly inputPtrVectors: number[][];
}

/**
 * osc/sine stand-in with observable data flow:
 *   - source path (no inputs wired): output = freq control (echo);
 *   - chain path (computeWithInputs): output = input + freq control.
 * The arithmetic makes per-node channel routing, wiring, and execution
 * order all observable in a single output number.
 */
function createChainAdapter(arena: ArrayBuffer): ChainAdapter {
  const descriptor = Object.freeze({
    ...OSC_SINE_NODEDEF_DESCRIPTOR,
    audioInputs: 1,
  });
  const outputPtrs: number[] = [];
  const inputPtrVectors: number[][] = [];
  return {
    descriptor,
    params: buildNodeDefParamTable(descriptor),
    validateLayout: () => true,
    init: () => true,
    compute(_statePtr, freqPtr, _ampPtr, outputPtr, frameCount) {
      outputPtrs.push(outputPtr);
      const freq = new Float64Array(arena, freqPtr, 1)[0];
      new Float64Array(arena, outputPtr, frameCount).fill(freq);
      return true;
    },
    computeWithInputs(_statePtr, inputPtrs, freqPtr, _ampPtr, outputPtr, frameCount) {
      outputPtrs.push(outputPtr);
      inputPtrVectors.push(inputPtrs.slice());
      const freq = new Float64Array(arena, freqPtr, 1)[0];
      const input = new Float64Array(arena, inputPtrs[0], frameCount);
      const out = new Float64Array(arena, outputPtr, frameCount);
      for (let i = 0; i < frameCount; i++) {
        out[i] = input[i] + freq;
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

// ---------------------------------------------------------------------------
// Simulated worklet host
// ---------------------------------------------------------------------------

interface Host {
  core: WorkletCore;
  view: SynthesisControlView;
  adapter: ChainAdapter;
  events: WorkletOutboundEvent[];
  step(epoch: number, channels: readonly number[]): void;
}

function buildHost(): Host {
  const arena = new ArrayBuffer(1024 * 1024);
  const allocator = createZoneAllocator({ limitBytes: arena.byteLength });
  const freqPtr = allocator.allocate(BYTES_PER_DOUBLE, 8);
  const ampPtr = allocator.allocate(BYTES_PER_DOUBLE, 8);
  const adapter = createChainAdapter(arena);
  const events: WorkletOutboundEvent[] = [];

  const core = createWorkletCore({
    adapterFactory: (name) => (name === "osc/sine" ? adapter : null),
    allocator,
    sampleRate: DEFAULT_WORKLET_SAMPLE_RATE,
    renderQuantumFrames: DEFAULT_RENDER_QUANTUM_FRAMES,
    publish: (e) => events.push(e),
    createArenaView: (byteOffset, lengthDoubles) =>
      new Float64Array(arena, byteOffset, lengthDoubles),
    freqControlScratch: new Float64Array(arena, freqPtr, 1),
    ampControlScratch: new Float64Array(arena, ampPtr, 1),
  });

  const controlBuffer = createSynthesisControlBuffer();
  core.handleMessage({
    type: "attach-control-buffer",
    controlBuffer: controlBuffer as unknown as SharedArrayBuffer,
  });
  const view = attachSynthesisControlView(controlBuffer);

  return {
    core,
    view,
    adapter,
    events,
    step(epoch, channels) {
      const slot = view.physicalSlotForSequence(view.ringWriteIndex);
      view.writeBlockEpoch(slot, epoch);
      view.writeBlockRevision(slot, 1);
      for (let i = 0; i < channels.length && i < view.blockRateCount; i++) {
        view.writeBlockRateValue(slot, i, channels[i]);
      }
      view.advanceWriteIndex();
      core.process(DEFAULT_RENDER_QUANTUM_FRAMES);
    },
  };
}

// ---------------------------------------------------------------------------
// The integration test
// ---------------------------------------------------------------------------

describe("M2.2 routing integration — real artefact drives the engine", () => {
  let payload: SynthArtifactsPayload;

  beforeAll(async () => {
    const mod = await loadInterpreter();
    const result = mod.ccall(
      "useq_eval",
      "string",
      ["string"],
      [
        '(do (synth "osc/sine" :name "lfo" :freq 2 :amp 110) ' +
          '    (synth "osc/sine" :name "car" :freq 440 :fm (node "lfo")))',
      ],
    ) as string;
    expect(result.startsWith("Error"), result).toBe(false);
    const parsed = JSON.parse(
      mod.ccall("useq_synth_artifacts", "string", [], []) as string,
    ) as unknown;
    expect(isSynthArtifactsPayload(parsed)).toBe(true);
    payload = parsed as SynthArtifactsPayload;
  });

  it("executes the artefact's two-node chain with real port wiring", () => {
    // The commit plan is built from the REAL artefact — edges and the
    // per-(node, param) channel table come from the compiler.
    const plan = buildEngineCommitPlan([], payload, createEpochAllocator());
    expect(plan.layout.channels).toEqual([
      { identity: "lfo", param: "freq", channel: 0 },
      { identity: "lfo", param: "amp", channel: 1 },
      { identity: "car", param: "freq", channel: 2 },
    ]);
    expect(plan.layout.audioInputs.get("car")).toEqual([
      { port: 0, sourceIdentity: "lfo", sourcePort: 0 },
    ]);

    // Drive the simulated worklet core with the plan's deltas, exactly
    // as the service posts them (statePointer/stateBytes 0 → the core
    // allocates zones between quanta).
    const host = buildHost();
    for (const delta of plan.workletDeltas) {
      if (delta.type === "instantiate") {
        host.core.handleMessage({
          ...delta,
          statePointer: 0,
          stateBytes: 0,
        });
      } else {
        host.core.handleMessage(delta);
      }
    }

    // SAB channels in commit-plan order: lfo.freq=2, lfo.amp=110,
    // car.freq=440. Step past the fade-in window.
    for (let i = 0; i < 8; i++) {
      host.step(plan.epoch, [2, 110, 440]);
    }

    // No missing-input-support diagnostic: the adapter is input-capable.
    const diagnostics = host.events.filter(
      (e): e is Extract<WorkletOutboundEvent, { type: "graph-diagnostic" }> =>
        "type" in e && e.type === "graph-diagnostic",
    );
    expect(diagnostics).toEqual([]);

    // Pointer wiring: car's input pointer IS lfo's output zone pointer.
    expect(host.adapter.inputPtrVectors.length).toBeGreaterThan(0);
    const lastInputs =
      host.adapter.inputPtrVectors[host.adapter.inputPtrVectors.length - 1];
    expect(host.adapter.outputPtrs).toContain(lastInputs[0]);

    // Chain arithmetic: lfo echoes its freq control (2) into its zone;
    // car adds its own freq control (440) to its input. Only the
    // terminal node (car) reaches the output: 2 + 440 = 442. This
    // proves per-node channels (each node read its own freq), the
    // edge wiring, and topological order in one number.
    const out = host.core.readOutput();
    expect(out[0]).toBeCloseTo(442, 4);
  });

  it("update-in-place re-commit keeps the chain intact", () => {
    const allocator = createEpochAllocator();
    const plan1 = buildEngineCommitPlan([], payload, allocator);
    const prior = payload.declarations.map((d) => ({
      identity: d.identity,
      def: d.def,
      version: d.version,
    }));
    const plan2 = buildEngineCommitPlan(prior, payload, allocator);

    const host = buildHost();
    const post = (deltas: typeof plan1.workletDeltas) => {
      for (const delta of deltas) {
        if (delta.type === "instantiate") {
          host.core.handleMessage({ ...delta, statePointer: 0, stateBytes: 0 });
        } else {
          host.core.handleMessage(delta);
        }
      }
    };

    post(plan1.workletDeltas);
    for (let i = 0; i < 8; i++) host.step(plan1.epoch, [2, 110, 440]);

    // Second commit updates in place (same identities, same def) — the
    // wiring travels with the update messages and the chain keeps
    // producing.
    post(plan2.workletDeltas);
    for (let i = 0; i < 8; i++) host.step(plan2.epoch, [3, 110, 550]);

    const out = host.core.readOutput();
    expect(out[0]).toBeCloseTo(553, 4);
  });
});
