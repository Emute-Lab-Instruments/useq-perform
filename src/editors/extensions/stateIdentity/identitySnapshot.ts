/**
 * Pure snapshot serialisation + safe recovery for the state-identity sidecar.
 *
 * Spec: docs/specs/state-identity.md §7.3 (metadata must persist with the
 * editor document/session via the central persistence service and follow
 * persistence.md error-recovery rules); docs/specs/persistence.md §1.4
 * (JSON parse errors never crash), §1.6 (explicit schemaVersion when
 * non-trivial migration is needed).
 *
 * This module is dependency-light: it imports the state-identity core types
 * and the classifier, plus CodeMirror's `EditorState` for range/parse tree
 * access via `recogniseStatefulForms`. It NEVER touches localStorage — that
 * is the persistence adapter's job.
 *
 * The two public entry points are:
 *
 *   - {@link buildIdentitySnapshot}: serialise a live IdentityMap plus the
 *     source it was built against into an {@link IdentitySnapshot}, ready
 *     for JSON-stringification by the persistence layer.
 *
 *   - {@link recoverIdentityMap}: take a stored snapshot plus the current
 *     editor state, validate the schema, correlate the snapshot against the
 *     current source via a stable document fingerprint, and produce a new
 *     IdentityMap containing only safely-correlated identities. When the
 *     fingerprint does not match (wrong document, stale session) recovery
 *     returns an empty map rather than attaching stale IDs to fresh forms
 *     (VAL-ID-011, VAL-ID-012).
 *
 * The companion {@link safeLoadIdentitySnapshot} validates a raw persisted
 * value and returns a typed {@link IdentitySnapshot} or `null` on any
 * schema, version, or shape problem.
 */

import type { EditorState } from "@codemirror/state";

import {
  emptyIdentityMap,
  type FormKey,
  type IdentityEntry,
  type IdentityMap,
  type IdentitySnapshot,
  type StateId,
  type StatefulFormKind,
} from "./identityTypes.ts";
import { formKeyToString } from "./identityTypes.ts";
import type { StatefulFormClassifier } from "./identityClassify.ts";
import { recogniseStatefulForms } from "./identityClassify.ts";
import { forkEntry, makeContinuitySource, type ContinuitySource } from "./identityMapState.ts";
import type { IdGenerator } from "./identityGenerator.ts";

// ─── Schema version ────────────────────────────────────────────────────────

/**
 * Current identity-snapshot schema version. Bump when the on-disk shape
 * changes in a way that requires non-trivial migration (persistence.md §1.6).
 *
 * Version 1 is the initial Phase-3 layout: `schemaVersion`, `documentFingerprint`,
 * and `entries: [{ id, kind, formKey }]`.
 */
export const IDENTITY_SNAPSHOT_SCHEMA_VERSION = 1;

// ─── Document fingerprint ──────────────────────────────────────────────────

/**
 * Compute a stable fingerprint for the document source text.
 *
 * Two documents with the same fingerprint are considered "the same document
 * session" for the purposes of restoring identity metadata: a snapshot
 * saved against fingerprint F may be restored into a freshly-loaded editor
 * whose source also has fingerprint F. When fingerprints differ, recovery
 * is conservative and restores nothing.
 *
 * The fingerprint is intentionally a hash of the full source text, NOT a
 * structural or content hash, so that legitimate edits (which change the
 * fingerprint) trigger re-classification rather than silent ID reuse. The
 * fingerprint changes whenever the visible source changes; that is the
 * contract required for "reload restores correlated identities" (VAL-ID-009).
 *
 * Implementation: FNV-1a 32-bit over the UTF-8 bytes, hex-encoded. Cheap,
 * dependency-free, and good enough to detect any single-character edit.
 */
export function computeDocumentFingerprint(source: string): string {
  // FNV-1a constants.
  let hash = 0x811c9dc5;
  for (let i = 0; i < source.length; i++) {
    hash ^= source.charCodeAt(i);
    // hash *= 0x01000193 (FNV prime), modulo 2^32 via Math.imul.
    hash = Math.imul(hash, 0x01000193);
  }
  // Force unsigned 32-bit.
  return (hash >>> 0).toString(16).padStart(8, "0");
}

// ─── Snapshot construction ─────────────────────────────────────────────────

/**
 * Build an {@link IdentitySnapshot} from a live {@link IdentityMap} and the
 * source text it was built against. The snapshot excludes staging entries
 * (cut awaiting paste) because those are transient per-session state.
 */
export function buildIdentitySnapshot(
  map: IdentityMap,
  source: string,
): IdentitySnapshot {
  const entries: Array<{
    id: StateId;
    kind: StatefulFormKind;
    formKey: FormKey;
  }> = [];
  for (const [canonicalKey, entry] of map.entries) {
    // Skip staging entries (cut awaiting paste). Their canonical keys
    // start with "fk:-1/"; the staging entries are session-scoped.
    if (canonicalKey.startsWith("fk:-1/")) continue;
    const formKey = decodeFormKeyFromCanonical(canonicalKey);
    entries.push({
      id: entry.id,
      kind: entry.kind,
      formKey,
    });
  }
  return {
    schemaVersion: IDENTITY_SNAPSHOT_SCHEMA_VERSION,
    documentFingerprint: computeDocumentFingerprint(source),
    entries,
  };
}

/**
 * Decode a canonical FormKey string back to its array form.
 *
 * The canonical form is `"fk:" + indices.join("/")`. This helper is the
 * inverse of {@link formKeyToString} and is used when serialising a
 * snapshot from a stored map.
 */
function decodeFormKeyFromCanonical(canonical: string): FormKey {
  if (!canonical.startsWith("fk:")) return [];
  const body = canonical.slice(3);
  if (body === "") return [];
  return body.split("/").map((n) => Number.parseInt(n, 10));
}

// ─── Safe loading from a raw persisted value ───────────────────────────────

/** Sentinel returned by {@link safeLoadIdentitySnapshot} when validation fails. */
export type SafeSnapshot = IdentitySnapshot | null;

/**
 * Validate a raw persisted value and return a typed
 * {@link IdentitySnapshot}, or `null` if the payload is missing, malformed,
 * has an unsupported schemaVersion, or contains no usable entries.
 *
 * Validation rules (VAL-ID-011):
 *   - must be a non-null object;
 *   - `schemaVersion` must equal {@link IDENTITY_SNAPSHOT_SCHEMA_VERSION};
 *   - `documentFingerprint` must be a non-empty string;
 *   - `entries` must be an array; each entry must have a string id, string
 *     kind, and array of non-negative integers formKey;
 *   - malformed entries are dropped silently; if all are dropped, the
 *     whole snapshot is rejected;
 *   - duplicate ids within the entries list are de-duplicated (the first
 *     occurrence wins) so that recovery never attaches one id to multiple
 *     forms.
 *
 * Never throws.
 */
export function safeLoadIdentitySnapshot(raw: unknown): SafeSnapshot {
  if (raw === null || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  if (obj.schemaVersion !== IDENTITY_SNAPSHOT_SCHEMA_VERSION) return null;
  if (typeof obj.documentFingerprint !== "string" || obj.documentFingerprint.length === 0) {
    return null;
  }
  if (!Array.isArray(obj.entries)) return null;

  const seenIds = new Set<string>();
  const cleanEntries: Array<{
    id: StateId;
    kind: StatefulFormKind;
    formKey: FormKey;
  }> = [];
  for (const candidate of obj.entries) {
    if (candidate === null || typeof candidate !== "object") continue;
    const c = candidate as Record<string, unknown>;
    if (typeof c.id !== "string" || c.id.length === 0) continue;
    if (typeof c.kind !== "string" || c.kind.length === 0) continue;
    if (!Array.isArray(c.formKey)) continue;
    let formKeyOk = true;
    const formKey: number[] = [];
    for (const n of c.formKey) {
      if (typeof n !== "number" || !Number.isInteger(n) || n < 0) {
        formKeyOk = false;
        break;
      }
      formKey.push(n);
    }
    if (!formKeyOk) continue;
    if (seenIds.has(c.id)) continue; // de-duplicate
    seenIds.add(c.id);
    cleanEntries.push({
      id: c.id as StateId,
      kind: c.kind as StatefulFormKind,
      formKey,
    });
  }

  if (cleanEntries.length === 0) return null;
  return {
    schemaVersion: IDENTITY_SNAPSHOT_SCHEMA_VERSION,
    documentFingerprint: obj.documentFingerprint,
    entries: cleanEntries,
  };
}

// ─── Recovery ──────────────────────────────────────────────────────────────

export interface RecoveryResult {
  /** The recovered identity map. Empty when nothing could be safely correlated. */
  readonly map: IdentityMap;
  /** Number of snapshot entries that were restored. */
  readonly restoredCount: number;
  /** Number of snapshot entries that were dropped (no matching form). */
  readonly droppedCount: number;
}

/**
 * Recover an {@link IdentityMap} from a stored snapshot against the current
 * editor state.
 *
 * **Correlation model.** The snapshot's `documentFingerprint` must exactly
 * equal the fingerprint of the current source text. When it does, every
 * snapshot entry whose `formKey` matches a currently-recognised stateful
 * form's FormKey is restored with its original id and kind. Entries whose
 * formKey no longer corresponds to a recognised form are dropped (conservative
 * partial recovery per VAL-ID-012).
 *
 * When the fingerprint does NOT match — wrong document, stale session,
 * truncated source — recovery returns an empty map (VAL-ID-011). We never
 * attach stored ids to fresh forms when the documents differ, because the
 * structural meaning of a formKey is only stable within one document.
 *
 * **Collision safety (Bug 15513d48).** Recovery enforces a one-to-one
 * FormKey/StateId invariant:
 *   - Only one id may attach to any form. If the snapshot contains two
 *     entries mapping to the same formKey, the first one wins.
 *   - Each recognised form can receive at most one restored id per
 *     recovery pass; the recovered map is built one entry at a time and
 *     every insertion goes through the central `withEntry` helper that
 *     rejects duplicate StateIds and clears stale byId aliases.
 *
 * **Real current ranges.** Each restored entry is installed with the
 * recognised form's current `[from, to]` range, NOT a placeholder. This
 * is what lets the editor's `create()` use the recovered map as the
 * reconciler's prior and have the range-continuity matching preserve
 * the restored ids (rather than forking fresh ids because the placeholder
 * ranges did not overlap any recognised form).
 *
 * @param snapshot Validated snapshot (use {@link safeLoadIdentitySnapshot}
 *                 to validate raw input first).
 * @param state    Current CodeMirror EditorState.
 * @param classifier Stateful-form classifier (default: synth-only).
 * @param ids      Optional ID generator (unused on the restore path, but
 *                 accepted so this function fits naturally into the
 *                 extension's create-time flow).
 * @param continuity Optional continuity source (unused on restore path).
 */
export function recoverIdentityMap(
  snapshot: IdentitySnapshot,
  state: EditorState,
  classifier: StatefulFormClassifier,
  ids?: IdGenerator,
  continuity?: ContinuitySource,
): RecoveryResult {
  void ids;
  void continuity;

  const currentSource = state.doc.toString();
  const currentFingerprint = computeDocumentFingerprint(currentSource);

  // Strict document correlation. Different document → no restoration.
  if (snapshot.documentFingerprint !== currentFingerprint) {
    return { map: emptyIdentityMap, restoredCount: 0, droppedCount: snapshot.entries.length };
  }

  // Index the recognised forms by canonical key so we can install each
  // restored entry with the recognised form's CURRENT range.
  const recognised = recogniseStatefulForms(state, classifier);
  const recognisedByKey = new Map<
    string,
    { kind: StatefulFormKind; formKey: FormKey; range: { from: number; to: number } }
  >();
  for (const r of recognised) {
    const ckey = formKeyToString(r.formKey);
    // Only the first recognised form at a given key is used; duplicates
    // cannot occur because formKeys are unique per parse.
    if (!recognisedByKey.has(ckey)) {
      recognisedByKey.set(ckey, {
        kind: r.kind,
        formKey: r.formKey,
        range: { from: r.range.from, to: r.range.to },
      });
    }
  }

  const usedIds = new Set<StateId>();
  const usedCanonicalKeys = new Set<string>();
  let restoredCount = 0;
  let droppedCount = 0;
  let map: IdentityMap = emptyIdentityMap;
  // Local continuity source so restored entries have stable tokens even
  // when the caller did not pass one.
  const localContinuity = makeContinuitySource(0);

  for (const entry of snapshot.entries) {
    const ckey = formKeyToString(entry.formKey);
    const target = recognisedByKey.get(ckey);
    if (target === undefined) {
      // formKey no longer points at a recognised form in this document.
      droppedCount++;
      continue;
    }
    // Collision safety: never attach the same id twice.
    if (usedIds.has(entry.id)) {
      droppedCount++;
      continue;
    }
    // Collision safety: never attach two ids to the same form. The first
    // entry targeting a form wins; subsequent entries are dropped.
    if (usedCanonicalKeys.has(ckey)) {
      droppedCount++;
      continue;
    }
    usedIds.add(entry.id);
    usedCanonicalKeys.add(ckey);
    // Install the restored entry with the recognised form's CURRENT range
    // (Bug 15513d48): the prior path used a {0, 0} placeholder, which
    // caused the editor's create() reconciler to fork fresh ids because
    // the placeholder did not overlap any recognised form's range.
    map = mergeRestoredEntry(
      map,
      target.formKey,
      target.range,
      entry.id,
      target.kind,
      localContinuity,
    );
    restoredCount++;
  }

  return { map, restoredCount, droppedCount };
}

/**
 * Internal: insert a restored entry into the map with a specific id,
 * kind, and range, minting a fresh continuity token from the supplied
 * source.
 *
 * This bypasses the public forkEntry (which mints a new id) because
 * recovery needs to install a *known* id from the snapshot. The range
 * passed in is the recognised form's current range so that downstream
 * range-continuity matching in the editor's create() preserves the
 * restored id rather than forking.
 */
function mergeRestoredEntry(
  map: IdentityMap,
  formKey: FormKey,
  range: { from: number; to: number },
  id: StateId,
  kind: StatefulFormKind,
  continuity: ContinuitySource,
): IdentityMap {
  // forkEntry mints a fresh id via its generator. We supply a single-use
  // generator that emits the restored id exactly once; withEntry then
  // installs the entry. After forkEntry returns we still need to
  // overwrite the freshly-minted id with the restored id. We do this
  // with a direct map rebuild that:
  //   1. Clears the byId alias of the freshly-minted id.
  //   2. If an entry already occupied this FormKey, also clears that
  //      entry's id alias (defensive — forkEntry normally inserts at a
  //      fresh key during recovery).
  //   3. Sets entries[ckey] to an entry whose id is the restored id and
  //      whose range is the recognised form's range.
  const intermediate = forkEntry(
    map,
    formKey,
    kind,
    range,
    singleUseIdGenerator(id),
    continuity,
  );
  const ckey = formKeyToString(formKey);
  const entries = new Map(intermediate.entries);
  const byId = new Map(intermediate.byId);
  const existing = entries.get(ckey);
  if (existing !== undefined && existing.id !== id) {
    // Clear the alias of whatever id was just minted/installed.
    byId.delete(existing.id);
    const fixed: IdentityEntry = { ...existing, id, range };
    entries.set(ckey, fixed);
    byId.set(id, ckey);
  } else if (existing !== undefined && existing.id === id) {
    // forkEntry already installed the right id (e.g. the single-use
    // generator returned the restored id and there was no prior entry
    // at this key). Just refresh the range to the recognised range in
    // case forkEntry stored a different one.
    const fixed: IdentityEntry = { ...existing, range };
    entries.set(ckey, fixed);
  }
  return { entries, byId };
}

/** ID generator that emits `only` once. Used by mergeRestoredEntry. */
function singleUseIdGenerator(only: StateId): IdGenerator {
  let emitted = false;
  return {
    next(): StateId {
      if (emitted) {
        throw new Error(
          "identitySnapshot: singleUseIdGenerator called more than once",
        );
      }
      emitted = true;
      return only;
    },
  };
}
