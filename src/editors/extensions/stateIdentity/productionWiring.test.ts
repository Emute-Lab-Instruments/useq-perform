/**
 * Production-wiring integration tests for the state-identity sidecar.
 *
 * Spec: docs/specs/state-identity.md §7 (Editor Metadata) and §13.3
 * (Phase 3 editor hidden IDs). Assertion IDs covered:
 *   VAL-ID-008  Undo/redo restore exact identity (through production wiring)
 *
 * Ergo bug f55bcf74: the production entry point
 * (`defaultIdentityExtension` in `identityFieldExport.ts`) installed only
 * the bare `StateField` and omitted the `invertedEffects` companion that
 * threads history-aware snapshots through undo/redo. As a result, every
 * undo/redo in the *running editor* minted a fresh forked identity even
 * though the in-process `identityExtensionsWithField` tests passed. The
 * existing tests masked this divergence because they bypassed the
 * production singleton entirely.
 *
 * These tests exercise the SAME production singleton that
 * `src/editors/extensions.ts` installs in the running editor. They prove
 * the cached field and the `invertedEffects` companion are installed
 * together and that delete/undo and add/undo/redo restore exact IDs
 * through that real path.
 *
 * Adversarial technique: each test uses an adversarial ID generator whose
 * next-token output depends on call count. If the implementation regenerates
 * IDs through the forward reconciler instead of restoring them from a
 * history snapshot, the minted ID is observably different (a higher call
 * count) and the equality assertion fails loudly.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { history, undo, redo, isolateHistory } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { default_extensions as clojureExtensions } from "@nextjournal/clojure-mode";

import {
  defaultIdentityExtension,
  identityField,
  _resetIdentityFieldSingletonForTests,
} from "./identityFieldExport.ts";
import { setProductionIdentityConfigForTests } from "./createDefaultIdentityConfig.ts";
import { entriesOf, mapsEqualByIdentity, makeContinuitySource } from "./identityMapState.ts";
import { defaultStatefulFormClassifier } from "./identityClassify.ts";
import type { StateId } from "./identityTypes.ts";
import type { IdGenerator } from "./identityGenerator.ts";

// ─── Adversarial ID generator ──────────────────────────────────────────────

/**
 * Adversarial ID generator whose output is deterministic and depends on
 * call count. If the implementation regenerates IDs instead of restoring
 * them from a snapshot, the second mint emits `id-prod-probe-2` rather
 * than the original `id-prod-probe-1`, so equality assertions fail loudly.
 *
 * This is the same adversarial shape used in `stateIdentity.test.ts` but
 * applied to the PRODUCTION extension singleton so we exercise the real
 * wiring path used by the running editor.
 */
function adversarialIdGenerator(
  prefix = "prod-probe",
): IdGenerator & { count: () => number } {
  let n = 0;
  return {
    next(): StateId {
      n += 1;
      return `id-${prefix}-${n}` as StateId;
    },
    count() {
      return n;
    },
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Build a production-shaped extension set: `defaultIdentityExtension()`
 * supplies the cached field plus (after the fix) the `invertedEffects`
 * companion. The identity field reads from the singleton via
 * `identityField()` so downstream code resolves the SAME field reference
 * the editor installed.
 *
 * Because the singleton caches the first config it was built with, we
 * reset it before each harness construction and pass the caller's config
 * through `setProductionIdentityConfigForTests`.
 */
beforeEach(() => {
  _resetIdentityFieldSingletonForTests();
});

interface Harness {
  view: EditorView;
  field: ReturnType<typeof identityField>;
  ids: ReturnType<typeof adversarialIdGenerator>;
}

function productionHarness(doc: string): Harness {
  const ids = adversarialIdGenerator();
  setProductionIdentityConfigForTests({
    ids,
    classifier: defaultStatefulFormClassifier,
    continuity: makeContinuitySource(0),
  });
  const extensions = defaultIdentityExtension();
  const field = identityField();
  const view = new EditorView({
    doc,
    extensions: [history(), ...clojureExtensions, ...extensions],
  });
  return { view, field, ids };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("VAL-ID-008 (production wiring): defaultIdentityExtension installs invertedEffects", () => {
  it("defaultIdentityExtension returns more than just the bare field (companion wired)", () => {
    // Before the fix, `defaultIdentityExtension()` returned `[identityField()]`
    // (length 1) and never installed the `invertedEffects` companion. After
    // the fix, it returns at least two extensions: the field plus the
    // invertedEffects registration.
    _resetIdentityFieldSingletonForTests();
    setProductionIdentityConfigForTests({
      ids: adversarialIdGenerator(),
      classifier: defaultStatefulFormClassifier,
      continuity: makeContinuitySource(0),
    });
    const extensions = defaultIdentityExtension();
    expect(extensions.length).toBeGreaterThanOrEqual(2);
  });
});

describe("VAL-ID-008 (production wiring): delete/undo restores exact identity", () => {
  it("deleting a stateful form then undoing restores the exact original ID through the production singleton", () => {
    const h = productionHarness('(synth "osc/sine" :freq 440)\n');
    const beforeMap = h.view.state.field(h.field).map;
    const beforeEntry = entriesOf(beforeMap)[0]!;
    const beforeId = beforeEntry.id;
    const beforeToken = beforeEntry.continuityToken;
    const mintsBeforeDelete = h.ids.count();

    // Delete the synth form (and its trailing newline).
    const doc = h.view.state.doc.toString();
    const original = '(synth "osc/sine" :freq 440)';
    const start = doc.indexOf(original);
    h.view.dispatch({
      changes: { from: start, to: start + original.length + 1 },
    });
    expect(entriesOf(h.view.state.field(h.field).map)).toHaveLength(0);

    // Undo must restore the exact original identity through the production
    // singleton, NOT regenerate.
    undo(h.view);
    const restored = entriesOf(h.view.state.field(h.field).map);
    expect(h.view.state.doc.toString()).toBe('(synth "osc/sine" :freq 440)\n');
    expect(restored).toHaveLength(1);
    expect(restored[0]!.id).toBe(beforeId);
    expect(restored[0]!.continuityToken).toBe(beforeToken);
    expect(h.ids.count()).toBe(mintsBeforeDelete);
    expect(mapsEqualByIdentity(beforeMap, h.view.state.field(h.field).map)).toBe(true);

    h.view.destroy();
  });

  it("delete, undo, redo re-drops the form and the post-delete (empty) map is restored exactly through production wiring", () => {
    const h = productionHarness('(synth "osc/sine" :freq 440)\n');
    const original = '(synth "osc/sine" :freq 440)';
    const start = h.view.state.doc.toString().indexOf(original);
    h.view.dispatch({
      changes: { from: start, to: start + original.length + 1 },
    });
    const afterDeleteMap = h.view.state.field(h.field).map;
    expect(entriesOf(afterDeleteMap)).toHaveLength(0);
    const mintsAfterDelete = h.ids.count();

    undo(h.view);
    redo(h.view);

    expect(h.view.state.doc.toString()).toBe("");
    expect(
      mapsEqualByIdentity(afterDeleteMap, h.view.state.field(h.field).map),
    ).toBe(true);
    expect(h.ids.count()).toBe(mintsAfterDelete);

    h.view.destroy();
  });
});

describe("VAL-ID-008 (production wiring): add/undo/redo restores exact identity", () => {
  it("adding a form then undoing and redoing restores the exact added identity through production wiring", () => {
    const h = productionHarness('(a1 1)\n');

    h.view.dispatch({
      changes: {
        from: h.view.state.doc.length,
        insert: '(synth "osc/sine" :freq 440)\n',
      },
    });
    const afterAddMap = h.view.state.field(h.field).map;
    const addedEntry = entriesOf(afterAddMap).find((e) => e.kind === "synth")!;
    const mintsAfterAdd = h.ids.count();

    undo(h.view);
    expect(h.view.state.doc.toString()).toBe("(a1 1)\n");
    const synthAfterUndo = entriesOf(h.view.state.field(h.field).map).filter(
      (e) => e.kind === "synth",
    );
    expect(synthAfterUndo).toHaveLength(0);

    redo(h.view);
    const restored = entriesOf(h.view.state.field(h.field).map).filter(
      (e) => e.kind === "synth",
    );
    expect(restored).toHaveLength(1);
    expect(restored[0]!.id).toBe(addedEntry.id);
    expect(restored[0]!.continuityToken).toBe(addedEntry.continuityToken);
    expect(h.ids.count()).toBe(mintsAfterAdd);

    h.view.destroy();
  });

  it("repeated add/undo/redo cycles keep restoring the exact added snapshot through production wiring", () => {
    const h = productionHarness('(a1 1)\n');
    h.view.dispatch({
      changes: {
        from: h.view.state.doc.length,
        insert: '(synth "osc/sine" :freq 440)\n',
      },
    });
    const addedId = entriesOf(h.view.state.field(h.field).map).find(
      (e) => e.kind === "synth",
    )!.id;
    const mintsAfterAdd = h.ids.count();

    for (let i = 0; i < 3; i++) {
      undo(h.view);
      const synthAfterUndo = entriesOf(h.view.state.field(h.field).map).filter(
        (e) => e.kind === "synth",
      );
      expect(synthAfterUndo).toHaveLength(0);
      redo(h.view);
      const restored = entriesOf(h.view.state.field(h.field).map).filter(
        (e) => e.kind === "synth",
      );
      expect(restored).toHaveLength(1);
      expect(restored[0]!.id).toBe(addedId);
    }
    expect(h.ids.count()).toBe(mintsAfterAdd);

    h.view.destroy();
  });
});

describe("VAL-ID-008 + VAL-ID-023 (production wiring): independent recreation still forks", () => {
  it("delete then independently re-type produces a new ID through production wiring", () => {
    const h = productionHarness('(synth "osc/sine" :freq 440)\n');
    const initialId = entriesOf(h.view.state.field(h.field).map)[0]!.id;
    const mintsAfterCreate = h.ids.count();

    const original = '(synth "osc/sine" :freq 440)';
    const start = h.view.state.doc.toString().indexOf(original);
    h.view.dispatch({
      changes: { from: start, to: start + original.length + 1 },
      annotations: isolateHistory.of("full"),
    });
    expect(entriesOf(h.view.state.field(h.field).map)).toHaveLength(0);

    // Independent re-type as a NEW history entry forks identity.
    h.view.dispatch({
      changes: { from: 0, insert: original + "\n" },
      annotations: isolateHistory.of("full"),
    });
    const recreated = entriesOf(h.view.state.field(h.field).map);
    expect(recreated).toHaveLength(1);
    expect(recreated[0]!.id).not.toBe(initialId);
    expect(h.ids.count()).toBeGreaterThan(mintsAfterCreate);

    // Undoing the re-type restores the post-delete (empty) snapshot.
    undo(h.view);
    expect(entriesOf(h.view.state.field(h.field).map)).toHaveLength(0);
    // Undoing the delete restores the original synth with its original ID.
    undo(h.view);
    const restored = entriesOf(h.view.state.field(h.field).map);
    expect(restored).toHaveLength(1);
    expect(restored[0]!.id).toBe(initialId);

    h.view.destroy();
  });
});
