/**
 * Unified eval payload builder + source-map + diagnostic remap tests.
 *
 * Spec: docs/specs/state-identity.md §6, §7.4, §7.5, §12.4.
 *
 * Assertion IDs covered:
 *   VAL-ID-013  Anonymous runtime payload injects identity
 *   VAL-ID-014  Explicit identity is respected
 *   VAL-ID-015  Rewrites compose through one map
 *   VAL-ID-017  Visible diagnostics map exactly
 *   VAL-ID-018  Generated-syntax diagnostics anchor meaningfully
 *   VAL-ID-019  Hidden IDs never leak (in payload/clipboard/diagnostics)
 *   VAL-ID-022  Injection follows syntax-tree structure
 *
 * The cross-entry-point equivalence (VAL-ID-016) and worker-fork
 * behaviour (VAL-ID-021) are covered by Mocha integration tests in
 * `test/state-identity-eval-payload.test.mjs`.
 */

import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
// @ts-expect-error — clojure-mode has no type declarations
import { default_extensions as clojureExtensions } from "@nextjournal/clojure-mode";

import {
  buildIdentityField,
  type IdentityConfig,
} from "./identityField.ts";
import { defaultStatefulFormClassifier } from "./identityClassify.ts";
import { deterministicIdGenerator } from "./identityGenerator.ts";
import { makeContinuitySource } from "./identityMapState.ts";
import { entriesOf } from "./identityMapState.ts";

import {
  buildEvalPayload,
  remapDiagnostics,
  type EvalPayloadSource,
  type ManualControlBinding,
} from "./evalPayload.ts";
import type { UseqDiagnostic } from "../../contracts/runtimeTypes.ts";

// ─── Harness ───────────────────────────────────────────────────────────────

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

function harness(doc: string, config: IdentityConfig = makeConfig()): Harness {
  const field = buildIdentityField(config);
  const view = new EditorView({
    doc,
    extensions: [...clojureExtensions, field],
  });
  return { view, field };
}

function buildPayload(
  h: Harness,
  sliceFrom: number,
  sliceTo: number,
  opts: { manualBindings?: ManualControlBinding[]; source?: EvalPayloadSource } = {},
) {
  const doc = h.view.state.doc.toString();
  const visibleSlice = doc.slice(sliceFrom, sliceTo);
  const map = h.view.state.field(h.field).map;
  return buildEvalPayload({
    visibleSlice,
    sliceFrom,
    identityMap: map,
    state: h.view.state,
    manualBindings: opts.manualBindings ?? [],
    source: opts.source ?? "toplevel",
  });
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("VAL-ID-013: anonymous runtime payload injects identity", () => {
  it("injects a hidden identity wrapper for an anonymous synth form", () => {
    const doc = '(synth "osc/sine" :freq 440)\n';
    const h = harness(doc);
    const from = 0;
    const to = doc.length - 1; // exclude trailing newline
    const { runtimeCode, sourceMap, visibleSlice } = buildPayload(h, from, to);

    // Visible slice is unchanged conceptually
    expect(visibleSlice).toBe('(synth "osc/sine" :freq 440)');

    // Runtime code wraps the form in (with-state-id "..." ...)
    expect(runtimeCode).toMatch(/^\(with-state-id "[^"]+" \(synth "osc\/sine" :freq 440\)\)$/);

    // The injected id matches the sidecar entry.
    const entry = entriesOf(h.view.state.field(h.field).map)[0]!;
    expect(runtimeCode).toContain(`"${entry.id}"`);

    // Source map is non-empty and covers the full visible range.
    expect(sourceMap.length).toBeGreaterThan(0);
    const total = sourceMap.reduce(
      (acc, s) => ({
        visible: {
          from: Math.min(acc.visible.from, s.visible.from),
          to: Math.max(acc.visible.to, s.visible.to),
        },
        runtime: {
          from: Math.min(acc.runtime.from, s.runtime.from),
          to: Math.max(acc.runtime.to, s.runtime.to),
        },
      }),
      {
        visible: { from: Number.MAX_SAFE_INTEGER, to: 0 },
        runtime: { from: Number.MAX_SAFE_INTEGER, to: 0 },
      },
    );
    expect(total.visible.from).toBe(0);
    expect(total.visible.to).toBe(visibleSlice.length);
    expect(total.runtime.from).toBe(0);
    expect(total.runtime.to).toBe(runtimeCode.length);
  });

  it("does not inject anything when there is no stateful form", () => {
    const doc = "(a1 (saw 1))\n";
    const h = harness(doc);
    const { runtimeCode, sourceMap } = buildPayload(h, 0, doc.length - 1);
    expect(runtimeCode).toBe("(a1 (saw 1))");
    // Single identity-mapping segment covering the whole slice.
    expect(sourceMap).toEqual([
      {
        visible: { from: 0, to: "(a1 (saw 1))".length },
        runtime: { from: 0, to: "(a1 (saw 1))".length },
        generated: false,
      },
    ]);
  });
});

describe("VAL-ID-014: explicit identity is respected", () => {
  it("does not double-wrap a synth form that already carries an explicit :id", () => {
    // The classifier recognises any top-level synth form. The payload
    // builder must inspect the form for an explicit `:id`/`with-state-id`
    // marker and, if present, emit the user's form verbatim.
    const doc = '(synth "osc/sine" :freq 440 :id "user-phase")\n';
    const h = harness(doc);
    const { runtimeCode } = buildPayload(h, 0, doc.length - 1);
    // No double wrapper: user's form is sent verbatim.
    expect(runtimeCode).toBe('(synth "osc/sine" :freq 440 :id "user-phase")');
    expect(runtimeCode).not.toMatch(/\(with-state-id/);
  });

  it("does not double-wrap a form already wrapped in with-state-id", () => {
    const doc = '(with-state-id "user-x" (synth "osc/sine" :freq 440))\n';
    const h = harness(doc);
    const slice = '(with-state-id "user-x" (synth "osc/sine" :freq 440))';
    const { runtimeCode } = buildPayload(h, 0, slice.length);
    expect(runtimeCode).toBe(slice);
    expect(runtimeCode).not.toMatch(/\(with-state-id "[^"]+" \(with-state-id/);
  });
});

describe("VAL-ID-015: rewrites compose through one map", () => {
  it("composes identity injection with manual-control substitution through one source map", () => {
    // Document where one synth arg (e.g. `:amp`) is under manual control.
    // Manual binding replaces a slice of the form with `(ssin N)`.
    const doc = '(synth "osc/sine" :freq 440 :amp 0.5)\n';
    const h = harness(doc);

    // The "0.5" amplitude value is under manual control (right-stick slot 17).
    const ampPos = doc.indexOf("0.5");
    const bindings: ManualControlBinding[] = [
      {
        stick: "right",
        slot: 17,
        from: ampPos,
        to: ampPos + 3,
        value: 0,
        originalText: "0.5",
        lastSentAt: 0,
        lastSentValue: 0,
      },
    ];

    const { runtimeCode, sourceMap, visibleSlice } = buildPayload(h, 0, doc.length - 1, {
      manualBindings: bindings,
    });

    // Visible slice is the unmodified source.
    expect(visibleSlice).toBe('(synth "osc/sine" :freq 440 :amp 0.5)');

    // Runtime code has BOTH the identity wrapper AND the ssin substitution.
    expect(runtimeCode).toMatch(/^\(with-state-id "[^"]+" \(synth "osc\/sine" :freq 440 :amp \(ssin 17\)\)\)$/);

    // Single source map covering all rewrites. Every visible position
    // has a runtime counterpart and vice versa, except for generated
    // regions (which are bounded visible ranges on the host form).
    expect(sourceMap.length).toBeGreaterThan(1);

    // Assert no gaps or overlaps in the runtime range: union covers the
    // entire runtimeCode without holes.
    const sorted = [...sourceMap].sort((a, b) => a.runtime.from - b.runtime.from);
    expect(sorted[0]!.runtime.from).toBe(0);
    expect(sorted[sorted.length - 1]!.runtime.to).toBe(runtimeCode.length);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]!.runtime.from).toBe(sorted[i - 1]!.runtime.to);
    }

    // Manual-control segment is marked generated (it maps to a runtime
    // `(ssin N)` insertion that is not in the visible source).
    const manualSeg = sourceMap.find((s) => s.runtime.from > 0 && /ssin/.test(runtimeCode.slice(s.runtime.from, s.runtime.to)));
    expect(manualSeg).toBeDefined();
    expect(manualSeg!.generated).toBe(true);
    // Generated segment anchors to a bounded visible range on the host form.
    expect(manualSeg!.visible.from).toBeGreaterThanOrEqual(0);
    expect(manualSeg!.visible.to).toBeGreaterThan(manualSeg!.visible.from);
    expect(manualSeg!.visible.to).toBeLessThanOrEqual(visibleSlice.length);
  });
});

describe("VAL-ID-017: visible diagnostics map exactly", () => {
  it("maps a runtime diagnostic on unchanged visible syntax back to the same visible range", () => {
    // Source without stateful forms: runtime code === visible code, so
    // diagnostics map 1:1.
    const doc = "(a1 (saw 1))\n";
    const h = harness(doc);
    const from = 0;
    const to = doc.length - 1;
    const slice = doc.slice(from, to);
    const { runtimeCode, sourceMap } = buildPayload(h, from, to);
    expect(runtimeCode).toBe(slice);

    // Simulate a runtime diagnostic pointing at "saw" in the runtime code.
    const sawRuntimeFrom = runtimeCode.indexOf("saw");
    const sawRuntimeTo = sawRuntimeFrom + "saw".length;
    const diagnostics: UseqDiagnostic[] = [
      {
        start: sawRuntimeFrom,
        end: sawRuntimeTo,
        severity: "error",
        message: "unknown function: saw",
      },
    ];
    const remapped = remapDiagnostics(diagnostics, sourceMap, from);

    const expectedVisibleFrom = slice.indexOf("saw") + from;
    expect(remapped).toHaveLength(1);
    expect(remapped[0]!.start).toBe(expectedVisibleFrom);
    expect(remapped[0]!.end).toBe(expectedVisibleFrom + "saw".length);
    expect(remapped[0]!.message).toBe("unknown function: saw");
  });

  it("maps a runtime diagnostic that spans an entire unchanged form exactly", () => {
    const doc = "(foo bar)\n";
    const h = harness(doc);
    const { runtimeCode, sourceMap } = buildPayload(h, 0, doc.length - 1);
    expect(runtimeCode).toBe("(foo bar)");
    const diags: UseqDiagnostic[] = [
      { start: 0, end: runtimeCode.length, severity: "error", message: "all wrong" },
    ];
    const remapped = remapDiagnostics(diags, sourceMap, 0);
    expect(remapped[0]!.start).toBe(0);
    expect(remapped[0]!.end).toBe("(foo bar)".length);
  });
});

describe("VAL-ID-018: generated-syntax diagnostics anchor meaningfully", () => {
  it("anchors a diagnostic inside generated with-state-id wrapper to the host form's visible range", () => {
    const doc = '(synth "osc/sine" :freq 440)\n';
    const h = harness(doc);
    const slice = '(synth "osc/sine" :freq 440)';
    const { runtimeCode, sourceMap } = buildPayload(h, 0, slice.length);

    // Runtime code looks like: (with-state-id "id-..." (synth ...))
    // A diagnostic pointing at the wrapper head `with-state-id` should
    // map to a bounded visible range covering the host form.
    const wrapperHeadFrom = runtimeCode.indexOf("with-state-id");
    const wrapperHeadTo = wrapperHeadFrom + "with-state-id".length;
    const diags: UseqDiagnostic[] = [
      {
        start: wrapperHeadFrom,
        end: wrapperHeadTo,
        severity: "warning",
        message: "wrapper complaint",
      },
    ];
    const remapped = remapDiagnostics(diags, sourceMap, 0);
    expect(remapped).toHaveLength(1);
    // Anchors inside the visible host form, bounded to its range.
    expect(remapped[0]!.start).toBeGreaterThanOrEqual(0);
    expect(remapped[0]!.end).toBeLessThanOrEqual(slice.length);
    expect(remapped[0]!.end).toBeGreaterThan(remapped[0]!.start);
  });

  it("anchors a diagnostic overlapping both generated and visible syntax to a bounded visible range", () => {
    const doc = '(synth "osc/sine" :freq 440)\n';
    const h = harness(doc);
    const slice = '(synth "osc/sine" :freq 440)';
    const { runtimeCode, sourceMap } = buildPayload(h, 0, slice.length);

    // Diagnostic that starts in the wrapper prefix and runs into the
    // visible `synth` head: should still anchor inside the form, bounded.
    const wrapperStart = runtimeCode.indexOf("(with-state-id");
    const synthStart = runtimeCode.indexOf("(synth");
    const diags: UseqDiagnostic[] = [
      {
        start: wrapperStart,
        end: synthStart + "(synth".length,
        severity: "warning",
        message: "overlap complaint",
      },
    ];
    const remapped = remapDiagnostics(diags, sourceMap, 0);
    expect(remapped).toHaveLength(1);
    expect(remapped[0]!.start).toBeGreaterThanOrEqual(0);
    expect(remapped[0]!.end).toBeLessThanOrEqual(slice.length);
    expect(remapped[0]!.end).toBeGreaterThan(remapped[0]!.start);
  });

  it("anchors a diagnostic wholly inside a manual-control substitution to the host form's bounded visible range", () => {
    const doc = '(synth "osc/sine" :freq 440 :amp 0.5)\n';
    const h = harness(doc);
    const ampPos = doc.indexOf("0.5");
    const bindings: ManualControlBinding[] = [
      {
        stick: "right", slot: 17, from: ampPos, to: ampPos + 3,
        value: 0, originalText: "0.5", lastSentAt: 0, lastSentValue: 0,
      },
    ];
    const { runtimeCode, sourceMap } = buildPayload(h, 0, doc.length - 1, {
      manualBindings: bindings,
    });
    // Find the `(ssin 17)` text and craft a diagnostic pointing inside it.
    const ssinPos = runtimeCode.indexOf("(ssin 17)");
    const diags: UseqDiagnostic[] = [
      {
        start: ssinPos,
        end: ssinPos + "(ssin 17)".length,
        severity: "error",
        message: "manual control unavailable",
      },
    ];
    const remapped = remapDiagnostics(diags, sourceMap, 0);
    expect(remapped).toHaveLength(1);
    // Anchors inside the visible slice, bounded.
    expect(remapped[0]!.start).toBeGreaterThanOrEqual(0);
    expect(remapped[0]!.end).toBeLessThanOrEqual(doc.length - 1);
    expect(remapped[0]!.end).toBeGreaterThan(remapped[0]!.start);
  });
});

describe("VAL-ID-019: hidden IDs never leak", () => {
  it("does not include hidden IDs in the visible slice", () => {
    const doc = '(synth "osc/sine" :freq 440)\n';
    const h = harness(doc);
    const { visibleSlice } = buildPayload(h, 0, doc.length - 1);
    expect(visibleSlice).toBe('(synth "osc/sine" :freq 440)');
  });

  it("includes hidden IDs only in the runtime code, never in source-map visible ranges", () => {
    const doc = '(synth "osc/sine" :freq 440)\n';
    const h = harness(doc);
    const slice = '(synth "osc/sine" :freq 440)';
    const { sourceMap, runtimeCode } = buildPayload(h, 0, slice.length);
    // Runtime code DOES contain the id.
    const id = entriesOf(h.view.state.field(h.field).map)[0]!.id;
    expect(runtimeCode).toContain(id);
    // No visible range contains the id text.
    for (const seg of sourceMap) {
      expect(seg.visible.from).toBeLessThanOrEqual(seg.visible.to);
      // Visible ranges are within [0, slice.length].
      expect(seg.visible.from).toBeGreaterThanOrEqual(0);
      expect(seg.visible.to).toBeLessThanOrEqual(slice.length);
    }
  });

  it("does not surface the hidden id through remapped diagnostics", () => {
    const doc = '(synth "osc/sine" :freq 440)\n';
    const h = harness(doc);
    const slice = '(synth "osc/sine" :freq 440)';
    const { runtimeCode, sourceMap } = buildPayload(h, 0, slice.length);

    const id = entriesOf(h.view.state.field(h.field).map)[0]!.id;
    // Diagnostic that exactly covers the id literal in the runtime code.
    const idLit = `"${id}"`;
    const idStart = runtimeCode.indexOf(idLit);
    expect(idStart).toBeGreaterThanOrEqual(0);
    const diags: UseqDiagnostic[] = [
      {
        start: idStart,
        end: idStart + idLit.length,
        severity: "info",
        message: "diagnostic touching id",
      },
    ];
    const remapped = remapDiagnostics(diags, sourceMap, 0);
    expect(remapped).toHaveLength(1);
    // The remapped message must not contain the id.
    expect(remapped[0]!.message).not.toContain(id);
    // And the visible range must be inside the host form (not extending past).
    expect(remapped[0]!.start).toBeGreaterThanOrEqual(0);
    expect(remapped[0]!.end).toBeLessThanOrEqual(slice.length);
  });
});

describe("VAL-ID-022: injection follows syntax-tree structure", () => {
  it("does not inject identity for synth-like text inside a string literal", () => {
    const doc = '(a1 "synth is great")\n';
    const h = harness(doc);
    const { runtimeCode } = buildPayload(h, 0, doc.length - 1);
    expect(runtimeCode).toBe('(a1 "synth is great")');
    expect(runtimeCode).not.toMatch(/\(with-state-id/);
  });

  it("does not inject identity for synth-like text inside a comment", () => {
    const doc = '; (synth "osc/sine" :freq 440)\n(synth "osc/sine" :freq 440)\n';
    const h = harness(doc);
    // Whole-doc slice: only the second (top-level, uncommented) form is wrapped.
    const { runtimeCode } = buildPayload(h, 0, doc.length);
    // Exactly one wrapper.
    const matches = runtimeCode.match(/\(with-state-id/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it("does not inject for nested synth (compiler would reject)", () => {
    const doc = '(a1 (synth "osc/sine" :freq 440))\n';
    const h = harness(doc);
    const { runtimeCode } = buildPayload(h, 0, doc.length - 1);
    expect(runtimeCode).toBe('(a1 (synth "osc/sine" :freq 440))');
    expect(runtimeCode).not.toMatch(/\(with-state-id/);
  });

  it("injects for two adjacent top-level synth forms", () => {
    const doc = '(synth "osc/sine" :freq 100)\n(synth "osc/sine" :freq 200)\n';
    const h = harness(doc);
    const { runtimeCode } = buildPayload(h, 0, doc.length);
    const matches = runtimeCode.match(/\(with-state-id/g) ?? [];
    expect(matches).toHaveLength(2);
    // IDs are distinct.
    const ids = entriesOf(h.view.state.field(h.field).map).map((e) => e.id);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) {
      expect(runtimeCode).toContain(`"${id}"`);
    }
  });

  it("does not inject when the slice cuts a synth form in half (temporarily malformed)", () => {
    // The classifier recognises whole top-level forms. Slicing into the
    // middle of a form produces a malformed slice that the parser will
    // not recognise as a complete synth form, so no injection happens.
    const doc = '(synth "osc/sine" :freq 440)\n';
    const h = harness(doc);
    // Slice from middle of `(synth ...` to end. The visible slice does
    // not start with `(`, so it is not a top-level form.
    const midStart = doc.indexOf("osc");
    const { runtimeCode } = buildPayload(h, midStart, doc.length - 1);
    expect(runtimeCode).not.toMatch(/\(with-state-id/);
  });

  it("injects identity only into the top-level form that actually has a sidecar entry", () => {
    const doc = '(a1 1)\n(synth "osc/sine" :freq 440)\n(define foo 2)\n';
    const h = harness(doc);
    const { runtimeCode } = buildPayload(h, 0, doc.length);
    const matches = runtimeCode.match(/\(with-state-id/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it("composes identity injection with manual control on adjacent forms", () => {
    const doc = '(a1 (saw 1))\n(synth "osc/sine" :freq 440 :amp 0.5)\n';
    const h = harness(doc);
    const ampPos = doc.indexOf("0.5");
    const bindings: ManualControlBinding[] = [
      {
        stick: "right", slot: 17, from: ampPos, to: ampPos + 3,
        value: 0, originalText: "0.5", lastSentAt: 0, lastSentValue: 0,
      },
    ];
    const { runtimeCode } = buildPayload(h, 0, doc.length, {
      manualBindings: bindings,
    });
    // Only the synth form is wrapped; the saw form is unchanged.
    const matches = runtimeCode.match(/\(with-state-id/g) ?? [];
    expect(matches).toHaveLength(1);
    // ssin appears inside the wrapped form.
    expect(runtimeCode).toContain("(ssin 17)");
    // The non-stateful saw form is unchanged.
    expect(runtimeCode).toContain("(a1 (saw 1))");
  });
});

describe("Source map invariants", () => {
  it("produces a total runtime range equal to the runtimeCode length", () => {
    const doc = '(synth "osc/sine" :freq 440)\n';
    const h = harness(doc);
    const { runtimeCode, sourceMap } = buildPayload(h, 0, doc.length - 1);
    const sorted = [...sourceMap].sort((a, b) => a.runtime.from - b.runtime.from);
    expect(sorted[0]!.runtime.from).toBe(0);
    expect(sorted[sorted.length - 1]!.runtime.to).toBe(runtimeCode.length);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]!.runtime.from).toBe(sorted[i - 1]!.runtime.to);
    }
  });

  it("preserves relative order of visible ranges within the slice", () => {
    const doc = '(a1 (saw 1))\n(synth "osc/sine" :freq 440)\n';
    const h = harness(doc);
    const { sourceMap } = buildPayload(h, 0, doc.length);
    // Sort by visible.from. Non-generated segments should be in increasing order.
    const nonGen = sourceMap.filter((s) => !s.generated);
    for (let i = 1; i < nonGen.length; i++) {
      expect(nonGen[i]!.visible.from).toBeGreaterThanOrEqual(nonGen[i - 1]!.visible.to);
    }
  });
});
