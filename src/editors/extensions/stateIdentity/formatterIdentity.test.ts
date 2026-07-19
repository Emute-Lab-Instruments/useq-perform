/**
 * End-to-end formatter + state-identity integration tests.
 *
 * Spec: docs/specs/state-identity.md §7 (Editor Metadata), docs/specs/
 * formatting.md §2.5 (Explicit reformat command) and §2.6 (Auto-format
 * strategies). Assertion IDs covered:
 *   VAL-ID-004  Formatting preserves identity
 *   VAL-ID-005  Structural edits preserve surviving forms
 *   VAL-ID-023  Deletion and independent recreation fork identity
 *
 * Unlike `stateIdentity.test.ts` (which exercises the sidecar directly with
 * hand-crafted surgical transactions), this file drives the REAL uSEQ
 * formatter — the `formatTopLevel` / `formatDocument` paths in
 * `src/editors/extensions/structure/adapter/dispatcher.ts` and the
 * `applyOp` whole-document / per-top-level replace paths in
 * `src/editors/extensions/structure/adapter/applyOp.ts` — against the
 * installed identity sidecar, and asserts that formatting and structural
 * mutations preserve stateful-form identity through CodeMirror's
 * transaction machinery.
 *
 * These are RED-GREEN tests: when first added they exposed that
 * `applyOp`'s whole-document replacement path collapsed every prior
 * entry's range to position 0, causing every surviving stateful form to
 * fork its identity even when its source text was unchanged.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
// @ts-expect-error — clojure-mode has no type declarations
import { default_extensions as clojureExtensions } from "@nextjournal/clojure-mode";

import { getAppSettings, replaceAppSettings } from "../../../runtime/appSettingsRepository.ts";
import { structuralCoreExtensions } from "../structure/adapter/extension.ts";
import { dispatchAction } from "../structure/adapter/dispatcher.ts";
import { structField } from "../structure/adapter/stateField.ts";

import {
  buildIdentityField,
  type IdentityConfig,
} from "./identityField.ts";
import { makeContinuitySource, entriesOf, mapsEqualByIdentity } from "./identityMapState.ts";
import { defaultStatefulFormClassifier } from "./identityClassify.ts";
import { deterministicIdGenerator } from "./identityGenerator.ts";

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
 * Build a real EditorView with:
 *   - the clojure Lezer grammar
 *   - the structural-editing stack (structField + dispatchAction surface)
 *   - the identity sidecar field
 *
 * The view is a DOM-less EditorView (`parent: document.body`); that is
 * sufficient for `dispatchAction`'s `view.dispatch(...)` calls.
 */
function harness(doc: string, config: IdentityConfig = makeConfig()): Harness {
  const field = buildIdentityField(config);
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      extensions: [...clojureExtensions, ...structuralCoreExtensions(), field],
    }),
  });
  return { view, field };
}

function currentMap(h: Harness) {
  return h.view.state.field(h.field).map;
}

function docText(h: Harness): string {
  return h.view.state.doc.toString();
}

/** Move the structural cursor onto the first top-level form. */
function navToFirstForm(h: Harness): void {
  dispatchAction(h.view, "nav.in");
}

/** Move the structural cursor onto the nth top-level form (0-indexed). */
function navToNthForm(h: Harness, n: number): void {
  dispatchAction(h.view, "nav.in"); // into doc → first form
  for (let i = 0; i < n; i++) {
    dispatchAction(h.view, "nav.next");
  }
}

/** Snapshot settings and restore them after the test. */
let _settingsSnapshot: ReturnType<typeof getAppSettings>;
beforeEach(() => {
  _settingsSnapshot = getAppSettings();
  // Ensure autoFormatStrategy is "reflow" so formatNode is exercised. The
  // other strategies are covered by the existing printTree tests.
  replaceAppSettings({
    ...getAppSettings(),
    format: {
      ...getAppSettings().format,
      autoFormatStrategy: "reflow",
      lineWidth: 60,
      complexityThreshold: 4,
      minAvailableWidth: 20,
      indentStyle: "align",
    },
  });
});

afterEach(() => {
  if (_settingsSnapshot !== undefined) {
    replaceAppSettings(_settingsSnapshot);
  }
});

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("VAL-ID-004 (formatter integration): format.topLevel preserves identity", () => {
  it("preserves the synth ID when format.topLevel reformats the synth form", () => {
    // Doc with deliberately awkward whitespace inside the synth form.
    const doc = '(synth "osc/sine"     :freq    440)\n';
    const h = harness(doc);
    const beforeId = entriesOf(currentMap(h))[0]!.id;
    const beforeMap = currentMap(h);

    // Move onto the synth form and run the real explicit reformat.
    navToFirstForm(h);
    const ok = dispatchAction(h.view, "format.topLevel");
    expect(ok).toBe(true);

    const afterEntries = entriesOf(currentMap(h));
    expect(afterEntries).toHaveLength(1);
    expect(afterEntries[0]!.id).toBe(beforeId);
    // Identity map is identity-equal (same id, same continuity token).
    expect(mapsEqualByIdentity(beforeMap, currentMap(h))).toBe(true);
    // Source text was reformatted (whitespace collapsed).
    expect(docText(h)).not.toBe(doc);
    expect(docText(h)).toContain('(synth "osc/sine" :freq 440)');
    h.view.destroy();
  });

  it("preserves the synth ID when the synth form is below the cursor (not the cursor target)", () => {
    // Two top-level forms; cursor on the first (a1), reformat targets the
    // first form. The synth form (second) is untouched and its identity
    // must survive trivially.
    const doc = '(a1 1)\n(synth "osc/sine" :freq 440)\n';
    const h = harness(doc);
    const beforeSynthId = entriesOf(currentMap(h)).find((e) => e.kind === "synth")!.id;
    const beforeMap = currentMap(h);

    navToFirstForm(h);
    dispatchAction(h.view, "format.topLevel");

    const afterSynth = entriesOf(currentMap(h)).find((e) => e.kind === "synth");
    expect(afterSynth).toBeDefined();
    expect(afterSynth!.id).toBe(beforeSynthId);
    expect(mapsEqualByIdentity(beforeMap, currentMap(h))).toBe(true);
    h.view.destroy();
  });

  it("preserves synth identity when format.topLevel reformats a synth that breaks across lines", () => {
    // A long synth form that the formatter will break across multiple lines.
    const doc =
      '(synth "osc/sine" :freq (+ 440 (mul 100 (sine 0.3) (another-long-sig expr-goes-here))))\n';
    const h = harness(doc);
    const beforeId = entriesOf(currentMap(h))[0]!.id;
    const beforeMap = currentMap(h);

    navToFirstForm(h);
    const ok = dispatchAction(h.view, "format.topLevel");
    expect(ok).toBe(true);

    // Doc now contains newlines (formatter broke the form).
    expect(docText(h)).toContain("\n");
    // Identity preserved.
    expect(entriesOf(currentMap(h))).toHaveLength(1);
    expect(entriesOf(currentMap(h))[0]!.id).toBe(beforeId);
    expect(mapsEqualByIdentity(beforeMap, currentMap(h))).toBe(true);
    h.view.destroy();
  });
});

describe("VAL-ID-004 (formatter integration): format.document preserves identity", () => {
  it("preserves the IDs of every stateful form when reformatting the whole document", () => {
    // Doc with two synth forms + awkward whitespace. Both must keep their
    // identity through a whole-document reformat.
    const doc =
      '(synth "osc/sine"     :freq    100)\n\n' +
      '(synth "osc/sine"  :freq   200)\n';
    const h = harness(doc);
    const entriesBefore = entriesOf(currentMap(h));
    expect(entriesBefore).toHaveLength(2);
    const idsBefore = entriesBefore.map((e) => e.id);
    const beforeMap = currentMap(h);

    // Cursor on the first form; format.document reformats every top-level form.
    navToFirstForm(h);
    const ok = dispatchAction(h.view, "format.document");
    expect(ok).toBe(true);

    const entriesAfter = entriesOf(currentMap(h));
    expect(entriesAfter).toHaveLength(2);
    const idsAfter = entriesAfter.map((e) => e.id);
    expect(new Set(idsAfter)).toEqual(new Set(idsBefore));
    expect(mapsEqualByIdentity(beforeMap, currentMap(h))).toBe(true);
    h.view.destroy();
  });

  it("preserves non-stateful sibling form layout (inter-top-level whitespace sacred)", () => {
    // format.document must preserve inter-top-level whitespace per spec §2.1.
    const gap = "\n\n;; a comment line\n\n";
    const doc = '(a1 (saw 1))' + gap + '(synth "osc/sine" :freq 440)\n';
    const h = harness(doc);
    const beforeId = entriesOf(currentMap(h))[0]!.id;
    const beforeMap = currentMap(h);

    navToFirstForm(h);
    dispatchAction(h.view, "format.document");

    // The gap is preserved verbatim.
    expect(docText(h)).toContain(gap);
    // Synth identity preserved.
    const after = entriesOf(currentMap(h));
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe(beforeId);
    expect(mapsEqualByIdentity(beforeMap, currentMap(h))).toBe(true);
    h.view.destroy();
  });
});

describe("VAL-ID-005 (formatter integration): structural edits preserve surviving stateful forms", () => {
  it("preserves the synth ID when a sibling top-level form is structurally mutated (slurp)", () => {
    // Synth form is the second top-level form. Slurp on the first form
    // changes top-level structure for the first form only; the synth is a
    // surviving form and must retain its identity.
    //
    // The pre-fix bug: applyOp's whole-doc replacement collapsed every
    // prior entry's range, forking all surviving forms. This case covers
    // the path through `findAffectedTopLevelIndex === null` (top-level
    // form count changes) and the path through per-top-level replace.
    const doc = '(a) b\n(synth "osc/sine" :freq 440)\n';
    const h = harness(doc);
    const beforeSynthId = entriesOf(currentMap(h)).find((e) => e.kind === "synth")!.id;
    const beforeSynthToken = entriesOf(currentMap(h)).find((e) => e.kind === "synth")!.continuityToken;

    navToFirstForm(h);
    const ok = dispatchAction(h.view, "edit.slurpForward");
    expect(ok).toBe(true);

    // Doc now contains (a b); the synth form is still present.
    expect(docText(h)).toContain("(a b)");
    expect(docText(h)).toContain("(synth");

    const afterSynth = entriesOf(currentMap(h)).find((e) => e.kind === "synth");
    expect(afterSynth).toBeDefined();
    expect(afterSynth!.id).toBe(beforeSynthId);
    // Continuity token preserved — proves the identity is the SAME logical
    // synth, not a freshly-forked copy with a coincidentally-equal id.
    expect(afterSynth!.continuityToken).toBe(beforeSynthToken);
    h.view.destroy();
  });

  it("preserves the synth ID when a sibling is raised to the top level (changes top-level form count)", () => {
    // The barf forward path: cursor on a sibling of the synth, ejecting
    // the sibling's last child as a new top-level form. This changes the
    // top-level form count and triggers applyOp's whole-doc fallback.
    const doc = '(a b)\n(synth "osc/sine" :freq 440)\n';
    const h = harness(doc);
    const beforeSynthId = entriesOf(currentMap(h)).find((e) => e.kind === "synth")!.id;
    const beforeSynthToken = entriesOf(currentMap(h)).find((e) => e.kind === "synth")!.continuityToken;

    navToFirstForm(h);
    const ok = dispatchAction(h.view, "edit.barfForward");
    expect(ok).toBe(true);

    // Doc now has THREE top-level forms: (a), b, and the synth.
    expect(docText(h)).toContain("(a)");
    expect(docText(h)).toContain("(synth");

    // The synth (third top-level form) survives with the same identity.
    const afterSynth = entriesOf(currentMap(h)).find((e) => e.kind === "synth");
    expect(afterSynth).toBeDefined();
    expect(afterSynth!.id).toBe(beforeSynthId);
    expect(afterSynth!.continuityToken).toBe(beforeSynthToken);
    h.view.destroy();
  });

  it("preserves the synth ID when the synth form itself is structurally mutated (slurp inside)", () => {
    // The synth is the first form; slurp inside the synth. Per-doc-change
    // the synth's range continuity is preserved (single top-level form,
    // affectedTopLevel = 0, per-form replace).
    const doc = '(synth "osc/sine" :freq 440)\n(a)\n';
    const h = harness(doc);
    const beforeId = entriesOf(currentMap(h))[0]!.id;
    const beforeToken = entriesOf(currentMap(h))[0]!.continuityToken;

    navToFirstForm(h);
    const ok = dispatchAction(h.view, "edit.slurpForward");
    expect(ok).toBe(true);

    const after = entriesOf(currentMap(h));
    expect(after).toHaveLength(1);
    expect(after[0]!.kind).toBe("synth");
    expect(after[0]!.id).toBe(beforeId);
    expect(after[0]!.continuityToken).toBe(beforeToken);
    h.view.destroy();
  });
});

describe("VAL-ID-023 (formatter integration): independent recreation still forks after structural mutation", () => {
  it("deleting a synth via structural delete then re-typing it produces a new ID", () => {
    const h = harness('(synth "osc/sine" :freq 440)\n');
    const initialId = entriesOf(currentMap(h))[0]!.id;

    // Structural delete of the synth form.
    navToFirstForm(h);
    dispatchAction(h.view, "edit.delete");
    expect(entriesOf(currentMap(h))).toHaveLength(0);

    // Independently re-type equivalent source.
    h.view.dispatch({
      changes: { from: h.view.state.doc.length, insert: '(synth "osc/sine" :freq 440)\n' },
    });
    const recreated = entriesOf(currentMap(h));
    expect(recreated).toHaveLength(1);
    expect(recreated[0]!.id).not.toBe(initialId);
    h.view.destroy();
  });
});

describe("VAL-ID-007 (formatter integration): copies still fork after formatter runs", () => {
  it("copy-pasting a synth form forks identity, then format.document preserves both IDs", () => {
    const h = harness('(synth "osc/sine" :freq 440)\n');
    const originalId = entriesOf(currentMap(h))[0]!.id;

    // Duplicate by appending a second synth below (copy semantics, not a
    // recognised move → fork).
    h.view.dispatch({
      changes: { from: h.view.state.doc.length, insert: '(synth "osc/sine" :freq 440)\n' },
    });
    const afterDup = entriesOf(currentMap(h));
    expect(afterDup).toHaveLength(2);
    const afterDupIds = afterDup.map((e) => e.id);
    expect(new Set(afterDupIds).size).toBe(2);
    expect(afterDupIds).toContain(originalId);
    const forkedId = afterDupIds.find((id) => id !== originalId)!;

    // Run format.document; both IDs must survive (formatter preserves
    // identity, doesn't re-fork).
    navToFirstForm(h);
    dispatchAction(h.view, "format.document");

    const afterFormat = entriesOf(currentMap(h));
    expect(afterFormat).toHaveLength(2);
    const afterFormatIds = afterFormat.map((e) => e.id);
    expect(afterFormatIds).toContain(originalId);
    expect(afterFormatIds).toContain(forkedId);
    h.view.destroy();
  });
});
