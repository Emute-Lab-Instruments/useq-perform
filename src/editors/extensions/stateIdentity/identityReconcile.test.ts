/**
 * Pure reconciler tests — no CodeMirror, no DOM.
 *
 * These tests exercise the pure `reconcileIdentity` and map helpers in
 * isolation so the preserve/fork/move/drop semantics are verifiable
 * without dragging in EditorView. The CodeMirror-integration behaviours
 * are covered by `stateIdentity.test.ts`.
 */

import { describe, expect, it } from "vitest";

import {
  deterministicIdGenerator,
} from "./identityGenerator.ts";
import {
  emptyIdentityMap,
  type IdentityMap,
  type RecognisedForm,
} from "./identityTypes.ts";
import {
  entriesOf,
  forkEntry,
  makeContinuitySource,
  mapsEqualByIdentity,
} from "./identityMapState.ts";
import {
  reconcileIdentity,
  stagingKeyFor,
  isStagingKey,
  isCanonicalStagingKey,
  stampCutToken,
  emptySignals,
} from "./identityReconcile.ts";

/** Identity-mapping ChangeSet stand-in for the pure reconciler tests. */
const ID_MAPPER = { mapPos: (p: number) => p };

function newContinuity() {
  return makeContinuitySource(0);
}

function synth(at: number, key: readonly number[]): RecognisedForm {
  const text = `(synth "osc/sine" :freq ${at})`;
  return {
    formKey: key,
    kind: "synth",
    range: { from: at, to: at + text.length },
  };
}

describe("reconcileIdentity: VAL-ID-001 fork on empty prior", () => {
  it("forks a fresh ID for every recognised form when prior is empty", () => {
    const ids = deterministicIdGenerator();
    const result = reconcileIdentity(
      emptyIdentityMap,
      [synth(0, [0]), synth(40, [1])],
      emptySignals,
      ID_MAPPER,
      ids,
      newContinuity(),
    );
    expect(entriesOf(result.map)).toHaveLength(2);
    expect(result.debug.forked).toHaveLength(2);
    expect(result.debug.preserved).toHaveLength(0);
  });
});

describe("reconcileIdentity: VAL-ID-003 preserve on FormKey match", () => {
  it("preserves identity when the same FormKey is recognised again", () => {
    const ids = deterministicIdGenerator();
    const cont = newContinuity();
    const r1 = reconcileIdentity(emptyIdentityMap, [synth(0, [0])], emptySignals, ID_MAPPER, ids, cont);
    const firstId = entriesOf(r1.map)[0]!.id;

    // Second pass: same key, different range (user edited).
    const r2 = reconcileIdentity(r1.map, [synth(0, [0])], emptySignals, ID_MAPPER, ids, cont);
    expect(entriesOf(r2.map)[0]!.id).toBe(firstId);
    expect(resultPreserved(r2)).toContain(firstId);
    expect(mapsEqualByIdentity(r1.map, r2.map)).toBe(true);
  });
});

describe("reconcileIdentity: VAL-ID-007 fork on new FormKey", () => {
  it("forks when a new FormKey appears alongside an existing one", () => {
    const ids = deterministicIdGenerator();
    const cont = newContinuity();
    const r1 = reconcileIdentity(emptyIdentityMap, [synth(0, [0])], emptySignals, ID_MAPPER, ids, cont);
    const firstId = entriesOf(r1.map)[0]!.id;

    const r2 = reconcileIdentity(
      r1.map,
      [synth(0, [0]), synth(40, [1])],
      emptySignals,
      ID_MAPPER,
      ids,
      cont,
    );
    const entries = entriesOf(r2.map);
    expect(entries).toHaveLength(2);
    const idsList = entries.map((e) => e.id);
    expect(idsList).toContain(firstId);
    expect(new Set(idsList).size).toBe(2);
  });
});

describe("reconcileIdentity: VAL-ID-023 drop on disappearing key without paste token", () => {
  it("drops an entry whose FormKey disappears without a cut stamp", () => {
    const ids = deterministicIdGenerator();
    const cont = newContinuity();
    const r1 = reconcileIdentity(emptyIdentityMap, [synth(0, [0])], emptySignals, ID_MAPPER, ids, cont);
    const firstId = entriesOf(r1.map)[0]!.id;

    // New parse with no forms.
    const r2 = reconcileIdentity(r1.map, [], emptySignals, ID_MAPPER, ids, cont);
    expect(entriesOf(r2.map)).toHaveLength(0);
    expect(resultDropped(r2)).toContain(firstId);
  });

  it("stashes an entry whose FormKey disappears with a pending paste token", () => {
    const ids = deterministicIdGenerator();
    const cont = newContinuity();
    const r1 = reconcileIdentity(emptyIdentityMap, [synth(0, [0])], emptySignals, ID_MAPPER, ids, cont);
    const firstId = entriesOf(r1.map)[0]!.id;

    // Stamp a cut token.
    const stamped = stampCutToken(r1.map, [0], "tok-1");

    // New parse: form gone.
    const r2 = reconcileIdentity(stamped, [], emptySignals, ID_MAPPER, ids, cont);
    const entries = entriesOf(r2.map);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.id).toBe(firstId);
    expect(entries[0]!.pendingPasteToken).toBe("tok-1");
    // The entry's key is now a staging key.
    for (const canonicalKey of r2.map.byId.values()) {
      expect(isCanonicalStagingKey(canonicalKey)).toBe(true);
    }
  });
});

describe("reconcileIdentity: VAL-ID-006 move via recognised paste token", () => {
  it("restores identity at the new FormKey when a recognised move consumes the staging entry", () => {
    const ids = deterministicIdGenerator();
    const cont = newContinuity();
    const r1 = reconcileIdentity(emptyIdentityMap, [synth(0, [0])], emptySignals, ID_MAPPER, ids, cont);
    const originalId = entriesOf(r1.map)[0]!.id;

    // Cut: stamp then disappear.
    const stamped = stampCutToken(r1.map, [0], "tok-1");
    const r2 = reconcileIdentity(stamped, [], emptySignals, ID_MAPPER, ids, cont);

    // Paste at a new position with a declared move.
    const r3 = reconcileIdentity(
      r2.map,
      [synth(100, [5])],
      {
        recognisedMoves: [
          { pasteToken: "tok-1", fromOldKey: [0], toNewKey: [5] },
        ],
      },
      ID_MAPPER,
      ids,
      cont,
    );
    const entries = entriesOf(r3.map);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.id).toBe(originalId);
    expect(entries[0]!.pendingPasteToken).toBeUndefined();
    expect(entries[0]!.range.from).toBe(100);
  });

  it("move in the same transaction as the cut is also honoured (live cut entry)", () => {
    const ids = deterministicIdGenerator();
    const cont = newContinuity();
    const r1 = reconcileIdentity(emptyIdentityMap, [synth(0, [0])], emptySignals, ID_MAPPER, ids, cont);
    const originalId = entriesOf(r1.map)[0]!.id;

    // Stamp then immediately relocate, all in one reconcile.
    const stamped = stampCutToken(r1.map, [0], "tok-2");
    const r2 = reconcileIdentity(
      stamped,
      [synth(50, [3])],
      {
        recognisedMoves: [
          { pasteToken: "tok-2", fromOldKey: [0], toNewKey: [3] },
        ],
      },
      ID_MAPPER,
      ids,
      cont,
    );
    const entries = entriesOf(r2.map);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.id).toBe(originalId);
    expect(entries[0]!.range.from).toBe(50);
  });
});

describe("reconcileIdentity: fork + ID collision safety", () => {
  it("entries remain unique by StateId after a series of forks", () => {
    const ids = deterministicIdGenerator();
    const cont = newContinuity();
    let map: IdentityMap = emptyIdentityMap;
    // Fork several forms.
    for (let i = 0; i < 5; i++) {
      map = forkEntry(map, [i], "synth", { from: i * 10, to: i * 10 + 5 }, ids, cont);
    }
    const idSet = new Set(entriesOf(map).map((e) => e.id));
    expect(idSet.size).toBe(5);
  });
});

describe("staging key", () => {
  it("is uniquely addressable per paste token and never collides with real keys", () => {
    const k1 = stagingKeyFor("tok-A");
    const k2 = stagingKeyFor("tok-B");
    expect(isStagingKey(k1)).toBe(true);
    expect(isStagingKey(k2)).toBe(true);
    expect(k1).not.toEqual(k2);
    // Real keys start with a non-negative index; staging keys start with -1.
    expect(isStagingKey([0])).toBe(false);
  });
});

// ─── Helpers ───────────────────────────────────────────────────────────────

function resultPreserved(r: { debug: { preserved: ReadonlyArray<string> } }):
  ReadonlyArray<string> {
  return r.debug.preserved;
}
function resultDropped(r: { debug: { dropped: ReadonlyArray<string> } }):
  ReadonlyArray<string> {
  return r.debug.dropped;
}
