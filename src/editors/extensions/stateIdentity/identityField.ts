/**
 * CodeMirror state field + effects for the state-identity sidecar.
 *
 * Spec: docs/specs/state-identity.md §7 (Editor Metadata), §8 (Copy/Paste),
 * §13.3 (Phase 3 editor hidden IDs).
 *
 * The field stores the {@link IdentityMap} and reconciles it on every
 * document-changing transaction. Identity flows are:
 *
 *   - **Preserve** (default): the form stays at the same structural
 *     FormKey across a doc change. Reconciliation copies the entry,
 *     refreshing the range but keeping `id` and `continuityToken`.
 *
 *   - **Move** (cut-then-paste): a clipboard-cut annotation stamps a
 *     `pendingPasteToken` on the entry; the matching paste annotation
 *     declares a recognised move. The reconciler re-attaches the entry at
 *     the new FormKey, preserving identity.
 *
 *   - **Fork** (copy, duplicate, independent recreation): new FormKeys
 *     with no recognised-move provenance receive fresh IDs.
 *
 *   - **History** (undo/redo): CodeMirror's history branch re-runs every
 *     prior transaction including its effects; the field therefore
 *     restores the exact prior mapping without any special handling. The
 *     `setIdentitySnapshot` effect is also provided for explicit restore
 *     (e.g. reload-from-persistence in the next feature).
 *
 * The field is dependency-injected via {@link IdentityConfig}; production
 * wiring lives in `createDefaultIdentityConfig.ts`.
 */

import { StateEffect, StateField, type Transaction } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import type { EditorState } from "@codemirror/state";
// `invertedEffects` is the official CodeMirror mechanism for threading
// history-aware sidecar state through undo/redo (VAL-ID-008). The facet
// lives in the `commands` package alongside `history()`. Importing it
// here does NOT couple this extension to the editor's command surface:
// `invertedEffects` is a passive facet that only fires when `history()`
// is also installed, and is a no-op otherwise.
import { invertedEffects } from "@codemirror/commands";

import type { IdGenerator } from "./identityGenerator.ts";
import type { StatefulFormClassifier } from "./identityClassify.ts";
import { recogniseStatefulForms } from "./identityClassify.ts";
import {
  type ContinuitySource,
  makeContinuitySource,
  type MapPosLike,
} from "./identityMapState.ts";
import {
  reconcileIdentity,
  stampCutToken,
  type ReconcileSignals,
  emptySignals,
} from "./identityReconcile.ts";
import {
  emptyIdentityMap,
  type FormKey,
  type IdentityMap,
} from "./identityTypes.ts";
import type { IdentityPersistence } from "./identityPersistence.ts";
import {
  buildIdentitySnapshot,
  recoverIdentityMap,
} from "./identitySnapshot.ts";

// ─── Config ────────────────────────────────────────────────────────────────

/**
 * Dependency-injection surface for the state-identity sidecar.
 *
 * Production wiring lives in `createDefaultIdentityConfig.ts`; tests pass
 * a custom config to drive the field in isolation (VAL-ID-020).
 *
 * The config must NOT depend on synthesis runtime or engine singletons.
 * The default classifier only inspects head-symbol text via the Lezer
 * parse tree, never reaching into the runtime.
 */
export interface IdentityConfig {
  /** ID generator — opaque tokens minted on fork. */
  readonly ids: IdGenerator;
  /** Classifier — decides which top-level forms are stateful. */
  readonly classifier: StatefulFormClassifier;
  /**
   * Source of monotonically-increasing continuity tokens. The default
   * constructor creates one inside the field; tests can pass their own
   * to assert exact post-undo equality.
   */
  readonly continuity?: ContinuitySource;
  /**
   * Optional persistence adapter. When present, the field reads any
   * stored snapshot at `create` time and restores safely-correlated
   * identities; on every map-changing transaction it writes the new
   * snapshot through the adapter. The default wiring
   * ({@link createDefaultIdentityConfig}) supplies the central
   * persistence service.
   *
   * Spec: state-identity.md §7.3, persistence.md. The adapter must not
   * access localStorage directly; it must route through the central
   * persistence service (VAL-ID-024).
   */
  readonly persistence?: IdentityPersistence;
  /**
   * Optional logger. Defaults to no-op. Used to surface reconciliation
   * decisions in devtools without affecting user-visible surfaces.
   */
  readonly log?: (event: IdentityLogEvent) => void;
}

/**
 * Identity-mapping ChangeSet stand-in. Used when a transaction has no
 * document change but still drives a reconciliation (e.g. an effect-only
 * transaction declares a move).
 */
const IDENTITY_MAPPER: MapPosLike = {
  mapPos(pos: number): number {
    return pos;
  },
};

/** Reconciliation event for the optional logger. */
export interface IdentityLogEvent {
  readonly kind: "preserve" | "fork" | "move" | "drop" | "restore";
  readonly id?: string;
  readonly fromKey?: FormKey;
  readonly toKey?: FormKey;
}

// ─── Effects ───────────────────────────────────────────────────────────────

/**
 * Declare a recognised move: the entry at `fromOldKey` was cut (its
 * `pendingPasteToken` was stamped), and is now being pasted at
 * `toNewKey`. The reconciler will re-attach the entry at the new key,
 * preserving identity (state-identity.md §8.3: cut/move/paste preserves
 * IDs).
 */
export const declareMoveEffect = StateEffect.define<{
  readonly pasteToken: string;
  readonly fromOldKey: FormKey;
  readonly toNewKey: FormKey;
}>();

/**
 * Mark a stateful form as cut: stamp a `pendingPasteToken` on its entry.
 * The token must be unique per cut operation (the field generates one if
 * the caller does not supply one). Used by the editor's clipboard cut
 * handler when the cut range covers a stateful form.
 */
export const markCutEffect = StateEffect.define<{
  readonly key: FormKey;
  readonly pasteToken: string;
}>();

/**
 * Restore an exact prior mapping. Used by:
 *   - reload-from-persistence (next feature): pass the snapshot loaded
 *     from the central persistence service.
 *   - tests that need to seed the field.
 *
 * The snapshot's `documentFingerprint` is checked against the current
 * document by the caller (not the field); the field trusts the caller.
 */
export const setIdentitySnapshotEffect = StateEffect.define<IdentityMap>();

// ─── Field value ───────────────────────────────────────────────────────────

export interface IdentityFieldValue {
  readonly map: IdentityMap;
  /**
   * Continuity source used to mint new tokens on fork. Lives in the
   * field value so it survives across transactions (continuity must be
   * monotonic across the editor's lifetime, not per-transaction).
   */
  readonly continuity: ContinuitySource;
}

// ─── Internal: classifier + signals from a transaction ─────────────────────

/**
 * Extract declared moves from a transaction's effects. Returns the
 * {@link ReconcileSignals} the reconciler consumes.
 */
function collectSignals(tr: Transaction): ReconcileSignals {
  const moves: { pasteToken: string; fromOldKey: FormKey; toNewKey: FormKey }[] = [];
  for (const e of tr.effects) {
    if (e.is(declareMoveEffect)) {
      moves.push(e.value);
    }
  }
  return moves.length === 0 ? emptySignals : { recognisedMoves: moves };
}

/**
 * Apply markCutEffect stamps to the in-flight map before reconciliation.
 * The stamps must land before the parse-driven reconcile so that the
 * matching `declareMoveEffect` (in the same transaction or a later one)
 * can find the token.
 */
function applyCutStamps(map: IdentityMap, tr: Transaction): IdentityMap {
  let out = map;
  let changed = false;
  for (const e of tr.effects) {
    if (e.is(markCutEffect)) {
      out = stampCutToken(out, e.value.key, e.value.pasteToken);
      changed = true;
    }
  }
  return changed ? out : map;
}

// ─── Field definition ──────────────────────────────────────────────────────

/**
 * Build the state-identity StateField from a config. The field is the
 * single source of truth for identity at runtime; everything else reads
 * from it (via `view.state.field(identityField)`).
 */
export function buildIdentityField(config: IdentityConfig): StateField<IdentityFieldValue> {
  const continuity = config.continuity ?? makeContinuitySource(0);
  const log = config.log ?? (() => {});
  const persistence = config.persistence;

  return StateField.define<IdentityFieldValue>({
    create(state: EditorState): IdentityFieldValue {
      // 1. Try to restore a persisted snapshot. The persistence adapter
      //    validates the payload; a null return means no safe restoration
      //    (empty storage, malformed JSON, unsupported version, wrong
      //    document fingerprint, etc.). state-identity.md §7.3.
      let priorMap: IdentityMap = emptyIdentityMap;
      if (persistence !== undefined) {
        try {
          const snapshot = persistence.load();
          if (snapshot !== null) {
            const recovered = recoverIdentityMap(
              snapshot,
              state,
              config.classifier,
              config.ids,
              continuity,
            );
            priorMap = recovered.map;
          }
        } catch {
          // Persistence must never crash the editor.
        }
      }

      // 2. Classify the initial document.
      const recognised = recogniseStatefulForms(state, config.classifier);

      // 3. If the recovered map covers every recognised form by FormKey,
      //    it is the authoritative restored map. Otherwise reconcile:
      //    recovered entries act as the prior, and freshly-classified
      //    forms without a matching recovered entry fork new identities
      //    (conservative partial recovery, VAL-ID-012).
      let result;
      if (priorMap.entries.size === 0) {
        // No restoration: standard first-classification path.
        result = reconcileIdentity(
          emptyIdentityMap,
          recognised,
          emptySignals,
          IDENTITY_MAPPER,
          config.ids,
          continuity,
        );
        for (const id of result.debug.forked) log({ kind: "fork", id });
      } else {
        // Recovered entries seed the prior. The reconciler preserves
        // identity for forms whose range overlaps a recovered entry and
        // forks new identities for everything else. Because we pass an
        // identity-mapping changes object, ranges line up directly with
        // the recovered entries' ranges (which the recoverer filled in).
        result = reconcileIdentity(
          priorMap,
          recognised,
          emptySignals,
          IDENTITY_MAPPER,
          config.ids,
          continuity,
        );
        for (const id of result.debug.preserved) log({ kind: "preserve", id });
        for (const id of result.debug.forked) log({ kind: "fork", id });
        for (const id of result.debug.dropped) log({ kind: "drop", id });
      }

      // 4. Persist the initial snapshot (no-op under nosave or when no
      //    persistence adapter is configured).
      if (persistence !== undefined) {
        try {
          persistence.save(
            buildIdentitySnapshot(result.map, state.doc.toString()),
          );
        } catch {
          // Persistence failures must never crash the editor.
        }
      }

      return { map: result.map, continuity };
    },

    update(value: IdentityFieldValue, tr: Transaction): IdentityFieldValue {
      // 1. Snapshot restore: explicit effect wins outright. When the
      //    history plugin replays a merged event (multiple transactions
      //    composed into one history entry), it concatenates the
      //    per-transaction snapshots in reverse-chronological order:
      //    the FIRST effect in the array is the snapshot of the most
      //    recent transaction's start state, and the LAST effect is the
      //    snapshot of the earliest transaction's start state. Undo
      //    restores the document to the earliest state, so the LAST
      //    snapshot is the one that matches the final document
      //    coordinates. We therefore pick the last snapshot in the
      //    transaction's effects (VAL-ID-008).
      let snapshot: IdentityMap | undefined;
      for (const e of tr.effects) {
        if (e.is(setIdentitySnapshotEffect)) {
          snapshot = e.value;
        }
      }
      if (snapshot !== undefined) {
        log({ kind: "restore" });
        const next = { map: snapshot, continuity: value.continuity };
        if (persistence !== undefined) {
          try {
            persistence.save(
              buildIdentitySnapshot(next.map, tr.state.doc.toString()),
            );
          } catch {
            // ignore
          }
        }
        return next;
      }

      // 2. Apply cut stamps first, so reconciliation can see them.
      const stamped = applyCutStamps(value.map, tr);

      // 3. If the doc did not change and there are no move declarations,
      //    the map (with any cut stamps) is the new value. Ranges do not
      //    need remapping because nothing moved.
      const signals = collectSignals(tr);
      if (!tr.docChanged && signals.recognisedMoves.length === 0) {
        return stamped === value.map ? value : { map: stamped, continuity: value.continuity };
      }

      // 4. The reconciler maps prior ranges through `changes` itself to
      //    decide preserve-vs-fork. We pass the (possibly stamped) prior
      //    map plus the ChangeSet; no pre-mapping here.

      // 5. Re-run the classifier on the new tree and reconcile.
      const recognised = recogniseStatefulForms(tr.state, config.classifier);
      // For the changes argument: if the doc changed, use tr.changes;
      // otherwise pass an identity-mapping object so prior ranges are
      // preserved (the parse didn't move anything).
      const changesArg = tr.docChanged ? tr.changes : IDENTITY_MAPPER;
      const result = reconcileIdentity(
        stamped,
        recognised,
        signals,
        changesArg,
        config.ids,
        value.continuity,
      );
      for (const id of result.debug.preserved) log({ kind: "preserve", id });
      for (const id of result.debug.forked) log({ kind: "fork", id });
      for (const id of result.debug.moved) log({ kind: "move", id });
      for (const id of result.debug.dropped) log({ kind: "drop", id });

      const next = { map: result.map, continuity: value.continuity };

      // 6. Persist the updated snapshot through the central service. The
      //    service applies `?nosave`; we save unconditionally so a future
      //    toggle-on persists immediately on the next change.
      if (persistence !== undefined && tr.docChanged) {
        try {
          persistence.save(
            buildIdentitySnapshot(next.map, tr.state.doc.toString()),
          );
        } catch {
          // Persistence failures must never crash the editor.
        }
      }

      return next;
    },
  });
}

/**
 * Build the identity extension set. Returns an array so the caller can
 * combine it with other extensions idiomatically.
 *
 * The returned set installs:
 *
 *   1. The identity {@link StateField} itself.
 *   2. An `invertedEffects` facet registration that captures the field's
 *      value at `tr.startState` for every history-stored transaction.
 *      When CodeMirror's history plugin later inverts that transaction
 *      (on undo or redo), the captured snapshot is replayed as a
 *      {@link setIdentitySnapshotEffect}, and the field's `update`
 *      restores the exact prior mapping.
 *
 *      This is the official CodeMirror mechanism for threading
 *      history-aware sidecar state through undo/redo (see
 *      `@codemirror/commands` `invertedEffects`). Without it, the field
 *      sees an undo transaction as a fresh forward edit whose prior
 *      map is the post-edit map, so every "restored" form receives a
 *      freshly-minted forked ID instead of the exact original
 *      (VAL-ID-008, Ergo bug fe2dd786).
 */
export function identityExtensions(config: IdentityConfig): Extension[] {
  return identityExtensionsWithField(config).extensions;
}

/**
 * Same as {@link identityExtensions} but also returns the built
 * {@link StateField} instance. CodeMirror compares StateFields by
 * reference, so callers that want to read the field back from
 * `view.state.field(field)` must use the SAME reference that was
 * installed in the extension set. This helper makes that ergonomic
 * for tests and for production wiring that needs to share the field
 * reference with downstream consumers.
 */
export function identityExtensionsWithField(config: IdentityConfig): {
  readonly field: StateField<IdentityFieldValue>;
  readonly extensions: Extension[];
} {
  const field = buildIdentityField(config);
  const extensions: Extension[] = [
    field,
    // Register an invertedEffects callback that captures the identity
    // map BEFORE every history-stored transaction. The history plugin
    // replays this snapshot as an effect when the transaction is later
    // inverted by undo or redo, so the field restores the exact prior
    // mapping instead of regenerating IDs through the forward
    // reconciler (VAL-ID-008).
    invertedEffects.of((tr: Transaction): readonly StateEffect<unknown>[] => {
      // Read the field value off the start state. Use `field(field, false)`
      // so we tolerate (very unusual) configs where the field is not yet
      // installed on the start state; in that case there is nothing to
      // capture.
      let prior: IdentityFieldValue | undefined;
      try {
        prior = tr.startState.field(field, false);
      } catch {
        prior = undefined;
      }
      if (prior === undefined) return [];
      return [setIdentitySnapshotEffect.of(prior.map) as StateEffect<unknown>];
    }),
  ];
  return { field, extensions };
}

/**
 * Read the current identity map from an editor state. Convenience helper
 * for eval-payload and persistence layers.
 */
export function readIdentityMap(state: EditorState, field: StateField<IdentityFieldValue>): IdentityMap {
  try {
    return state.field(field).map;
  } catch {
    // Field not installed; return empty.
    return emptyIdentityMap;
  }
}

// ─── Paste-token generation ────────────────────────────────────────────────

let __pasteCounter = 0;
/**
 * Mint a unique paste token. Used by editor command handlers when
 * cutting a stateful form so a subsequent paste can be recognised as a
 * move rather than a copy.
 */
export function newPasteToken(): string {
  __pasteCounter += 1;
  // Include a timestamp-ish suffix so the token survives across reloads
  // (different sessions should never reuse each other's tokens).
  return `mv-${Date.now().toString(36)}-${__pasteCounter}`;
}
