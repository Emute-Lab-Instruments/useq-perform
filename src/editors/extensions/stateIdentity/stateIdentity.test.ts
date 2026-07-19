/**
 * State-identity sidecar — core behaviour tests.
 *
 * Spec: docs/specs/state-identity.md (Phase 3). Assertion IDs covered:
 *   VAL-ID-001  Stateful forms receive hidden identities
 *   VAL-ID-002  Non-stateful forms receive no identity
 *   VAL-ID-003  Ordinary edits preserve logical identity
 *   VAL-ID-004  Formatting preserves identity
 *   VAL-ID-005  Structural edits preserve surviving forms
 *   VAL-ID-006  Moves (cut-then-paste) preserve identity
 *   VAL-ID-007  Copies / duplicates fork identity
 *   VAL-ID-008  Undo/redo restore exact identity (in-process round-trip)
 *   VAL-ID-023  Deletion and independent recreation fork identity
 *
 * Browser-surface and persistence-snapshot assertions are covered by
 * downstream features (persistence, eval payload); these tests exercise
 * the in-process core with a real CodeMirror EditorState.
 */

import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { history, undo, redo, isolateHistory } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { default_extensions as clojureExtensions } from "@nextjournal/clojure-mode";

import {
  buildIdentityField,
  identityExtensionsWithField,
  declareMoveEffect,
  markCutEffect,
  newPasteToken,
  type IdentityConfig,
} from "./identityField.ts";
import { makeContinuitySource, entriesOf, mapsEqualByIdentity } from "./identityMapState.ts";
import { defaultStatefulFormClassifier } from "./identityClassify.ts";
import { deterministicIdGenerator } from "./identityGenerator.ts";
import type { StateId } from "./identityTypes.ts";

// ─── Helpers ───────────────────────────────────────────────────────────────

interface Harness {
  view: EditorView;
  field: ReturnType<typeof buildIdentityField>;
}

function makeConfig(): IdentityConfig {
  return {
    ids: deterministicIdGenerator(),
    classifier: defaultStatefulFormClassifier,
    continuity: makeContinuitySource(0),
  };
}

/**
 * Build an editor view with the identity field installed. The view is a
 * real DOM-less CodeMirror EditorView — sufficient for transaction-driven
 * tests.
 */
function harness(doc: string, config: IdentityConfig = makeConfig()): Harness {
  const field = buildIdentityField(config);
  const view = new EditorView({
    doc,
    extensions: [...clojureExtensions, field],
  });
  return { view, field };
}

function currentMap(h: Harness) {
  return h.view.state.field(h.field).map;
}

/** Apply a change-and-effects transaction to the view. */
function dispatch(
  h: Harness,
  spec: Parameters<EditorView["dispatch"]>[0],
): void {
  h.view.dispatch(spec);
}

function docText(h: Harness): string {
  return h.view.state.doc.toString();
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("VAL-ID-001: stateful forms receive hidden identities", () => {
  it("assigns an opaque ID to an anonymous top-level synth form", () => {
    const h = harness('(synth "osc/sine" :freq 440)\n');
    const entries = entriesOf(currentMap(h));
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry.kind).toBe("synth");
    expect(entry.id).toMatch(/^id-/);
    // Visible source unchanged: no injected id in the doc.
    expect(docText(h)).toBe('(synth "osc/sine" :freq 440)\n');
    // Range covers the entire synth form.
    expect(entry.range.from).toBe(0);
    expect(entry.range.to).toBe('(synth "osc/sine" :freq 440)'.length);
  });

  it("mints distinct IDs across multiple stateful forms", () => {
    const h = harness(
      '(synth "osc/sine" :freq 100)\n(synth "osc/sine" :freq 200)\n',
    );
    const entries = entriesOf(currentMap(h));
    expect(entries).toHaveLength(2);
    const ids = entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(2);
  });
});

describe("VAL-ID-002: non-stateful forms receive no identity", () => {
  it("leaves a mixed document with only the synth form identified", () => {
    const doc = '(a1 (saw 1))\n(synth "osc/sine" :freq 440)\n(define foo 1)\n';
    const h = harness(doc);
    const entries = entriesOf(currentMap(h));
    expect(entries).toHaveLength(1);
    expect(entries[0]!.kind).toBe("synth");
    expect(entries[0]!.range.from).toBe(doc.indexOf("(synth"));
  });

  it("does not recognise a synth form nested inside another form", () => {
    const h = harness('(a1 (synth "osc/sine" :freq 440))');
    expect(entriesOf(currentMap(h))).toHaveLength(0);
  });

  it("does not recognise synth-like text in a string literal", () => {
    const h = harness('(a1 "synth is great")');
    expect(entriesOf(currentMap(h))).toHaveLength(0);
  });

  it("does not crash on an empty document", () => {
    const h = harness("");
    expect(entriesOf(currentMap(h))).toHaveLength(0);
  });

  it("does not crash on a malformed top-level list", () => {
    const h = harness("(synth");
    expect(entriesOf(currentMap(h))).toHaveLength(0);
  });
});

describe("VAL-ID-003: ordinary edits preserve logical identity", () => {
  it("preserves the ID when the user edits a parameter inside the form", () => {
    const h = harness('(synth "osc/sine" :freq 440)\n');
    const beforeId = entriesOf(currentMap(h))[0]!.id;
    const beforeMap = currentMap(h);

    const freqPos = docText(h).indexOf("440");
    dispatch(h, { changes: { from: freqPos, to: freqPos + 3, insert: "880" } });

    const afterId = entriesOf(currentMap(h))[0]!.id;
    expect(afterId).toBe(beforeId);
    expect(mapsEqualByIdentity(beforeMap, currentMap(h))).toBe(true);
    expect(docText(h)).toBe('(synth "osc/sine" :freq 880)\n');
  });

  it("preserves the ID when the user types above the form", () => {
    const h = harness('(synth "osc/sine" :freq 440)\n');
    const beforeId = entriesOf(currentMap(h))[0]!.id;
    dispatch(h, { changes: { from: 0, insert: ";; header\n" } });
    expect(entriesOf(currentMap(h))[0]!.id).toBe(beforeId);
  });

  it("preserves the ID when the user types below the form", () => {
    const h = harness('(synth "osc/sine" :freq 440)\n');
    const beforeId = entriesOf(currentMap(h))[0]!.id;
    dispatch(h, { changes: { from: docText(h).length, insert: "(a1 1)\n" } });
    expect(entriesOf(currentMap(h))[0]!.id).toBe(beforeId);
  });
});

describe("VAL-ID-004: formatting preserves identity", () => {
  it("preserves the ID through surgical whitespace edits", () => {
    const h = harness('(synth "osc/sine" :freq 440)\n');
    const beforeMap = currentMap(h);
    const beforeId = entriesOf(beforeMap)[0]!.id;
    // A realistic formatter applies surgical whitespace edits, not
    // wholesale replaces. Insert a newline + indent before `:freq`.
    const freqKwPos = docText(h).indexOf(":freq");
    dispatch(h, {
      changes: { from: freqKwPos, insert: "\n  " },
    });
    expect(docText(h)).toBe('(synth "osc/sine"\n  :freq 440)\n');
    expect(entriesOf(currentMap(h))[0]!.id).toBe(beforeId);
    expect(mapsEqualByIdentity(beforeMap, currentMap(h))).toBe(true);
  });

  it("preserves the ID through whitespace removal inside the form", () => {
    // Build a doc with extra space, then collapse it.
    const h = harness('(synth "osc/sine"  :freq 440)\n');
    const beforeId = entriesOf(currentMap(h))[0]!.id;
    const extraSpacePos = docText(h).indexOf("osc/sine\"") + "osc/sine\"".length;
    dispatch(h, {
      changes: { from: extraSpacePos, to: extraSpacePos + 1 },
    });
    expect(docText(h)).toBe('(synth "osc/sine" :freq 440)\n');
    expect(entriesOf(currentMap(h))[0]!.id).toBe(beforeId);
  });
});

describe("VAL-ID-005: structural edits preserve surviving forms", () => {
  it("preserves the synth ID when a sibling top-level form is wrapped", () => {
    const doc = '(a1 (saw 1))\n(synth "osc/sine" :freq 440)\n';
    const h = harness(doc);
    const beforeId = entriesOf(currentMap(h))[0]!.id;
    // Wrap `(a1 (saw 1))` in an extra layer of parens — structural edit
    // on the sibling, synth untouched.
    const firstEnd = doc.indexOf(")") + 1;
    dispatch(h, {
      changes: [
        { from: 0, insert: "(" },
        { from: firstEnd, insert: ")" },
      ],
    });
    expect(entriesOf(currentMap(h))[0]!.id).toBe(beforeId);
  });

  it("preserves identity through slurp-like growth of a sibling", () => {
    const doc = '(a1 1)\n(synth "osc/sine" :freq 440)\n';
    const h = harness(doc);
    const beforeId = entriesOf(currentMap(h))[0]!.id;
    const closeParen = doc.indexOf(")");
    dispatch(h, { changes: { from: closeParen, insert: " 2" } });
    expect(entriesOf(currentMap(h))[0]!.id).toBe(beforeId);
  });

  it("preserves identity when a top-level form above is deleted", () => {
    const doc = '(a1 1)\n(synth "osc/sine" :freq 440)\n';
    const h = harness(doc);
    const beforeId = entriesOf(currentMap(h))[0]!.id;
    dispatch(h, { changes: { from: 0, to: doc.indexOf("\n") + 1 } });
    expect(entriesOf(currentMap(h))[0]!.id).toBe(beforeId);
    // Synth is now at top-level index 0.
    expect(docText(h).startsWith("(synth")).toBe(true);
  });
});

describe("VAL-ID-006: moves preserve identity", () => {
  it("preserves the original ID on cut-then-paste recognised as a move", () => {
    const h = harness('(synth "osc/sine" :freq 440)\n');
    const beforeId = entriesOf(currentMap(h))[0]!.id;

    // 1. Cut: stamp a paste token, then delete the form.
    const original = '(synth "osc/sine" :freq 440)';
    const start = docText(h).indexOf(original);
    const pasteToken = newPasteToken();
    dispatch(h, {
      changes: { from: start, to: start + original.length + 1 },
      effects: markCutEffect.of({ key: [0], pasteToken }),
    });
    // After cut, the document no longer has a synth form. The prior entry
    // is staged (under a synthetic staging key), so it does not appear in
    // the active forms recognised by re-parsing the new document.
    //
    // Filter to entries that are not staging (canonical staging keys start
    // with "fk:-1/"); the staging entry is retained internally but is not
    // an active form.
    const view = h.view;
    const map = view.state.field(h.field).map;
    const activeEntries = entriesOf(map).filter((e) => {
      // Staging entries carry a pendingPasteToken.
      return e.pendingPasteToken === undefined;
    });
    expect(activeEntries).toHaveLength(0);

    // 2. Paste: re-insert the form and declare the move.
    dispatch(h, {
      changes: { from: 0, insert: original + "\n" },
      effects: declareMoveEffect.of({
        pasteToken,
        fromOldKey: [0],
        toNewKey: [0],
      }),
    });

    const afterEntries = entriesOf(currentMap(h));
    expect(afterEntries).toHaveLength(1);
    expect(afterEntries[0]!.id).toBe(beforeId);
  });
});

describe("VAL-ID-007: copies fork identity", () => {
  it("mints a new ID when a copy of the form is appended below", () => {
    const h = harness('(synth "osc/sine" :freq 440)\n');
    const beforeId = entriesOf(currentMap(h))[0]!.id;

    // Duplicate by appending a second synth below. The original at
    // FormKey [0] keeps its identity (range continuity); the appended
    // copy at FormKey [1] has no prior continuity → forks.
    dispatch(h, {
      changes: { from: docText(h).length, insert: '(synth "osc/sine" :freq 440)\n' },
    });
    const entries = entriesOf(currentMap(h));
    expect(entries).toHaveLength(2);
    const ids = entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(2);
    // The original id is preserved on the first form.
    expect(ids).toContain(beforeId);
  });

  it("wholesale document retype forks every form (independent recreation)", () => {
    const h = harness('(synth "osc/sine" :freq 440)\n');
    const beforeId = entriesOf(currentMap(h))[0]!.id;

    // Replacing the entire document is independent recreation: the
    // ChangeSet maps the old range away entirely, so continuity is lost.
    // Per VAL-ID-023, this forks identity.
    const duped = '(synth "osc/sine" :freq 220)\n(synth "osc/sine" :freq 440)\n';
    dispatch(h, {
      changes: { from: 0, to: docText(h).length, insert: duped },
    });
    const entries = entriesOf(currentMap(h));
    expect(entries).toHaveLength(2);
    const ids = entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(2);
    // Neither id equals the original — both are forks.
    expect(ids).not.toContain(beforeId);
  });
});

describe("VAL-ID-008: undo and redo restore exact identity", () => {
  // The two cases immediately below cover the "minor-edit continuity"
  // sub-path of VAL-ID-008: when an undo'd transaction is itself a
  // minor edit that preserved identity through the FORWARD reconciler
  // (same FormKey, overlapping ranges), the post-undo map equals the
  // pre-edit map regardless of whether the `invertedEffects` companion
  // is installed.
  //
  // They are intentionally distinct from the "history-snapshot
  // restoration" sub-path covered by the adversarial
  // `identityExtensionsWithField` cases further below (and by
  // `productionWiring.test.ts`): those sub-paths only pass when the
  // `invertedEffects` companion threads the prior map through undo.
  //
  // To remove the historical masking (Ergo bug f55bcf74) we still wire
  // BOTH extensions through `identityExtensionsWithField` here, so the
  // minor-edit continuity cases exercise the same extension set the
  // running editor installs and any future regression that breaks the
  // companion is caught by every history test in this file.
  it("undo restores the exact prior mapping after a parameter edit", () => {
    const config = makeConfig();
    const { field, extensions: idExt } = identityExtensionsWithField(config);
    const view = new EditorView({
      doc: '(synth "osc/sine" :freq 440)\n',
      extensions: [history(), ...clojureExtensions, ...idExt],
    });

    const beforeMap = view.state.field(field).map;
    const beforeId = entriesOf(beforeMap)[0]!.id;

    // Edit the parameter.
    const freqPos = view.state.doc.toString().indexOf("440");
    view.dispatch({ changes: { from: freqPos, to: freqPos + 3, insert: "880" } });
    expect(entriesOf(view.state.field(field).map)[0]!.id).toBe(beforeId);

    // Undo via CodeMirror's history — replays the exact prior transaction.
    undo(view);

    expect(view.state.doc.toString()).toBe('(synth "osc/sine" :freq 440)\n');
    // Exact equality: same id, same continuity token.
    expect(mapsEqualByIdentity(beforeMap, view.state.field(field).map)).toBe(true);

    view.destroy();
  });

  it("redo restores the exact post-edit mapping after undo+redo", () => {
    const config = makeConfig();
    const { field, extensions: idExt } = identityExtensionsWithField(config);
    const view = new EditorView({
      doc: '(synth "osc/sine" :freq 440)\n',
      extensions: [history(), ...clojureExtensions, ...idExt],
    });

    const initialMap = view.state.field(field).map;
    const freqPos = view.state.doc.toString().indexOf("440");
    view.dispatch({ changes: { from: freqPos, to: freqPos + 3, insert: "880" } });
    const afterEditMap = view.state.field(field).map;

    // Sanity: edit preserved identity (same id, same token).
    expect(mapsEqualByIdentity(initialMap, afterEditMap)).toBe(true);

    // Undo then redo.
    undo(view);
    redo(view);

    // Post-redo map equals the post-edit map exactly.
    expect(mapsEqualByIdentity(afterEditMap, view.state.field(field).map)).toBe(true);

    view.destroy();
  });
});

// VAL-ID-008 — adversarial history-restoration cases.
//
// These tests prove that identity is *restored* through history, not
// deterministically regenerated. They use adversarial ID generators
// whose next-token output depends on how many times the generator has
// been invoked, so a regenerated ID after delete/undo is guaranteed to
// differ from the original. A passing assertion therefore proves the
// implementation is reading the history snapshot rather than minting a
// fresh ID that happens to match.
//
// Covered scenarios:
//   - full-form delete then undo restores the exact original identity
//   - full-form delete, undo, then redo re-drops the identity exactly
//   - add a form, undo the add, then redo restores the exact added
//     identity (not a regenerated one)
//   - repeated undo/redo cycles keep restoring the exact snapshots
//   - independent recreation still forks even when undo/redo is wired
//     (already covered in VAL-ID-023; here we re-assert in a history
//     context to prove the snapshot path does not subvert forking)
//
// Bug: Ergo `fe2dd786` — CodeMirror's history plugin does not replay
// the original transaction; it dispatches an inverted transaction whose
// StateField `update` runs the forward reconciler against a prior map
// that no longer contains the entry, producing a forked ID. The fix
// uses `invertedEffects` to thread a history-aware snapshot effect.

/**
 * Adversarial ID generator whose output is deterministic and depends on
 * call count. If the implementation regenerates IDs instead of restoring
 * them from a snapshot, the second mint emits `id-probe-2` rather than
 * the original `id-probe-1`, so equality assertions fail loudly.
 */
function adversarialIdGenerator(prefix: string = "probe"): { next: () => StateId; count: () => number } {
  let n = 0;
  return {
    next() {
      n += 1;
      return `id-${prefix}-${n}` as StateId;
    },
    count() {
      return n;
    },
  };
}

describe("VAL-ID-008: full-form delete/undo restores exact identity (adversarial)", () => {
  it("deleting a full stateful form then undoing restores its exact original ID and token", () => {
    const ids = adversarialIdGenerator();
    const config: IdentityConfig = {
      ids,
      classifier: defaultStatefulFormClassifier,
      continuity: makeContinuitySource(0),
    };
    const { field, extensions: idExt } = identityExtensionsWithField(config);
    const view = new EditorView({
      doc: '(synth "osc/sine" :freq 440)\n',
      extensions: [history(), ...clojureExtensions, ...idExt],
    });

    const beforeMap = view.state.field(field).map;
    const beforeEntry = entriesOf(beforeMap)[0]!;
    const beforeId = beforeEntry.id;
    const beforeToken = beforeEntry.continuityToken;
    // Capture the mint count after create. A passing assertion must not
    // depend on this exact value because CodeMirror's transactionFilter
    // mechanism (used by the clojure formatter) may legitimately cause
    // a transient duplicate state computation that we discard.
    const mintsBeforeDelete = ids.count();

    const doc = view.state.doc.toString();
    const original = '(synth "osc/sine" :freq 440)';
    const start = doc.indexOf(original);
    // Delete the entire synth form and its trailing newline.
    view.dispatch({ changes: { from: start, to: start + original.length + 1 } });
    // After delete, no synth entry remains.
    expect(entriesOf(view.state.field(field).map)).toHaveLength(0);

    // Undo: must restore the exact original identity, NOT regenerate.
    undo(view);
    const restored = entriesOf(view.state.field(field).map);
    expect(view.state.doc.toString()).toBe('(synth "osc/sine" :freq 440)\n');
    expect(restored).toHaveLength(1);
    expect(restored[0]!.id).toBe(beforeId);
    expect(restored[0]!.continuityToken).toBe(beforeToken);
    // The ID generator must NOT have been called between delete and undo
    // — that proves we restored the snapshot rather than regenerated. The
    // mint count is unchanged from just before the delete.
    expect(ids.count()).toBe(mintsBeforeDelete);
    expect(mapsEqualByIdentity(beforeMap, view.state.field(field).map)).toBe(true);

    view.destroy();
  });

  it("delete, undo, redo re-drops the form and the post-delete (empty) map is restored exactly", () => {
    const ids = adversarialIdGenerator();
    const config: IdentityConfig = {
      ids,
      classifier: defaultStatefulFormClassifier,
      continuity: makeContinuitySource(0),
    };
    const { field, extensions: idExt } = identityExtensionsWithField(config);
    const view = new EditorView({
      doc: '(synth "osc/sine" :freq 440)\n',
      extensions: [history(), ...clojureExtensions, ...idExt],
    });

    const original = '(synth "osc/sine" :freq 440)';
    const start = view.state.doc.toString().indexOf(original);
    view.dispatch({ changes: { from: start, to: start + original.length + 1 } });
    const afterDeleteMap = view.state.field(field).map;
    expect(entriesOf(afterDeleteMap)).toHaveLength(0);
    const mintsAfterDelete = ids.count();

    // Undo then redo.
    undo(view);
    redo(view);

    // After redo, the document is back to empty and the map matches the
    // post-delete (empty) snapshot exactly.
    expect(view.state.doc.toString()).toBe("");
    expect(mapsEqualByIdentity(afterDeleteMap, view.state.field(field).map)).toBe(true);
    // No new IDs minted by the undo+redo path.
    expect(ids.count()).toBe(mintsAfterDelete);

    view.destroy();
  });

  it("repeated delete/undo cycles keep restoring the exact original snapshot", () => {
    const ids = adversarialIdGenerator();
    const config: IdentityConfig = {
      ids,
      classifier: defaultStatefulFormClassifier,
      continuity: makeContinuitySource(0),
    };
    const { field, extensions: idExt } = identityExtensionsWithField(config);
    const view = new EditorView({
      doc: '(synth "osc/sine" :freq 440)\n',
      extensions: [history(), ...clojureExtensions, ...idExt],
    });

    const beforeId = entriesOf(view.state.field(field).map)[0]!.id;
    const original = '(synth "osc/sine" :freq 440)';
    const mintsBeforeCycles = ids.count();

    for (let i = 0; i < 3; i++) {
      const doc = view.state.doc.toString();
      const start = doc.indexOf(original);
      view.dispatch({ changes: { from: start, to: start + original.length + 1 } });
      expect(entriesOf(view.state.field(field).map)).toHaveLength(0);
      undo(view);
      const restored = entriesOf(view.state.field(field).map);
      expect(restored).toHaveLength(1);
      expect(restored[0]!.id).toBe(beforeId);
    }
    // No matter how many cycles, only the create-time mints remain; the
    // undo path never regenerates.
    expect(ids.count()).toBe(mintsBeforeCycles);

    view.destroy();
  });
});

describe("VAL-ID-008: add/undo/redo restores exact identity (adversarial)", () => {
  it("adding a form then undoing and redoing restores the exact added identity", () => {
    const ids = adversarialIdGenerator();
    const config: IdentityConfig = {
      ids,
      classifier: defaultStatefulFormClassifier,
      continuity: makeContinuitySource(0),
    };
    const { field, extensions: idExt } = identityExtensionsWithField(config);
    const view = new EditorView({
      doc: '(a1 1)\n',
      extensions: [history(), ...clojureExtensions, ...idExt],
    });

    // Add a synth form below.
    view.dispatch({
      changes: { from: view.state.doc.length, insert: '(synth "osc/sine" :freq 440)\n' },
    });
    const afterAddMap = view.state.field(field).map;
    const addedEntry = entriesOf(afterAddMap).find((e) => e.kind === "synth")!;
    const mintsAfterAdd = ids.count();

    // Undo the addition: form disappears.
    undo(view);
    expect(view.state.doc.toString()).toBe("(a1 1)\n");
    const synthAfterUndo = entriesOf(view.state.field(field).map).filter((e) => e.kind === "synth");
    expect(synthAfterUndo).toHaveLength(0);

    // Redo the addition: must restore the exact added ID and token, not
    // regenerate (which would have produced a brand-new adversarial id).
    redo(view);
    const restored = entriesOf(view.state.field(field).map).filter((e) => e.kind === "synth");
    expect(restored).toHaveLength(1);
    expect(restored[0]!.id).toBe(addedEntry.id);
    expect(restored[0]!.continuityToken).toBe(addedEntry.continuityToken);
    // The ID generator must NOT have minted again on redo.
    expect(ids.count()).toBe(mintsAfterAdd);

    view.destroy();
  });

  it("repeated add/undo/redo cycles keep restoring the exact added snapshot", () => {
    const ids = adversarialIdGenerator();
    const config: IdentityConfig = {
      ids,
      classifier: defaultStatefulFormClassifier,
      continuity: makeContinuitySource(0),
    };
    const { field, extensions: idExt } = identityExtensionsWithField(config);
    const view = new EditorView({
      doc: '(a1 1)\n',
      extensions: [history(), ...clojureExtensions, ...idExt],
    });

    view.dispatch({
      changes: { from: view.state.doc.length, insert: '(synth "osc/sine" :freq 440)\n' },
    });
    const addedId = entriesOf(view.state.field(field).map).find((e) => e.kind === "synth")!.id;
    const mintsAfterAdd = ids.count();

    for (let i = 0; i < 3; i++) {
      undo(view);
      const synthAfterUndo = entriesOf(view.state.field(field).map).filter((e) => e.kind === "synth");
      expect(synthAfterUndo).toHaveLength(0);
      redo(view);
      const restored = entriesOf(view.state.field(field).map).filter((e) => e.kind === "synth");
      expect(restored).toHaveLength(1);
      expect(restored[0]!.id).toBe(addedId);
    }
    expect(ids.count()).toBe(mintsAfterAdd);

    view.destroy();
  });
});

describe("VAL-ID-008 + VAL-ID-023: independent recreation still forks with history wired", () => {
  it("deleting a form, then independently recreating equivalent source, forks identity", () => {
    const ids = adversarialIdGenerator();
    const config: IdentityConfig = {
      ids,
      classifier: defaultStatefulFormClassifier,
      continuity: makeContinuitySource(0),
    };
    const { field, extensions: idExt } = identityExtensionsWithField(config);
    const view = new EditorView({
      doc: '(synth "osc/sine" :freq 440)\n',
      extensions: [history(), ...clojureExtensions, ...idExt],
    });
    const initialId = entriesOf(view.state.field(field).map)[0]!.id;
    const mintsAfterCreate = ids.count();

    const original = '(synth "osc/sine" :freq 440)';
    const start = view.state.doc.toString().indexOf(original);
    // Delete the form (no markCut → no recognised move on the next insert).
    // Isolate history so the delete is its own undo entry, distinct from
    // the independent re-type below. This models the user's intent: the
    // delete is one logical action, the re-type is a separate action.
    view.dispatch({
      changes: { from: start, to: start + original.length + 1 },
      annotations: isolateHistory.of("full"),
    });
    expect(entriesOf(view.state.field(field).map)).toHaveLength(0);

    // Independently re-type the same source as a NEW history entry.
    view.dispatch({
      changes: { from: 0, insert: original + "\n" },
      annotations: isolateHistory.of("full"),
    });

    const recreated = entriesOf(view.state.field(field).map);
    expect(recreated).toHaveLength(1);
    expect(recreated[0]!.id).not.toBe(initialId);
    // A fork must have minted at least one new ID beyond the create.
    expect(ids.count()).toBeGreaterThan(mintsAfterCreate);

    // Undoing the re-type restores the post-delete (empty) snapshot.
    undo(view);
    expect(entriesOf(view.state.field(field).map)).toHaveLength(0);
    // Undoing the delete restores the original synth with its original ID.
    undo(view);
    const restored = entriesOf(view.state.field(field).map);
    expect(restored).toHaveLength(1);
    expect(restored[0]!.id).toBe(initialId);

    view.destroy();
  });
});

describe("VAL-ID-023: deletion and independent recreation forks identity", () => {
  it("deleting a form then independently recreating equivalent source produces a new ID", () => {
    const h = harness('(synth "osc/sine" :freq 440)\n');
    const initialId = entriesOf(currentMap(h))[0]!.id;
    const original = '(synth "osc/sine" :freq 440)';

    // Delete the synth form (no markCutEffect → no staging).
    const start = docText(h).indexOf(original);
    dispatch(h, {
      changes: { from: start, to: start + original.length + 1 },
    });
    expect(entriesOf(currentMap(h))).toHaveLength(0);

    // Independently re-type the same source.
    dispatch(h, { changes: { from: 0, insert: original + "\n" } });
    const recreatedEntries = entriesOf(currentMap(h));
    expect(recreatedEntries).toHaveLength(1);
    expect(recreatedEntries[0]!.id).not.toBe(initialId);
  });

  it("only undo restoration or recognised moves may recover the original identity", () => {
    const h = harness('(synth "osc/sine" :freq 440)\n');
    const initialId = entriesOf(currentMap(h))[0]!.id;
    const original = '(synth "osc/sine" :freq 440)';
    const start = docText(h).indexOf(original);

    // Cut + paste in a single transaction with a declared move →
    // identity preserved.
    const pasteToken = newPasteToken();
    dispatch(h, {
      changes: { from: start, to: start + original.length + 1, insert: original + "\n" },
      effects: [
        markCutEffect.of({ key: [0], pasteToken }),
        declareMoveEffect.of({
          pasteToken,
          fromOldKey: [0],
          toNewKey: [0],
        }),
      ],
    });
    const movedId = entriesOf(currentMap(h))[0]?.id;
    expect(movedId).toBe(initialId);
  });
});
