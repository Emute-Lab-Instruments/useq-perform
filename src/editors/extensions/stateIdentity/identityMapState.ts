/**
 * Pure helpers for the immutable {@link IdentityMap}.
 *
 * Every helper returns a new map; nothing mutates inputs. The module also
 * owns the {@link ContinuitySource} — a small integer source that hands out
 * unique continuity tokens so that exact-equality comparisons in undo/redo
 * do not depend on range or text.
 *
 * Remap helpers translate ranges through CodeMirror `ChangeDesc`-shaped
 * objects. We do not import `@codemirror/state` here (keeping the core
 * dependency-light); we accept the minimal `mapPos`-shaped interface.
 */

import type {
  FormKey,
  IdentityEntry,
  IdentityMap,
  IdentityRange,
  StateId,
} from "./identityTypes.ts";
import { emptyIdentityMap, formKeyFromString, formKeyToString } from "./identityTypes.ts";
import type { IdGenerator } from "./identityGenerator.ts";

// ─── Minimal ChangeDesc-shaped interface ───────────────────────────────────

/**
 * Anything with a `mapPos(pos, assoc)` method, compatible with CodeMirror's
 * `ChangeDesc`/`ChangeSet`. Importing this narrow shape keeps the core free
 * of CodeMirror imports so the helpers are unit-testable in isolation.
 */
export interface MapPosLike {
  mapPos(pos: number, assoc: -1 | 0 | 1): number;
}

// ─── Continuity tokens ─────────────────────────────────────────────────────

/** A monotonic source of unique continuity tokens. */
export interface ContinuitySource {
  next(): number;
}

export function makeContinuitySource(start = 0): ContinuitySource {
  let n = start;
  return {
    next() {
      n += 1;
      return n;
    },
  };
}

// ─── Internals ─────────────────────────────────────────────────────────────

function withEntry(
  map: IdentityMap,
  key: FormKey,
  entry: IdentityEntry,
): IdentityMap {
  const ckey = formKeyToString(key);
  if (map.byId.has(entry.id)) {
    // Collision: refuse to insert a duplicate ID. Caller bug.
    throw new Error(
      `identityMap: duplicate StateId ${entry.id} (invariant violated)`,
    );
  }
  const entries = new Map(map.entries);
  entries.set(ckey, entry);
  const byId = new Map(map.byId);
  byId.set(entry.id, ckey);
  return { entries, byId };
}

function withoutKey(map: IdentityMap, key: FormKey): IdentityMap {
  const ckey = formKeyToString(key);
  if (!map.entries.has(ckey)) return map;
  const entries = new Map(map.entries);
  const byId = new Map(map.byId);
  const old = entries.get(ckey);
  entries.delete(ckey);
  if (old) byId.delete(old.id);
  return { entries, byId };
}

// ─── Public helpers ────────────────────────────────────────────────────────

/** Build a fresh map containing only the supplied entries. */
export function mapFromEntries(
  pairs: ReadonlyArray<readonly [FormKey, IdentityEntry]>,
): IdentityMap {
  let m: IdentityMap = emptyIdentityMap;
  for (const [k, e] of pairs) m = withEntry(m, k, e);
  return m;
}

/** Look up an entry by structural key. */
export function getByKey(map: IdentityMap, key: FormKey): IdentityEntry | undefined {
  return map.entries.get(formKeyToString(key));
}

/** Look up an entry by StateId. Returns the entry; use lookupKeyById for the key. */
export function getById(map: IdentityMap, id: StateId): IdentityEntry | undefined {
  const ckey = map.byId.get(id);
  if (ckey === undefined) return undefined;
  return map.entries.get(ckey);
}

/** All entries as a flat array (no ordering guarantees). */
export function entriesOf(map: IdentityMap): ReadonlyArray<IdentityEntry> {
  return Array.from(map.entries.values());
}

/** Mint a brand-new entry at a structural key. Always forks. */
export function forkEntry(
  map: IdentityMap,
  key: FormKey,
  kind: IdentityEntry["kind"],
  range: IdentityRange,
  ids: IdGenerator,
  continuity: ContinuitySource,
  pendingPasteToken?: string,
): IdentityMap {
  const id = ids.next();
  const entry: IdentityEntry = {
    id,
    kind,
    range,
    continuityToken: continuity.next(),
    pendingPasteToken,
  };
  return withEntry(map, key, entry);
}

/** Re-attach an existing entry to a new structural key (move semantics). */
export function moveEntry(
  map: IdentityMap,
  oldKey: FormKey,
  newKey: FormKey,
  newRange: IdentityRange,
): IdentityMap {
  const oldCkey = formKeyToString(oldKey);
  const newCkey = formKeyToString(newKey);
  const entry = map.entries.get(oldCkey);
  if (!entry) return map;
  if (oldCkey === newCkey) {
    // Same key, just refresh the range.
    const refreshed: IdentityEntry = { ...entry, range: newRange };
    const entries = new Map(map.entries);
    entries.set(newCkey, refreshed);
    return { entries, byId: map.byId };
  }
  const entries = new Map(map.entries);
  const byId = new Map(map.byId);
  entries.delete(oldCkey);
  entries.set(newCkey, { ...entry, range: newRange });
  byId.set(entry.id, newCkey);
  return { entries, byId };
}

/** Remove an entry (e.g. when the form was deleted without undo). */
export function removeEntry(map: IdentityMap, key: FormKey): IdentityMap {
  return withoutKey(map, key);
}

/** Remap every entry's range through a CodeMirror-style ChangeDesc. */
export function remapRanges(
  map: IdentityMap,
  changes: MapPosLike,
): IdentityMap {
  let changed = false;
  const entries = new Map(map.entries);
  for (const [ckey, entry] of entries) {
    const from = changes.mapPos(entry.range.from, 1);
    const to = changes.mapPos(entry.range.to, -1);
    if (from !== entry.range.from || to !== entry.range.to) {
      changed = true;
      entries.set(ckey, { ...entry, range: { from, to } });
    }
  }
  return changed ? { entries, byId: map.byId } : map;
}

/**
 * Deep structural equality on entries, used by undo/redo exact-equality.
 * Compares `id`, `kind`, `continuityToken`, and `pendingPasteToken` —
 * **not** range (ranges move) and **not** source text.
 */
export function entriesEqualIdentity(
  a: IdentityEntry,
  b: IdentityEntry,
): boolean {
  return (
    a.id === b.id &&
    a.kind === b.kind &&
    a.continuityToken === b.continuityToken &&
    a.pendingPasteToken === b.pendingPasteToken
  );
}

/**
 * Two maps are identity-equal iff every (key → entry) pair is identical and
 * the keys match — used to prove undo restores the exact prior mapping and
 * redo restores the exact post-edit mapping.
 */
export function mapsEqualByIdentity(
  a: IdentityMap,
  b: IdentityMap,
): boolean {
  if (a.entries.size !== b.entries.size) return false;
  for (const [key, entry] of a.entries) {
    const other = b.entries.get(key);
    if (!other || !entriesEqualIdentity(entry, other)) return false;
  }
  return true;
}

/**
 * Fork every entry of `source` into `target`, minting fresh IDs and tokens.
 * Used by the duplicate/copy path so the duplicate gets new identity while
 * the original retains its identity.
 */
export function forkAllEntries(
  source: IdentityMap,
  target: IdentityMap,
  ids: IdGenerator,
  continuity: ContinuitySource,
  keyTransform: (key: FormKey) => FormKey,
): IdentityMap {
  let out = target;
  for (const [canonicalKey, entry] of source.entries) {
    const oldKey = formKeyFromString(canonicalKey);
    const newKey = keyTransform(oldKey);
    out = forkEntry(
      out,
      newKey,
      entry.kind,
      // Range is filled in by the reconciler after the fork — placeholder.
      entry.range,
      ids,
      continuity,
    );
  }
  return out;
}
