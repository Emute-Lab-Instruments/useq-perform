/**
 * State-identity sidecar — core types.
 *
 * Spec: docs/specs/state-identity.md (Phase 3 editor hidden IDs).
 *
 * The identity sidecar assigns a stable opaque {@link StateId} to every
 * stateful top-level form (currently anonymous `synth`; future registrars
 * extend the classifier). The ID follows the form through logical edits,
 * formatting, structural transforms, recognised moves, undo, and redo. It
 * forks on copy, duplicate, and independent recreation.
 *
 * The map is keyed by a **structural FormKey** — a path of child indices
 * from the document root to the form. Identity is never derived from source
 * text, current range, ordinal alone, or a hash. Position changes are
 * tracked through CodeMirror's ChangeSet to decide preserve-vs-fork.
 *
 * This module is pure data + types — no CodeMirror, no Lezer, no I/O.
 */

// ─── Identifiers ───────────────────────────────────────────────────────────

/**
 * An opaque stable identifier assigned to a stateful form.
 *
 * The textual form is url-safe base32, never appears in visible editor
 * text, clipboard text, diagnostics, console, or persisted source, and is
 * only ever written to the sidecar/payload layer.
 */
export type StateId = string & { readonly __opaque: unique symbol };

/**
 * Structural path from the document root to a form: a list of child indices
 * into the Lezer parse tree, going downward. The empty path is the document
 * root itself. Form keys are computed from the Lezer tree at parse time and
 * are how we recognise "the same logical position" across re-parses.
 *
 * **Map keying**: because arrays compare by reference in JavaScript, the
 * identity map stores entries keyed by the {@link formKeyToString}
 * canonicalisation of the FormKey. Callers that build a FormKey must
 * convert it via {@link formKeyToString} before lookup; the helpers in
 * `identityMapState.ts` and `identityReconcile.ts` do this transparently.
 */
export type FormKey = ReadonlyArray<number>;

/**
 * Canonical string form of a FormKey, used as the actual Map key so two
 * arrays representing the same path compare equal. Deliberately uses a
 * separator (`/`) that cannot appear in a numeric index, and a leading
 * marker so the empty FormKey never collides with `[0]`.
 */
export function formKeyToString(key: FormKey): string {
  return "fk:" + key.join("/");
}

/** Inverse of {@link formKeyToString}. */
export function formKeyFromString(s: string): FormKey {
  if (!s.startsWith("fk:")) {
    throw new Error(`formKeyFromString: not a canonical form key: ${s}`);
  }
  const body = s.slice(3);
  if (body === "") return [];
  return body.split("/").map((n) => Number.parseInt(n, 10));
}

/**
 * Recognised kind of stateful form. The default classifier only emits
 * `"synth"`; future modules (probes, live-edit) may extend the union via
 * {@link StatefulFormClassifier} composition without changing this core.
 */
export type StatefulFormKind = "synth" | "define-state";

// ─── Range and entry ───────────────────────────────────────────────────────

/** Inclusive character range `[from, to]` in the document. */
export interface IdentityRange {
  readonly from: number;
  readonly to: number;
}

/**
 * One identity entry in the sidecar. The {@link continuityToken} is a
 * monotonically-increasing integer stamped at creation and preserved across
 * preserve-remaps so that undo/redo exact-equality comparisons can rely on
 * it instead of on ranges (which move) or text (which may change).
 */
export interface IdentityEntry {
  readonly id: StateId;
  readonly kind: StatefulFormKind;
  /** Last-known document range of the host form. */
  readonly range: IdentityRange;
  /**
   * Stable token preserved through every remap that preserves identity. It
   * is only replaced (with a fresh value) on fork. Two entries with the
   * same token refer to the same logical identity.
   */
  readonly continuityToken: number;
  /**
   * Provenance marker used to recognise cut-then-paste as a move (preserve
   * identity) versus copy-paste (fork identity). When the editor cuts a
   * stateful form the cut entry's `pendingPasteToken` is set; a subsequent
   * paste that consumes the token restores the original identity.
   */
  readonly pendingPasteToken?: string;
}

// ─── Map ───────────────────────────────────────────────────────────────────

/**
 * Identity map: keyed by the canonical string form of a structural
 * {@link FormKey} (see {@link formKeyToString}). The map is immutable;
 * mutation helpers return a new map. Lookups by FormKey are O(log n).
 *
 * Invariants (enforced by the helpers in `identityMapState.ts`):
 *   1. Every {@link StateId} appears at most once.
 *   2. Every `continuityToken` appears at most once.
 *   3. Every `pendingPasteToken` appears at most once.
 *   4. The empty FormKey never appears (the document root is not stateful).
 *
 * `byId` stores the canonical string key, not the FormKey array, so it
 * also compares by value.
 */
export interface IdentityMap {
  readonly entries: ReadonlyMap<string, IdentityEntry>;
  /** Reverse index: id → canonical FormKey string. */
  readonly byId: ReadonlyMap<StateId, string>;
}

export const emptyIdentityMap: IdentityMap = {
  entries: new Map(),
  byId: new Map(),
};

// ─── Snapshot (serialisable shape used by persistence + payload layers) ────

/**
 * Schema-versioned snapshot. The state-identity core never reads or writes
 * localStorage itself (that is the persistence feature's job), but it
 * produces and consumes this shape so that the persistence layer is a thin
 * pass-through. Versioned for forward migration per persistence.md §1.6.
 */
export interface IdentitySnapshot {
  readonly schemaVersion: 1;
  /** Stable document fingerprint used to correlate snapshot with source. */
  readonly documentFingerprint: string;
  readonly entries: ReadonlyArray<{
    readonly id: StateId;
    readonly kind: StatefulFormKind;
    /**
     * Structural path stored as a plain array of numbers so the snapshot
     * round-trips through JSON without retaining array semantics.
     */
    readonly formKey: FormKey;
  }>;
}

// ─── Result of classifying a single parse ──────────────────────────────────

/**
 * A recognised stateful form in a freshly-parsed tree. The classifier
 * returns these; the reconciler matches them against the prior map.
 */
export interface RecognisedForm {
  readonly formKey: FormKey;
  readonly kind: StatefulFormKind;
  readonly range: IdentityRange;
  /**
   * If the form carries an explicit, user-authored identity (e.g. future
   * `:id` on `synth`, or hand-written `with-state-id`), the classifier
   * surfaces it here so the reconciler can prefer it over the sidecar ID
   * (state-identity.md §6.6).
   */
  readonly explicitId?: StateId;
}
