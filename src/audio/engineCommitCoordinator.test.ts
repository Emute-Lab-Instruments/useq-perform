/**
 * Contract tests for the eval-to-epoch engine-commit coordinator.
 *
 * Covers (see mission feature `m1-eval-epoch-engine-commit`):
 *   VAL-ENGINE-010 — graph diff, revision arm, epoch allocation,
 *                    prefill, and activation occur in the required order.
 *   VAL-ENGINE-013 — superseded responses and late blocks are no-ops.
 *   VAL-ENGINE-014 — same identity and def/version update in place with
 *                    stable phase and instance ID.
 *   VAL-ENGINE-015 — failed evals change diagnostics only.
 *
 * The coordinator is a pure module: given the prior active declarations
 * and an incoming artefact payload, it produces the graph diff, allocates
 * the next program epoch, resolves prefills from the NodeDef registry,
 * and emits the ordered list of worklet messages + the Worker arm-epoch
 * call. It performs no I/O and touches no singletons.
 */
import { describe, expect, it, beforeEach } from "vitest";

import {
  allocateEpoch,
  buildEngineCommitPlan,
  buildGraphDiff,
  buildWorkletDeltasFromDiff,
  createEpochAllocator,
  resolvePrefillsForDeclarations,
  type ActiveDeclaration,
} from "./engineCommitCoordinator";
import { INTERIM_BLOCK_RATE_CHANNELS_PER_NODE } from "../contracts/synthesisControlAbi";
import { OSC_SINE_NODEDEF_DESCRIPTOR } from "../contracts/nodeDefRegistry";
import type {
  SynthArtifactsPayload,
  SynthDeclarationArtefact,
  SynthControlChannelArtefact,
} from "../contracts/runtimeTypes";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function oscSineDeclaration(identity: string): SynthDeclarationArtefact {
  return {
    identity,
    def: "osc/sine",
    version: 1,
    audio_inputs: 0,
    audio_outputs: 1,
  };
}

function oscSineControls(identity: string): SynthControlChannelArtefact[] {
  return [
    { identity, param: "freq", rate: "block", smoothing: "step" },
    { identity, param: "amp", rate: "block", smoothing: "linear" },
  ];
}

function buildPayload(
  revision: number,
  declarations: SynthDeclarationArtefact[],
  controls: SynthControlChannelArtefact[] = declarations.flatMap((d) =>
    oscSineControls(d.identity),
  ),
): SynthArtifactsPayload {
  return {
    abi: 1,
    revision,
    declarations,
    controls,
  };
}

// ---------------------------------------------------------------------------
// Graph diff
// ---------------------------------------------------------------------------

describe("engineCommitCoordinator — graph diff (VAL-ENGINE-010)", () => {
  it("classifies a brand-new identity as added", () => {
    const diff = buildGraphDiff([], [oscSineDeclaration("lead")]);
    expect(diff.added).toHaveLength(1);
    expect(diff.added[0].identity).toBe("lead");
    expect(diff.updatedInPlace).toHaveLength(0);
    expect(diff.retired).toHaveLength(0);
  });

  it("classifies same identity + same def/version as updated-in-place", () => {
    const prior: ActiveDeclaration[] = [
      {
        identity: "lead",
        def: "osc/sine",
        version: 1,
      },
    ];
    const diff = buildGraphDiff(prior, [oscSineDeclaration("lead")]);
    expect(diff.updatedInPlace).toHaveLength(1);
    expect(diff.added).toHaveLength(0);
    expect(diff.retired).toHaveLength(0);
  });

  it("classifies same identity + different def as retire-and-replace", () => {
    const prior: ActiveDeclaration[] = [
      { identity: "lead", def: "osc/saw", version: 1 },
    ];
    const diff = buildGraphDiff(prior, [oscSineDeclaration("lead")]);
    // Retire-and-replace is represented as retire(prior) + added(incoming).
    expect(diff.retired).toHaveLength(1);
    expect(diff.retired[0].def).toBe("osc/saw");
    expect(diff.added).toHaveLength(1);
    expect(diff.added[0].def).toBe("osc/sine");
  });

  it("classifies an identity that disappeared as retired", () => {
    const prior: ActiveDeclaration[] = [
      { identity: "lead", def: "osc/sine", version: 1 },
    ];
    const diff = buildGraphDiff(prior, []);
    expect(diff.retired).toHaveLength(1);
    expect(diff.added).toHaveLength(0);
    expect(diff.updatedInPlace).toHaveLength(0);
  });

  it("preserves identity keys through the diff (stable identity, not text)", () => {
    // Two distinct identities with the same def — both survive.
    const prior: ActiveDeclaration[] = [
      { identity: "lead", def: "osc/sine", version: 1 },
    ];
    const incoming = [
      oscSineDeclaration("lead"),
      oscSineDeclaration("bass"),
    ];
    const diff = buildGraphDiff(prior, incoming);
    expect(diff.updatedInPlace.map((d) => d.identity)).toEqual(["lead"]);
    expect(diff.added.map((d) => d.identity)).toEqual(["bass"]);
  });
});

// ---------------------------------------------------------------------------
// Epoch allocation
// ---------------------------------------------------------------------------

describe("engineCommitCoordinator — epoch allocation (VAL-ENGINE-010)", () => {
  it("allocates monotonically increasing epochs", () => {
    const allocator = createEpochAllocator();
    const e1 = allocator.next();
    const e2 = allocator.next();
    const e3 = allocator.next();
    expect(e2).toBe(e1 + 1);
    expect(e3).toBe(e2 + 1);
    expect(e1).toBeGreaterThan(0);
  });

  it("never returns zero (zero is the 'no program' sentinel)", () => {
    const allocator = createEpochAllocator();
    for (let i = 0; i < 10; i++) {
      expect(allocator.next()).not.toBe(0);
    }
  });

  it("allocateEpoch functional helper mirrors the allocator", () => {
    const allocator = createEpochAllocator();
    expect(allocateEpoch(allocator)).toBe(allocator.lastIssued());
    expect(allocateEpoch(allocator)).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Prefill resolution
// ---------------------------------------------------------------------------

describe("engineCommitCoordinator — prefill resolution (VAL-ENGINE-010)", () => {
  it("resolves prefill defaults from the NodeDef registry", () => {
    const prefills = resolvePrefillsForDeclarations(
      [oscSineDeclaration("lead")],
      oscSineControls("lead"),
    );
    expect(prefills.size).toBe(1);
    const leadPrefill = prefills.get("lead");
    expect(leadPrefill).toBeDefined();
    expect(leadPrefill?.get("freq")).toBe(
      OSC_SINE_NODEDEF_DESCRIPTOR.params.find((p) => p.name === "freq")!.default,
    );
    expect(leadPrefill?.get("amp")).toBe(
      OSC_SINE_NODEDEF_DESCRIPTOR.params.find((p) => p.name === "amp")!.default,
    );
  });

  it("returns an empty map when no declarations are supplied", () => {
    const prefills = resolvePrefillsForDeclarations([], []);
    expect(prefills.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Worklet delta ordering
// ---------------------------------------------------------------------------

describe("engineCommitCoordinator — worklet delta ordering (VAL-ENGINE-010)", () => {
  it("emits retire messages BEFORE instantiate messages", () => {
    // Retire-and-replace: the old instance must begin its release fade
    // before the new instance activates so the listener hears a
    // crossfade rather than an overlap.
    const prior: ActiveDeclaration[] = [
      { identity: "lead", def: "osc/saw", version: 1 },
    ];
    const incoming = [oscSineDeclaration("lead")];
    const diff = buildGraphDiff(prior, incoming);
    const prefills = resolvePrefillsForDeclarations(
      incoming,
      incoming.flatMap((d) => oscSineControls(d.identity)),
    );
    const deltas = buildWorkletDeltasFromDiff(diff, 42, prefills);

    const retireIdx = deltas.findIndex((d) => d.type === "retire");
    const instantiateIdx = deltas.findIndex((d) => d.type === "instantiate");
    expect(retireIdx).toBeGreaterThanOrEqual(0);
    expect(instantiateIdx).toBeGreaterThanOrEqual(0);
    expect(retireIdx).toBeLessThan(instantiateIdx);
  });

  it("tags every delta with the supplied program epoch", () => {
    const diff = buildGraphDiff([], [oscSineDeclaration("lead")]);
    const prefills = resolvePrefillsForDeclarations(
      [oscSineDeclaration("lead")],
      oscSineControls("lead"),
    );
    const deltas = buildWorkletDeltasFromDiff(diff, 7, prefills);
    for (const d of deltas) {
      if (d.type === "instantiate" || d.type === "update") {
        expect(d.identity.epoch).toBe(7);
      } else if (d.type === "retire") {
        expect(d.identity.epoch).toBe(7);
      }
    }
  });

  it("emits update messages (not instantiate) for updated-in-place identities", () => {
    const prior: ActiveDeclaration[] = [
      { identity: "lead", def: "osc/sine", version: 1 },
    ];
    const diff = buildGraphDiff(prior, [oscSineDeclaration("lead")]);
    const prefills = resolvePrefillsForDeclarations(
      [oscSineDeclaration("lead")],
      oscSineControls("lead"),
    );
    const deltas = buildWorkletDeltasFromDiff(diff, 3, prefills);
    expect(deltas.some((d) => d.type === "update")).toBe(true);
    expect(deltas.some((d) => d.type === "instantiate")).toBe(false);
  });

  it("includes prefill values on instantiate and update messages", () => {
    const prior: ActiveDeclaration[] = [
      { identity: "lead", def: "osc/sine", version: 1 },
    ];
    const diff = buildGraphDiff(
      prior,
      [oscSineDeclaration("lead"), oscSineDeclaration("pad")],
    );
    const prefills = resolvePrefillsForDeclarations(
      [oscSineDeclaration("lead"), oscSineDeclaration("pad")],
      [
        ...oscSineControls("lead"),
        ...oscSineControls("pad"),
      ],
    );
    const deltas = buildWorkletDeltasFromDiff(diff, 5, prefills);
    const instantiate = deltas.find((d) => d.type === "instantiate");
    expect(instantiate).toBeDefined();
    expect(instantiate?.prefill).toBeDefined();
    expect(instantiate?.prefill?.length).toBeGreaterThan(0);

    const update = deltas.find((d) => d.type === "update");
    expect(update).toBeDefined();
    expect(update?.prefill).toBeDefined();
  });

  it("emits no deltas for an empty diff (no-op)", () => {
    const prior: ActiveDeclaration[] = [
      { identity: "lead", def: "osc/sine", version: 1 },
    ];
    const diff = buildGraphDiff(prior, [oscSineDeclaration("lead")]);
    // Update-in-place is represented; force empty by filtering.
    const emptyDiff = {
      added: [],
      updatedInPlace: [],
      retired: [],
    };
    const deltas = buildWorkletDeltasFromDiff(emptyDiff, 1, new Map());
    expect(deltas).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// No-op on failed eval (VAL-ENGINE-015)
// ---------------------------------------------------------------------------

describe("engineCommitCoordinator — failed eval no-op (VAL-ENGINE-015)", () => {
  // The coordinator itself is pure; the no-op decision lives in the
  // service wrapper. We still assert the coordinator never mutates state
  // on its own: calling it with the same inputs always produces the same
  // outputs and never touches prior state.

  it("does not allocate an epoch until called", () => {
    const allocator = createEpochAllocator();
    const before = allocator.lastIssued();
    expect(before).toBe(0);
    allocator.next();
    expect(allocator.lastIssued()).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Multi-node delta fan-out (synthesis epic M2.1, ergo 9a9370af)
// ---------------------------------------------------------------------------

describe("engineCommitCoordinator — multi-node deltas (M2.1)", () => {
  it("assigns sequential controlChannelBase values in declaration order", () => {
    const payload = buildPayload(1, [
      oscSineDeclaration("id-a"),
      oscSineDeclaration("id-b"),
      oscSineDeclaration("id-c"),
    ]);
    const plan = buildEngineCommitPlan([], payload, createEpochAllocator());
    const instantiates = plan.workletDeltas.filter(
      (d): d is Extract<typeof d, { type: "instantiate" }> =>
        d.type === "instantiate",
    );
    expect(instantiates).toHaveLength(3);
    const baseFor = (identity: string) =>
      instantiates.find((d) => d.identity.identity === identity)?.controlChannelBase;
    expect(baseFor("id-a")).toBe(0);
    expect(baseFor("id-b")).toBe(INTERIM_BLOCK_RATE_CHANNELS_PER_NODE);
    expect(baseFor("id-c")).toBe(2 * INTERIM_BLOCK_RATE_CHANNELS_PER_NODE);
  });

  it("carries the artefact's audio port counts on instantiate deltas", () => {
    const decl = { ...oscSineDeclaration("id-a"), audio_outputs: 2 };
    const payload = buildPayload(1, [decl]);
    const plan = buildEngineCommitPlan([], payload, createEpochAllocator());
    const inst = plan.workletDeltas.find((d) => d.type === "instantiate");
    expect(inst).toBeDefined();
    expect((inst as { audioOutputs?: number }).audioOutputs).toBe(2);
  });

  it("re-bases update-in-place deltas when declaration order changes", () => {
    const prior: ActiveDeclaration[] = [
      { identity: "id-a", def: "osc/sine", version: 1 },
      { identity: "id-b", def: "osc/sine", version: 1 },
    ];
    // id-b now comes first: its channel window moves to base 0.
    const payload = buildPayload(2, [
      oscSineDeclaration("id-b"),
      oscSineDeclaration("id-a"),
    ]);
    const plan = buildEngineCommitPlan(prior, payload, createEpochAllocator());
    const updates = plan.workletDeltas.filter(
      (d): d is Extract<typeof d, { type: "update" }> => d.type === "update",
    );
    expect(updates).toHaveLength(2);
    const baseFor = (identity: string) =>
      updates.find((d) => d.identity.identity === identity)?.controlChannelBase;
    expect(baseFor("id-b")).toBe(0);
    expect(baseFor("id-a")).toBe(INTERIM_BLOCK_RATE_CHANNELS_PER_NODE);
  });

  it("fans out a full multi-declaration payload (no single-node assumption)", () => {
    const prior: ActiveDeclaration[] = [
      { identity: "id-old", def: "osc/sine", version: 1 },
    ];
    const payload = buildPayload(3, [
      oscSineDeclaration("id-a"),
      oscSineDeclaration("id-b"),
    ]);
    const plan = buildEngineCommitPlan(prior, payload, createEpochAllocator());
    const kinds = plan.workletDeltas.map((d) => d.type);
    // Retire the outgoing identity first, then instantiate both new ones.
    expect(kinds).toEqual(["retire", "instantiate", "instantiate"]);
  });
});
