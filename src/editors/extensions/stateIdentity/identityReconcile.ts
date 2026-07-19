/**
 * Reconciler — pure function that takes the prior identity map plus the
 * freshly-classified forms from a new parse and produces the next map.
 *
 * Spec: docs/specs/state-identity.md §3, §7.2, §8.2–8.6, §13.3.
 *
 * **Reconciliation model.** Identity is keyed by *content continuity*
 * tracked through the document ChangeSet, not by structural FormKey alone.
 * The rules in priority order are:
 *
 * 1. **Recognised move** (declareMoveEffect matching a stashed cut) →
 *    preserve identity, attach to the new FormKey, clear the paste token.
 *    This is the cut-then-paste path (§8.3) that the editor's clipboard
 *    handler explicitly declares.
 *
 * 2. **Range continuity** (a prior entry's range maps through the ChangeSet
 *    onto a recognised form's range) → preserve identity. This is the
 *    common case: typing inside or around a form, reformatting, structural
 *    edits that don't destroy the form, and moves where the form's text
 *    shifts position but stays in the document.
 *
 * 3. **New recognised form with no continuity** → fork identity. Covers
 *    duplication, copy-paste, and independent recreation (§8.5, §8.6,
 *    VAL-ID-023).
 *
 * 4. **Prior entry with no continuity** →
 *    - If it has a `pendingPasteToken` (cut awaiting paste), stage it
 *      under a synthetic staging key so a later paste can restore it.
 *    - Otherwise: drop. History-driven undo will restore it via the
 *      StateField's transaction replay (VAL-ID-008).
 *
 * Reconciliation never inspects source text. Identity decisions are based
 * on FormKey, ChangeSet-style position tracking, and the explicit
 * pendingPasteToken. This is what makes identity stable under "same
 * logical form, different text" and forked under "same text, different
 * logical form" (VAL-ID-022).
 *
 * **Key canonicalisation**: the IdentityMap stores entries keyed by the
 * canonical string form of a FormKey (see `formKeyToString`). FormKeys
 * themselves are arrays and compare by reference in JS, so every lookup
 * must go through the canonical string.
 */

import type {
  FormKey,
  IdentityEntry,
  IdentityMap,
  IdentityRange,
  RecognisedForm,
  StateId,
} from "./identityTypes.ts";
import { formKeyToString } from "./identityTypes.ts";
import type { IdGenerator } from "./identityGenerator.ts";
import {
  forkEntry,
  makeContinuitySource,
  type ContinuitySource,
  type MapPosLike,
} from "./identityMapState.ts";

/**
 * Carries extra signals the reconciler uses to distinguish moves from
 * copies. Produced by the StateField's transaction handler from
 * CodeMirror transaction annotations / clipboard provenance.
 */
export interface ReconcileSignals {
  /**
   * Recognised moves: each carries the paste token of a prior cut and the
   * new FormKey the paste landed at. When present, that new FormKey
   * inherits the cut entry's identity (move semantics) instead of forking.
   */
  readonly recognisedMoves: ReadonlyArray<{
    readonly pasteToken: string;
    readonly fromOldKey: FormKey;
    readonly toNewKey: FormKey;
  }>;
}

export const emptySignals: ReconcileSignals = { recognisedMoves: [] };

// ─── Public API ────────────────────────────────────────────────────────────

export interface ReconcileResult {
  readonly map: IdentityMap;
  /**
   * Diagnostics about what happened during reconciliation. Used by tests;
   * not surfaced to the user.
   */
  readonly debug: {
    readonly preserved: ReadonlyArray<StateId>;
    readonly forked: ReadonlyArray<StateId>;
    readonly moved: ReadonlyArray<StateId>;
    readonly dropped: ReadonlyArray<StateId>;
  };
}

/** Result of remapping a prior entry's range through a ChangeSet. */
interface MappedPrior {
  readonly ckey: string;
  readonly entry: IdentityEntry;
  /** Range after mapping through the ChangeSet; null means the range was deleted. */
  readonly mappedRange: IdentityRange | null;
}

/**
 * Reconcile a prior map against a freshly-classified parse.
 *
 * @param prior The previous identity map.
 * @param recognised Forms recognised in the new parse.
 * @param signals Move declarations from the transaction's effects.
 * @param changes CodeMirror-style ChangeSet/ChangeDesc used to track
 *                position continuity. Pass an identity-mapping object
 *                (`mapPos: (p) => p`) when there is no document change.
 * @param ids ID generator for forks.
 * @param continuity Continuity token source.
 */
export function reconcileIdentity(
  prior: IdentityMap,
  recognised: ReadonlyArray<RecognisedForm>,
  signals: ReconcileSignals,
  changes: MapPosLike,
  ids: IdGenerator,
  continuity: ContinuitySource,
): ReconcileResult {
  const preserved: StateId[] = [];
  const forked: StateId[] = [];
  const moved: StateId[] = [];
  const dropped: StateId[] = [];

  // Set of canonical FormKeys the new parse recognises.
  const recognisedCanonical = recognised.map((r) => ({
    form: r,
    ckey: formKeyToString(r.formKey),
  }));
  const newCanonicalKeys = new Set(recognisedCanonical.map((r) => r.ckey));

  // Map prior entries' ranges through the ChangeSet. This tells us where
  // each prior form's text went, if anywhere.
  const mappedPrior: MappedPrior[] = [];
  const stagingByToken = new Map<string, { ckey: string; entry: IdentityEntry }>();
  for (const [ckey, entry] of prior.entries) {
    if (isCanonicalStagingKey(ckey)) {
      if (entry.pendingPasteToken !== undefined) {
        stagingByToken.set(entry.pendingPasteToken, { ckey, entry });
      }
      continue;
    }
    const from = changes.mapPos(entry.range.from, 1);
    const to = changes.mapPos(entry.range.to, -1);
    // If the range collapsed to empty (text fully deleted), this prior
    // form has no continuity in the new doc.
    const mappedRange = to > from ? { from, to } : null;
    mappedPrior.push({ ckey, entry, mappedRange });
  }

  // Result under construction.
  const outEntries = new Map<string, IdentityEntry>();
  const outById = new Map<StateId, string>();

  // Track prior entries already consumed (by move or by continuity match).
  const consumedPriorCkeys = new Set<string>();
  // Track staging tokens already consumed by a move.
  const consumedStagingTokens = new Set<string>();

  // 1. Process recognised moves. Find the cut entry by paste token (either
  //    live or in staging). Re-attach at the new FormKey.
  for (const move of signals.recognisedMoves) {
    const fromCkey = formKeyToString(move.fromOldKey);
    const liveEntry = prior.entries.get(fromCkey);
    const stagedCut = stagingByToken.get(move.pasteToken);

    const sourceEntry =
      (liveEntry && liveEntry.pendingPasteToken === move.pasteToken)
        ? { ckey: fromCkey, entry: liveEntry }
        : stagedCut
          ? { ckey: stagedCut.ckey, entry: stagedCut.entry }
          : null;
    if (!sourceEntry) continue;

    const target = recognisedCanonical.find((r) => r.ckey === formKeyToString(move.toNewKey));
    if (!target) continue;

    const restored: IdentityEntry = {
      id: sourceEntry.entry.id,
      kind: sourceEntry.entry.kind,
      range: target.form.range,
      continuityToken: sourceEntry.entry.continuityToken,
      pendingPasteToken: undefined,
    };
    const toCkey = target.ckey;
    outEntries.set(toCkey, restored);
    outById.set(sourceEntry.entry.id, toCkey);

    moved.push(sourceEntry.entry.id);
    consumedStagingTokens.add(move.pasteToken);
    consumedPriorCkeys.add(sourceEntry.ckey);
  }

  // 2. Walk recognised forms and try to find a continuity match in prior.
  for (const { form, ckey } of recognisedCanonical) {
    // Skip if already handled as a move target.
    if (outEntries.has(ckey)) continue;

    // Find the prior entry whose mapped range best overlaps this form.
    let bestMatch: MappedPrior | null = null;
    let bestOverlap = 0;
    for (const mp of mappedPrior) {
      if (consumedPriorCkeys.has(mp.ckey)) continue;
      if (!mp.mappedRange) continue;
      const overlap = overlapSize(mp.mappedRange, form.range);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestMatch = mp;
      }
    }

    if (bestMatch !== null && bestOverlap > 0) {
      // Preserve identity; refresh the range.
      const refreshed: IdentityEntry = {
        id: bestMatch.entry.id,
        kind: form.kind,
        range: form.range,
        continuityToken: bestMatch.entry.continuityToken,
        pendingPasteToken: bestMatch.entry.pendingPasteToken,
      };
      outEntries.set(ckey, refreshed);
      outById.set(bestMatch.entry.id, ckey);
      consumedPriorCkeys.add(bestMatch.ckey);
      preserved.push(bestMatch.entry.id);
      continue;
    }

    // New FormKey with no recognised move or continuity: fork identity.
    const tmp: IdentityMap = { entries: outEntries, byId: outById };
    const nextMap = forkEntry(tmp, form.formKey, form.kind, form.range, ids, continuity);
    for (const [k, v] of nextMap.entries) outEntries.set(k, v);
    for (const [k, v] of nextMap.byId) outById.set(k, v);
    const newEntry = outEntries.get(ckey);
    if (newEntry) forked.push(newEntry.id);
  }

  // 3. Drop or stage disappeared prior entries.
  // Carry forward staging entries (cut awaiting paste).
  for (const [ckey, staged] of stagingByToken) {
    if (consumedStagingTokens.has(staged.entry.pendingPasteToken ?? "")) continue;
    outEntries.set(ckey, staged.entry);
    outById.set(staged.entry.id, ckey);
  }
  // Drop or stage non-staging prior entries.
  for (const mp of mappedPrior) {
    if (consumedPriorCkeys.has(mp.ckey)) continue;
    if (newCanonicalKeys.has(mp.ckey)) continue; // already preserved

    if (mp.entry.pendingPasteToken !== undefined) {
      const stageCkey = formKeyToString(stagingKeyFor(mp.entry.pendingPasteToken));
      outEntries.set(stageCkey, mp.entry);
      outById.set(mp.entry.id, stageCkey);
      continue;
    }

    dropped.push(mp.entry.id);
  }

  const map: IdentityMap = { entries: outEntries, byId: outById };
  return { map, debug: { preserved, forked, moved, dropped } };
}

/** Length of the overlap between two ranges, or 0 if no overlap. */
function overlapSize(a: IdentityRange, b: IdentityRange): number {
  const start = Math.max(a.from, b.from);
  const end = Math.min(a.to, b.to);
  return end > start ? end - start : 0;
}

/**
 * Stamp `pendingPasteToken` on an entry, returning a new map. The token
 * is what `recognisedMoves` in {@link ReconcileSignals} will match to
 * restore identity on paste.
 */
export function stampCutToken(
  map: IdentityMap,
  key: FormKey,
  pasteToken: string,
): IdentityMap {
  const ckey = formKeyToString(key);
  const entry = map.entries.get(ckey);
  if (!entry) return map;
  const updated: IdentityEntry = { ...entry, pendingPasteToken: pasteToken };
  return {
    entries: new Map(map.entries).set(ckey, updated),
    byId: map.byId,
  };
}

/**
 * Build a synthetic staging FormKey for a cut entry awaiting paste.
 *
 * The staging key cannot collide with any real FormKey because real
 * FormKeys are arrays of non-negative integers (child indices), while the
 * staging key contains a negative sentinel as its first element.
 */
export function stagingKeyFor(pasteToken: string): FormKey {
  // Use -1 as the sentinel; subsequent elements uniquely identify the
  // token so multiple concurrent cuts don't collide.
  return [-1, ...encodeToken(pasteToken)];
}

function encodeToken(token: string): number[] {
  // Hash the token string to a short, stable sequence of small integers.
  // We only need uniqueness, not cryptographic strength.
  const out: number[] = [];
  let acc = 0;
  for (let i = 0; i < token.length; i++) {
    acc = (acc * 31 + token.charCodeAt(i)) | 0;
    if (i % 4 === 3) {
      out.push(Math.abs(acc));
      acc = 0;
    }
  }
  if (acc !== 0 || out.length === 0) out.push(Math.abs(acc));
  return out;
}

/** Test whether a FormKey is a staging key (cut awaiting paste). */
export function isStagingKey(key: FormKey): boolean {
  return key.length > 0 && key[0] === -1;
}

/**
 * Test whether a canonical (string) FormKey is a staging key. Staging
 * keys' canonical form starts with `"fk:-1/"`.
 */
export function isCanonicalStagingKey(canonicalKey: string): boolean {
  return canonicalKey.startsWith("fk:-1/");
}

/** Convenience: create a fresh continuity source seeded at 0. */
export function newContinuity(): ContinuitySource {
  return makeContinuitySource(0);
}
