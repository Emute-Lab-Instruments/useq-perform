/**
 * Eval-to-epoch engine-commit coordinator.
 *
 * Fulfils (see mission feature `m1-eval-epoch-engine-commit`):
 *   VAL-ENGINE-010 — graph diff, revision arm, epoch allocation, prefill,
 *                    and activation occur in the required order.
 *   VAL-ENGINE-013 — superseded responses and late blocks are no-ops
 *                    (the service-level guard rejects stale revisions
 *                    before reaching this module; this module's outputs
 *                    are deterministic functions of its inputs).
 *   VAL-ENGINE-014 — same identity + same def/version update in place;
 *                    the emitted `update` message preserves the active
 *                    instance and phase (the worklet core decides that,
 *                    but this module never emits an `instantiate` for
 *                    a same-def update).
 *   VAL-ENGINE-015 — failed evals change diagnostics only (the service
 *                    decides that; this module is pure and stateless).
 *
 * Design contract (normative, synthesis.md §4.4, §5.2; architecture.md
 * §5.6 "Eval-to-Engine Commit"):
 *
 *   1. The coordinator is PURE. Given the prior active declarations and
 *      an incoming synth artefact payload, it produces a {@link GraphDiff},
 *      resolves prefills from the NodeDef registry, and emits the ordered
 *      list of worklet messages. It performs no I/O, touches no
 *      singletons, and never mutates the caller's state.
 *
 *   2. The order of worklet messages is normative:
 *        a. retire messages (release fades for outgoing identities);
 *        b. instantiate messages (new identities or retire-and-replace);
 *        c. update messages (same identity + same def/version).
 *      Retire-before-instantiate preserves the crossfade order so the
 *      listener hears outgoing-then-incoming rather than an overlap.
 *
 *   3. Epoch allocation is a monotonic counter owned by the caller (the
 *      synthesis service). This module exposes {@link createEpochAllocator}
 *      so the service can allocate one per engine session; tests can
 *      construct a fresh allocator per case.
 *
 *   4. Prefill values come from the NodeDef registry's static defaults.
 *      The producer's first matching block lands after the worklet
 *      activates the delta; prefill covers the activation block only.
 *
 *   5. Identity is the stable editor sidecar ID. Source text, range, and
 *      ordinals are NEVER used as a key (VAL-COMP-004).
 */

import type {
  SynthArtifactsPayload,
  SynthDeclarationArtefact,
  SynthControlChannelArtefact,
} from "../contracts/runtimeTypes";
import { INTERIM_BLOCK_RATE_CHANNELS_PER_NODE } from "../contracts/synthesisControlAbi";
import { findNodeDefDescriptor } from "../contracts/nodeDefRegistry";
import type {
  WorkletIdentityTuple,
  WorkletInstantiateMessage,
  WorkletPrefillParam,
  WorkletRetireMessage,
  WorkletUpdateMessage,
} from "./workletGraphDelta";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * One entry in the active-declaration map the service tracks between
 * evals. Identity is the stable editor sidecar ID; def/version describe
 * the NodeDef the active instance was instantiated under.
 */
export interface ActiveDeclaration {
  /** Stable editor sidecar identity. */
  readonly identity: string;
  /** NodeDef name (e.g. `"osc/sine"`). */
  readonly def: string;
  /** NodeDef version. */
  readonly version: number;
}

/**
 * Output of {@link buildGraphDiff}. Every category is disjoint; an
 * identity appears in exactly one of the four buckets.
 *
 *   - `added`          — identity present in incoming, absent in prior.
 *   - `updatedInPlace` — identity present in both, def/version identical.
 *   - `retired`        — identity present in prior, absent in incoming,
 *                        OR present in both but def/version differs
 *                        (the prior declaration is retired; the
 *                        incoming one appears in `added` as a fresh
 *                        instance — retire-and-replace per
 *                        synth-nodes.md §5.7).
 *   - `unchanged`      — identity + def/version identical (informs the
 *                        no-op fast path; the service still emits an
 *                        `update` message so prefill values refresh for
 *                        the next block). The diff treats update-in-place
 *                        the same way; `unchanged` is kept for future
 *                        param-expression-aware diffing.
 */
export interface GraphDiff {
  readonly added: readonly ActiveDeclaration[];
  readonly updatedInPlace: readonly ActiveDeclaration[];
  readonly retired: readonly ActiveDeclaration[];
}

/**
 * One emitted worklet delta. The union mirrors {@link WorkletInstantiateMessage}
 * / {@link WorkletUpdateMessage} / {@link WorkletRetireMessage} but the
 * `statePointer`/`stateBytes` fields are omitted here because the host
 * (synthesis service) does not yet know them — the worklet core
 * allocates the state zone between quanta when it receives the
 * instantiate message. The service posts the full message; the
 * worklet core fills in the pointer.
 *
 * The ordering of this array is normative (retire → instantiate → update).
 */
export type WorkletDeltaMessage =
  | WorkletRetireMessage
  | (Omit<WorkletInstantiateMessage, "statePointer" | "stateBytes">)
  | WorkletUpdateMessage;

// ---------------------------------------------------------------------------
// Graph diff
// ---------------------------------------------------------------------------

/**
 * Compute the identity-keyed graph diff between the prior active
 * declarations and the incoming declarations.
 *
 * Identity is the stable editor sidecar ID. Source text and ordinals
 * are never consulted (VAL-COMP-004).
 *
 * The diff is total: every prior identity appears in exactly one of
 * {retired, updatedInPlace} and every incoming identity appears in
 * exactly one of {added, updatedInPlace}.
 */
export function buildGraphDiff(
  prior: readonly ActiveDeclaration[],
  incoming: readonly SynthDeclarationArtefact[],
): GraphDiff {
  const priorByIdentity = new Map<string, ActiveDeclaration>();
  for (const p of prior) {
    priorByIdentity.set(p.identity, p);
  }

  const incomingIdentities = new Set<string>();

  const added: ActiveDeclaration[] = [];
  const updatedInPlace: ActiveDeclaration[] = [];
  const retiredDueToDefChange: ActiveDeclaration[] = [];

  for (const inc of incoming) {
    incomingIdentities.add(inc.identity);
    const priorEntry = priorByIdentity.get(inc.identity);
    if (!priorEntry) {
      added.push({ identity: inc.identity, def: inc.def, version: inc.version });
    } else if (
      priorEntry.def === inc.def &&
      priorEntry.version === inc.version
    ) {
      updatedInPlace.push({
        identity: inc.identity,
        def: inc.def,
        version: inc.version,
      });
    } else {
      // Retire-and-replace: the prior identity is retired, the incoming
      // declaration is added as a fresh instance.
      retiredDueToDefChange.push(priorEntry);
      added.push({ identity: inc.identity, def: inc.def, version: inc.version });
    }
  }

  // Any prior identity absent from incoming is retired.
  const retired: ActiveDeclaration[] = [];
  for (const priorEntry of priorByIdentity.values()) {
    if (!incomingIdentities.has(priorEntry.identity)) {
      retired.push(priorEntry);
    }
  }
  for (const r of retiredDueToDefChange) {
    retired.push(r);
  }

  return { added, updatedInPlace, retired };
}

// ---------------------------------------------------------------------------
// Epoch allocation
// ---------------------------------------------------------------------------

/**
 * Monotonic epoch allocator. The service owns one of these per engine
 * session; {@link next} issues the next program epoch. Zero is the
 * "no program" sentinel and is never issued.
 */
export interface EpochAllocator {
  /**
   * Issue the next program epoch. Epochs are strictly monotonic and
   * never zero.
   */
  next(): number;
  /**
   * The most recently issued epoch, or zero when none has been issued.
   * Used by tests to assert the allocator advanced; production callers
   * should use {@link next} to issue a fresh epoch.
   */
  lastIssued(): number;
}

/**
 * Create a fresh epoch allocator. The first call to {@link EpochAllocator.next}
 * returns 1 (zero is reserved as the "no program" sentinel).
 */
export function createEpochAllocator(): EpochAllocator {
  let last = 0;
  return {
    next() {
      last += 1;
      return last;
    },
    lastIssued() {
      return last;
    },
  };
}

/**
 * Functional helper: allocate the next epoch from the supplied allocator
 * and return it. Mirrors {@link EpochAllocator.next}; tests that prefer a
 * functional style can call this.
 */
export function allocateEpoch(allocator: EpochAllocator): number {
  return allocator.next();
}

// ---------------------------------------------------------------------------
// Prefill resolution
// ---------------------------------------------------------------------------

/**
 * Resolve prefill param values for a set of declarations. The prefill
 * values are the NodeDef registry's static defaults — the producer's
 * first matching block lands after activation, so prefill covers the
 * activation block only (synthesis.md §4.4).
 *
 * Returns a map keyed by declaration identity; each value is a map of
 * param name → finite scalar.
 */
export function resolvePrefillsForDeclarations(
  declarations: readonly SynthDeclarationArtefact[],
  controls: readonly SynthControlChannelArtefact[],
): Map<string, Map<string, number>> {
  const result = new Map<string, Map<string, number>>();
  for (const decl of declarations) {
    const descriptor = findNodeDefDescriptor(decl.def, decl.version);
    if (!descriptor) continue;
    const paramTable = new Map<string, number>();
    // Collect the param names this declaration binds (from the control
    // table). For M1 every declaration binds every declared param; we
    // still iterate the controls so a future sparse-binding path works
    // without a second pass.
    const boundParams = new Set<string>();
    for (const ctl of controls) {
      if (ctl.identity === decl.identity) {
        boundParams.add(ctl.param);
      }
    }
    for (const param of descriptor.params) {
      // Prefill every declared param from the registry default. The
      // producer's first matching block overwrites these with the live
      // sampled value, so a stale slot is never read.
      //
      // VAL-CROSS-002: include ALL descriptor params, not just the
      // ones explicitly bound by the synth form. When the user writes
      // `(synth "osc/sine" :freq 440)` the interpreter emits a freq
      // control but not an amp control; the amp default (0.2) must
      // still be prefilled so the worklet's first render produces
      // non-silent output. The producer overwrites these with live
      // values on subsequent blocks.
      if (Number.isFinite(param.default)) {
        paramTable.set(param.name, param.default);
      }
    }
    if (paramTable.size > 0) {
      result.set(decl.identity, paramTable);
    }
  }
  return result;
}

/**
 * Build the {@link WorkletPrefillParam} array for a single declaration's
 * prefill map. Returns `undefined` when the map is empty so the message
 * stays minimal (the worklet treats an absent prefill as "use defaults").
 */
function buildPrefillArray(
  prefillMap: Map<string, number> | undefined,
): readonly WorkletPrefillParam[] | undefined {
  if (!prefillMap || prefillMap.size === 0) return undefined;
  const out: WorkletPrefillParam[] = [];
  for (const [name, value] of prefillMap) {
    out.push({ name, value });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Control-channel layout (interim, synthesis epic M2.1)
// ---------------------------------------------------------------------------

/**
 * Per-commit control/port layout derived from the incoming payload.
 * Until the compiler-derived channel table lands (M2.2), each
 * declaration receives a fixed window of
 * `INTERIM_BLOCK_RATE_CHANNELS_PER_NODE` block-rate channels assigned
 * sequentially in declaration order, plus the artefact's audio port
 * counts. Update-in-place deltas carry the (possibly re-based) window
 * so a reordering commit keeps every instance reading its own controls.
 */
export interface CommitControlLayout {
  /** Identity → first block-rate channel index. */
  readonly channelBases: ReadonlyMap<string, number>;
  /** Identity → audio output port count from the artefact. */
  readonly audioOutputs: ReadonlyMap<string, number>;
}

/**
 * Derive the interim control-channel layout from the incoming
 * declarations (declaration order is the payload's order — stable
 * across the plan and the producer arm for one commit).
 */
export function buildCommitControlLayout(
  declarations: readonly SynthDeclarationArtefact[],
): CommitControlLayout {
  const channelBases = new Map<string, number>();
  const audioOutputs = new Map<string, number>();
  declarations.forEach((decl, index) => {
    channelBases.set(decl.identity, index * INTERIM_BLOCK_RATE_CHANNELS_PER_NODE);
    audioOutputs.set(decl.identity, decl.audio_outputs);
  });
  return { channelBases, audioOutputs };
}

// ---------------------------------------------------------------------------
// Worklet delta construction
// ---------------------------------------------------------------------------

/**
 * Build the ordered list of worklet delta messages from a graph diff.
 *
 * Ordering (normative, VAL-ENGINE-010):
 *   1. retire messages — for every retired identity;
 *   2. instantiate messages — for every added identity;
 *   3. update messages — for every updated-in-place identity.
 *
 * Retire-before-instantiate preserves the crossfade order: outgoing
 * instances begin their release fades before incoming instances
 * activate, so the listener hears outgoing-then-incoming rather than
 * an overlap (synth-nodes.md §5.7).
 *
 * Every delta carries the supplied program epoch so the worklet can
 * activate the pending graph on the first matching SAB block.
 */
export function buildWorkletDeltasFromDiff(
  diff: GraphDiff,
  epoch: number,
  prefills: Map<string, Map<string, number>>,
  layout?: CommitControlLayout,
): WorkletDeltaMessage[] {
  const deltas: WorkletDeltaMessage[] = [];

  // 1. Retire messages.
  for (const retired of diff.retired) {
    const identity: WorkletIdentityTuple = {
      identity: retired.identity,
      def: retired.def,
      version: retired.version,
      epoch,
    };
    const message: WorkletRetireMessage = {
      type: "retire",
      identity: { identity: identity.identity, epoch: identity.epoch },
    };
    deltas.push(message);
  }

  // 2. Instantiate messages (with the interim control window + port
  //    counts, synthesis epic M2.1).
  for (const added of diff.added) {
    const identity: WorkletIdentityTuple = {
      identity: added.identity,
      def: added.def,
      version: added.version,
      epoch,
    };
    const message: Omit<WorkletInstantiateMessage, "statePointer" | "stateBytes"> = {
      type: "instantiate",
      identity,
      prefill: buildPrefillArray(prefills.get(added.identity)),
      controlChannelBase: layout?.channelBases.get(added.identity),
      audioOutputs: layout?.audioOutputs.get(added.identity),
    };
    deltas.push(message);
  }

  // 3. Update messages (same def/version → preserve DSP instance/phase).
  //    A reordering commit moves an instance's channel window, so the
  //    (re-based) window travels with the update.
  for (const updated of diff.updatedInPlace) {
    const identity: WorkletIdentityTuple = {
      identity: updated.identity,
      def: updated.def,
      version: updated.version,
      epoch,
    };
    const message: WorkletUpdateMessage = {
      type: "update",
      identity,
      prefill: buildPrefillArray(prefills.get(updated.identity)),
      controlChannelBase: layout?.channelBases.get(updated.identity),
    };
    deltas.push(message);
  }

  return deltas;
}

// ---------------------------------------------------------------------------
// Top-level commit plan
// ---------------------------------------------------------------------------

/**
 * A complete eval-to-engine commit plan: the diff, the allocated epoch,
 * the prefills, and the ordered worklet messages. The service consumes
 * this to drive its worklet port and Worker producer-arm calls.
 */
export interface EngineCommitPlan {
  /** The identity-keyed graph diff. */
  readonly diff: GraphDiff;
  /** The allocated program epoch for this commit. */
  readonly epoch: number;
  /** Per-identity prefill param maps. */
  readonly prefills: Map<string, Map<string, number>>;
  /** Ordered worklet delta messages (retire → instantiate → update). */
  readonly workletDeltas: readonly WorkletDeltaMessage[];
}

/**
 * Build a complete engine-commit plan from the prior active declarations
 * and an incoming artefact payload.
 *
 * This is the single entry point the synthesis service calls. It:
 *   1. Builds the graph diff (identity-keyed).
 *   2. Resolves prefills from the NodeDef registry defaults.
 *   3. Allocates the next program epoch.
 *   4. Builds the ordered worklet delta list.
 *
 * The caller is responsible for:
 *   - posting the {@link EngineCommitPlan.workletDeltas} to the worklet;
 *   - arming the Worker producer for the allocated {@link EngineCommitPlan.epoch};
 *   - updating its active-declaration map from the incoming payload.
 */
export function buildEngineCommitPlan(
  prior: readonly ActiveDeclaration[],
  incoming: SynthArtifactsPayload,
  allocator: EpochAllocator,
): EngineCommitPlan {
  const diff = buildGraphDiff(prior, incoming.declarations);
  const prefills = resolvePrefillsForDeclarations(
    incoming.declarations,
    incoming.controls,
  );
  const epoch = allocator.next();
  const layout = buildCommitControlLayout(incoming.declarations);
  const workletDeltas = buildWorkletDeltasFromDiff(diff, epoch, prefills, layout);
  return { diff, epoch, prefills, workletDeltas };
}
