/**
 * Unified visible-to-runtime eval payload builder and source map.
 *
 * Spec: docs/specs/state-identity.md §6 (source surface), §7.4 (eval-time
 * rewriting is tree-aware), §7.5 (runtime diagnostics must map back to
 * visible source ranges), §12.4 (hidden injected syntax must not create
 * confusing diagnostic positions).
 *
 * One payload builder is used by every editor evaluation entry point
 * (toplevel / expression / soft). It composes:
 *
 *   1. **Hidden identity injection** (tree-aware): walks the visible
 *      slice's parse tree, recognises stateful top-level forms whose
 *      ranges fit inside the slice, and wraps each one in
 *      `(with-state-id "<id>" <form>)` — state-identity.md §6.3.
 *      Explicit `:id` and existing `with-state-id` wrappers are honoured
 *      and never re-wrapped (§6.6).
 *
 *   2. **Manual-control rewrite** (text-level): substitutes bound ranges
 *      (e.g. `(ssin N)`) into the identity-injected payload. The
 *      substitution is purely positional; the source map records each
 *      substitution as a "generated" segment anchored to the host form's
 *      bounded visible range.
 *
 * The result is a single {@link EvalPayload} containing the runtime code
 * and a {@link SourceMap} that can translate any runtime offset back to a
 * bounded visible offset. {@link remapDiagnostics} consumes the source
 * map to anchor WASM and hardware diagnostics to meaningful visible
 * source ranges (VAL-ID-017, VAL-ID-018).
 *
 * This module is dependency-light. It imports the state-identity core
 * types/helpers and CodeMirror's syntax tree via the supplied
 * {@link EditorState}. It never touches runtime singletons, the WASM
 * worker, or transport.
 */

import type { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";

import type { IdentityMap } from "./identityTypes.ts";
import { getByKey } from "./identityMapState.ts";

// ─── Public types ──────────────────────────────────────────────────────────

/**
 * Origin of an evaluation request. The payload builder treats every
 * origin the same (VAL-ID-016); this field is exposed for telemetry and
 * future hooks but does not change the rewrite or source-map shape.
 */
export type EvalPayloadSource = "toplevel" | "expression" | "soft" | "external";

/**
 * One manual-control binding that may apply to a payload. Mirrors the
 * fields used by {@link rewriteCodeSliceForModule} in
 * `src/lib/manualControlState.ts`, expressed here as a plain data type
 * so this module does not import the manual-control singleton.
 */
export interface ManualControlBinding {
  readonly stick: "left" | "right";
  readonly slot: number;
  /** Inclusive document range of the bound text, in DOCUMENT coordinates. */
  readonly from: number;
  readonly to: number;
  readonly value: number;
  readonly originalText: string;
  readonly lastSentAt: number;
  readonly lastSentValue: number;
}

/** Inclusive character range `[from, to]`. */
interface Range {
  readonly from: number;
  readonly to: number;
}

/**
 * One segment of the visible-to-runtime source map.
 *
 * Each segment maps a runtime code range to a visible slice range and
 * declares whether the runtime text was generated (e.g. identity wrapper
 * head, manual-control substitution) or copied verbatim from the visible
 * source. Generated segments carry a bounded visible range anchored to
 * the host form so diagnostics can still be reported meaningfully.
 */
export interface SourceMapSegment {
  /** Range in the runtime code (0-based within `runtimeCode`). */
  readonly runtime: Range;
  /**
   * Range in the visible slice (0-based within `visibleSlice`). For
   * generated segments, this is a bounded anchor on the host form (the
   * owning form's visible range), NOT the source of the generated text
   * (there is no such source by definition).
   */
  readonly visible: Range;
  /**
   * True if the runtime text in this segment was injected (not present
   * in the visible source). Used by {@link remapDiagnostics} to anchor
   * generated-syntax diagnostics to the host form's visible range.
   */
  readonly generated: boolean;
}

/** Final eval payload consumed by every eval entry point. */
export interface EvalPayload {
  /** Visible source slice (unchanged). */
  readonly visibleSlice: string;
  /** Runtime code with identity + manual-control rewrites applied. */
  readonly runtimeCode: string;
  /** Visible↔runtime source map. */
  readonly sourceMap: ReadonlyArray<SourceMapSegment>;
  /**
   * Document offset where the visible slice begins. Diagnostics
   * returned by the runtime are remapped back to DOCUMENT coordinates
   * using `sliceFrom + visible.from`.
   */
  readonly sliceFrom: number;
  /** The originating entry point (telemetry only). */
  readonly source: EvalPayloadSource;
}

/** Inputs to {@link buildEvalPayload}. */
export interface BuildEvalPayloadInput {
  /** Visible source slice (typically `state.doc.sliceString(from, to)`). */
  readonly visibleSlice: string;
  /** Document offset where the slice begins. */
  readonly sliceFrom: number;
  /** Live identity map from the state-identity sidecar. */
  readonly identityMap: IdentityMap;
  /** CodeMirror editor state (for syntax-tree access). */
  readonly state: EditorState;
  /** Manual-control bindings that may apply to this payload. */
  readonly manualBindings?: ReadonlyArray<ManualControlBinding>;
  /** Origin of the eval. */
  readonly source?: EvalPayloadSource;
}

// ─── Identity-injection helpers ────────────────────────────────────────────

/**
 * A top-level form in the slice that should receive identity injection,
 * with its sidecar ID (if any) and whether the user already supplied an
 * explicit identity.
 */
interface SliceForm {
  /** Range in VISIBLE-SLICE coordinates (0-based within `visibleSlice`). */
  readonly sliceRange: Range;
  /** Range in DOCUMENT coordinates. */
  readonly docRange: Range;
  /** Sidecar ID for this form, if recognised as stateful. */
  readonly id?: string;
  /** True if the user already wrote `:id` or wrapped in `with-state-id`. */
  readonly explicitId: boolean;
}

/**
 * Inspect a top-level List node representing a synth form and decide
 * whether it already carries an explicit identity (`:id "…"` keyword).
 *
 * We avoid a full Lisp parse here — the classifier already accepted the
 * node as a top-level list with head `synth`. We walk immediate children
 * looking for the keyword token `:id` followed by a string literal.
 */
function formHasExplicitId(
  state: EditorState,
  listNode: SyntaxNode,
): boolean {
  let prevWasIdKeyword = false;
  for (let c = listNode.firstChild; c; c = c.nextSibling) {
    const name = c.type.name;
    if (name === "(" || name === ")" || name === "[") continue;
    if (name === "⚠" || name === "ERROR" || name === "Error") continue;
    const text = state.doc.sliceString(c.from, c.to);
    if (prevWasIdKeyword) {
      // The value following `:id`. Accept any non-empty atom/string as
      // evidence of an explicit identity. We do not need to validate the
      // value's shape — that is the compiler's job.
      if (text.length > 0) return true;
      prevWasIdKeyword = false;
      continue;
    }
    if (text === ":id") {
      prevWasIdKeyword = true;
    }
  }
  return false;
}

/**
 * Detect whether a form is already wrapped in `with-state-id`. The
 * classifier only recognises top-level `synth` forms, so this is only
 * relevant when the user has written the wrapper by hand and we still
 * recognise the inner synth (in which case the classifier would have
 * returned null). Kept as a defensive check.
 */
function _isWithStateIdWrapper(headText: string): boolean {
  return headText === "with-state-id";
}

/**
 * Walk the editor tree, finding top-level stateful forms (today:
 * `(synth …)`) whose range lies fully inside `[sliceFromDoc,
 * sliceToDoc]`. For each, determine its sidecar ID and whether the user
 * already supplied an explicit identity.
 *
 * The walk is performed in DOCUMENT coordinates; results are translated
 * to slice-relative ranges by the caller.
 */
function recogniseSliceForms(
  state: EditorState,
  identityMap: IdentityMap,
  sliceFromDoc: number,
  sliceToDoc: number,
): SliceForm[] {
  const out: SliceForm[] = [];
  const root = syntaxTree(state).topNode;
  let childIndex = 0;
  for (let topChild = root.firstChild; topChild; topChild = topChild.nextSibling) {
    if (topChild.type.name === "List") {
      const headNode = firstLogicalChild(topChild);
      if (headNode !== null) {
        const headText = state.doc.sliceString(headNode.from, headNode.to);
        if (headText === "synth") {
          // Top-level only.
          const parent = topChild.parent;
          if (parent !== null && parent.type.name === "Program") {
            const docRange = { from: topChild.from, to: topChild.to };
            // Form must lie fully inside the slice. We accept forms
            // whose range is a subset of `[sliceFromDoc, sliceToDoc]`.
            // Partial overlaps (slice cuts the form in half) are
            // skipped — VAL-ID-022: temporarily malformed editing
            // syntax never receives injection.
            if (
              docRange.from >= sliceFromDoc &&
              docRange.to <= sliceToDoc
            ) {
              // Has explicit :id keyword?
              const explicitId = formHasExplicitId(state, topChild);
              // Lookup sidecar entry by structural key. The classifier
              // uses the same childIndex assignment, so this matches.
              const entry = getByKey(identityMap, [childIndex]);
              out.push({
                sliceRange: {
                  from: docRange.from - sliceFromDoc,
                  to: docRange.to - sliceFromDoc,
                },
                docRange,
                id: entry?.id,
                explicitId,
              });
            }
          }
        } else if (_isWithStateIdWrapper(headText)) {
          // Hand-written with-state-id wrapper at top level. The
          // classifier does not register a sidecar entry for these,
          // and we must not re-wrap. Record it as explicit-id so the
          // builder leaves it alone.
          const docRange = { from: topChild.from, to: topChild.to };
          if (
            docRange.from >= sliceFromDoc &&
            docRange.to <= sliceToDoc
          ) {
            out.push({
              sliceRange: {
                from: docRange.from - sliceFromDoc,
                to: docRange.to - sliceFromDoc,
              },
              docRange,
              id: undefined,
              explicitId: true,
            });
          }
        }
      }
    }
    // Advance childIndex for every top-level form encountered, matching
    // the classifier's index assignment in identityClassify.ts.
    childIndex++;
  }
  return out;
}

/** First non-punctuation, non-error child of a List node. */
function firstLogicalChild(listNode: SyntaxNode): SyntaxNode | null {
  for (let c = listNode.firstChild; c; c = c.nextSibling) {
    const name = c.type.name;
    if (name === "(" || name === ")" || name === "[") continue;
    if (name === "⚠" || name === "ERROR" || name === "Error") continue;
    return c;
  }
  return null;
}

// ─── Source-map composition ────────────────────────────────────────────────

/**
 * Apply identity injection to `visibleSlice`, producing an intermediate
 * runtime string + source map. The source map's runtime ranges are
 * relative to the intermediate runtime string; the visible ranges are
 * relative to `visibleSlice`.
 *
 * Identity injection wraps each recognised stateful form (with a sidecar
 * id and no explicit user id) in:
 *
 *   (with-state-id "<id>" <original-form>)
 *
 * The wrapper has two parts: a **head** (`(with-state-id "<id>" `) and
 * a **tail** (`)`). Both are "generated" segments anchored to the host
 * form's visible range so that diagnostics inside them map back to a
 * bounded visible range. The original form text is a verbatim segment.
 */
function injectIdentity(
  visibleSlice: string,
  forms: ReadonlyArray<SliceForm>,
): { runtime: string; segments: SourceMapSegment[] } {
  if (forms.length === 0) {
    return {
      runtime: visibleSlice,
      segments: [
        {
          runtime: { from: 0, to: visibleSlice.length },
          visible: { from: 0, to: visibleSlice.length },
          generated: false,
        },
      ],
    };
  }

  // Sort forms by slice-from so we can walk the slice in order.
  const sortedForms = [...forms].sort((a, b) => a.sliceRange.from - b.sliceRange.from);

  const segments: SourceMapSegment[] = [];
  let runtimeOut = "";
  let visCursor = 0;

  for (const form of sortedForms) {
    // 1. Verbatim segment from visCursor up to the form start.
    if (form.sliceRange.from > visCursor) {
      const sliceText = visibleSlice.slice(visCursor, form.sliceRange.from);
      const start = runtimeOut.length;
      runtimeOut += sliceText;
      segments.push({
        runtime: { from: start, to: runtimeOut.length },
        visible: { from: visCursor, to: form.sliceRange.from },
        generated: false,
      });
    }

    // 2. Decide whether to wrap.
    const shouldWrap = !form.explicitId && form.id !== undefined;
    const formText = visibleSlice.slice(form.sliceRange.from, form.sliceRange.to);

    if (shouldWrap) {
      // Generated head.
      const head = `(with-state-id "${form.id}" `;
      const headStart = runtimeOut.length;
      runtimeOut += head;
      segments.push({
        runtime: { from: headStart, to: runtimeOut.length },
        visible: { from: form.sliceRange.from, to: form.sliceRange.to },
        generated: true,
      });

      // Original form text (verbatim).
      const formStart = runtimeOut.length;
      runtimeOut += formText;
      segments.push({
        runtime: { from: formStart, to: runtimeOut.length },
        visible: { from: form.sliceRange.from, to: form.sliceRange.to },
        generated: false,
      });

      // Generated tail.
      const tailStart = runtimeOut.length;
      runtimeOut += ")";
      segments.push({
        runtime: { from: tailStart, to: runtimeOut.length },
        visible: { from: form.sliceRange.from, to: form.sliceRange.to },
        generated: true,
      });
    } else {
      // No wrap: emit the form verbatim.
      const start = runtimeOut.length;
      runtimeOut += formText;
      segments.push({
        runtime: { from: start, to: runtimeOut.length },
        visible: { from: form.sliceRange.from, to: form.sliceRange.to },
        generated: false,
      });
    }

    visCursor = form.sliceRange.to;
  }

  // 3. Trailing verbatim segment after the last form.
  if (visCursor < visibleSlice.length) {
    const sliceText = visibleSlice.slice(visCursor);
    const start = runtimeOut.length;
    runtimeOut += sliceText;
    segments.push({
      runtime: { from: start, to: runtimeOut.length },
      visible: { from: visCursor, to: visibleSlice.length },
      generated: false,
    });
  }

  return { runtime: runtimeOut, segments };
}

/**
 * Apply manual-control substitutions to an identity-injected runtime
 * string. Each binding whose document range lies within the slice
 * becomes a `(ssin N)` substitution.
 *
 * Bindings are expressed in DOCUMENT coordinates. We translate them to
 * RUNTIME coordinates by walking the prior source map: each visible
 * range maps 1:1 to a runtime range (for non-generated segments). We
 * find the runtime substring covered by the binding's visible range
 * and replace it with `(ssin N)`, marking the substituted segment as
 * generated.
 *
 * Composition invariant: each manual substitution is wholly contained
 * inside a single non-generated segment. Bindings that cross generated
 * regions or form boundaries are skipped (they cannot be honoured
 * safely).
 */
function applyManualBindings(
  runtime: string,
  priorSegments: ReadonlyArray<SourceMapSegment>,
  bindings: ReadonlyArray<ManualControlBinding>,
  sliceFromDoc: number,
): { runtime: string; segments: SourceMapSegment[] } {
  if (bindings.length === 0) {
    return { runtime, segments: [...priorSegments] };
  }

  // Filter to bindings that fall inside the slice's document range and
  // sort by visible-from descending so we can substitute right-to-left
  // without shifting offsets of pending substitutions. Substitutions
  // themselves are applied in a second pass below that walks segments
  // left-to-right.
  const maxVisibleTo = priorSegments.reduce(
    (m, s) => Math.max(m, s.visible.to),
    0,
  );
  const sliceToDoc = sliceFromDoc + maxVisibleTo;

  const applicable = bindings
    .filter((b) => b.from >= sliceFromDoc && b.to <= sliceToDoc)
    .map((b) => ({
      binding: b,
      visFrom: b.from - sliceFromDoc,
      visTo: b.to - sliceFromDoc,
    }))
    .filter((x) => x.visTo > x.visFrom)
    .sort((a, b) => b.visFrom - a.visFrom);

  if (applicable.length === 0) {
    return { runtime, segments: [...priorSegments] };
  }

  // Build a fresh segment list. We work in visible-slice coordinates
  // first, then rebuild runtime text and runtime ranges in one pass.
  //
  // Strategy: rebuild the runtime string from scratch by walking the
  // prior segments in order, but whenever a manual binding covers the
  // segment's visible range, replace the runtime text with `(ssin N)`.
  // A binding is "applied" to a segment iff the binding's visible range
  // equals a sub-range of that segment's visible range AND the segment
  // is non-generated (so we have a reliable 1:1 visible↔runtime mapping
  // inside it).

  const newSegments: SourceMapSegment[] = [];
  let newRuntime = "";

  for (const seg of priorSegments) {
    if (seg.generated) {
      // Generated segment: copy verbatim.
      const runtimeText = runtime.slice(seg.runtime.from, seg.runtime.to);
      const start = newRuntime.length;
      newRuntime += runtimeText;
      newSegments.push({
        runtime: { from: start, to: newRuntime.length },
        visible: seg.visible,
        generated: true,
      });
      continue;
    }

    // Non-generated segment: walk visible range, applying any binding
    // whose visible range overlaps this segment.
    let visCursor = seg.visible.from;
    const segRuntimeText = runtime.slice(seg.runtime.from, seg.runtime.to);
    // Visible and runtime ranges have equal length for non-generated
    // segments (they are verbatim copies). Sanity:
    // seg.visible.to - seg.visible.from === segRuntimeText.length.
    const visLen = seg.visible.to - seg.visible.from;
    // Defensive: if this ever fails, fall back to copying verbatim.
    if (segRuntimeText.length !== visLen) {
      const start = newRuntime.length;
      newRuntime += segRuntimeText;
      newSegments.push({
        runtime: { from: start, to: newRuntime.length },
        visible: seg.visible,
        generated: false,
      });
      continue;
    }

    // Find bindings that fall wholly inside [seg.visible.from, seg.visible.to].
    const inside = applicable
      .filter((x) => x.visFrom >= seg.visible.from && x.visTo <= seg.visible.to)
      .sort((a, b) => a.visFrom - b.visFrom);

    for (const x of inside) {
      // Verbatim portion from visCursor up to the binding start.
      if (x.visFrom > visCursor) {
        const localFrom = visCursor - seg.visible.from;
        const localTo = x.visFrom - seg.visible.from;
        const text = segRuntimeText.slice(localFrom, localTo);
        const start = newRuntime.length;
        newRuntime += text;
        newSegments.push({
          runtime: { from: start, to: newRuntime.length },
          visible: { from: visCursor, to: x.visFrom },
          generated: false,
        });
      }
      // Substitution: anchor to the binding's visible range, mark generated.
      const replacement = `(ssin ${x.binding.slot})`;
      const start = newRuntime.length;
      newRuntime += replacement;
      newSegments.push({
        runtime: { from: start, to: newRuntime.length },
        visible: { from: x.visFrom, to: x.visTo },
        generated: true,
      });
      visCursor = x.visTo;
    }

    // Trailing verbatim portion of the segment.
    if (visCursor < seg.visible.to) {
      const localFrom = visCursor - seg.visible.from;
      const text = segRuntimeText.slice(localFrom);
      const start = newRuntime.length;
      newRuntime += text;
      newSegments.push({
        runtime: { from: start, to: newRuntime.length },
        visible: { from: visCursor, to: seg.visible.to },
        generated: false,
      });
    }
  }

  return { runtime: newRuntime, segments: newSegments };
}

// ─── Public entry points ───────────────────────────────────────────────────

/**
 * Build the unified eval payload from a visible slice.
 *
 * Composition order: identity injection (tree-aware) → manual-control
 * substitution (text-level on the injected payload). The source map
 * composes the two stages into one {@link SourceMapSegment} list.
 */
export function buildEvalPayload(input: BuildEvalPayloadInput): EvalPayload {
  const {
    visibleSlice,
    sliceFrom,
    identityMap,
    state,
    manualBindings = [],
    source = "toplevel",
  } = input;

  // 1. Tree-aware identity injection.
  const sliceToDoc = sliceFrom + visibleSlice.length;
  const forms = recogniseSliceForms(state, identityMap, sliceFrom, sliceToDoc);
  const injected = injectIdentity(visibleSlice, forms);

  // 2. Manual-control substitution.
  const composed = applyManualBindings(
    injected.runtime,
    injected.segments,
    manualBindings,
    sliceFrom,
  );

  return {
    visibleSlice,
    runtimeCode: composed.runtime,
    sourceMap: composed.segments,
    sliceFrom,
    source,
  };
}

// ─── Diagnostic remapping ──────────────────────────────────────────────────

/**
 * Remap a list of runtime-coordinate diagnostics back to visible
 * document coordinates using a source map.
 *
 * Rules (state-identity.md §7.5, §12.4):
 *   - Diagnostics that fall wholly inside a non-generated segment map
 *     1:1 to visible offsets (plus `sliceFromDoc` to get document coords).
 *   - Diagnostics that fall wholly or partly inside a generated segment
 *     anchor to that segment's bounded visible range. The visible range
 *     is the host form's range, clamped to the diagnostic's overlap.
 *   - Diagnostics that span multiple segments anchor to the union of
 *     their non-generated visible ranges, or — if no non-generated
 *     range is covered — to the nearest host form's visible range.
 *
 * Hidden IDs never appear in remapped diagnostics (the runtime id text
 * lives only in generated segments, whose visible anchor is the host
 * form, not the id literal).
 */
export function remapDiagnostics(
  diagnostics: ReadonlyArray<UseqDiagnosticLike>,
  sourceMap: ReadonlyArray<SourceMapSegment>,
  sliceFromDoc: number,
): Array<Omit<UseqDiagnosticLike, "start" | "end"> & { start: number; end: number }> {
  return diagnostics.map((d) => {
    const mapped = remapRange(d.start, d.end, sourceMap);
    return {
      ...d,
      start: mapped.from + sliceFromDoc,
      end: mapped.to + sliceFromDoc,
    };
  });
}

/**
 * Minimal diagnostic shape consumed by the remapper. We accept the
 * project's `UseqDiagnostic` directly.
 */
interface UseqDiagnosticLike {
  readonly start: number;
  readonly end: number;
  readonly severity: "error" | "warning" | "info" | "hint";
  readonly message: string;
  readonly suggestion?: string;
  readonly example?: string;
}

/**
 * Map a single runtime range to a bounded visible range using the
 * source map. Always returns a non-empty range (from < to) anchored
 * inside the visible slice.
 */
function remapRange(
  runtimeFrom: number,
  runtimeTo: number,
  sourceMap: ReadonlyArray<SourceMapSegment>,
): Range {
  if (sourceMap.length === 0) {
    return { from: 0, to: 0 };
  }

  // Find segments that overlap [runtimeFrom, runtimeTo].
  const overlapping = sourceMap.filter(
    (s) => s.runtime.from < runtimeTo && s.runtime.to > runtimeFrom,
  );

  if (overlapping.length === 0) {
    // No overlap: clamp to the nearest segment edge.
    // Pick the segment whose runtime range is closest to runtimeFrom.
    let nearest = sourceMap[0]!;
    let bestDist = Math.abs(sourceMap[0]!.runtime.from - runtimeFrom);
    for (const s of sourceMap) {
      const d = Math.min(
        Math.abs(s.runtime.from - runtimeFrom),
        Math.abs(s.runtime.to - runtimeFrom),
      );
      if (d < bestDist) {
        bestDist = d;
        nearest = s;
      }
    }
    return { from: nearest.visible.from, to: nearest.visible.to };
  }

  // For each overlapping segment, compute the visible-range contribution.
  // For non-generated segments, we can map the runtime subrange 1:1
  // (runtime offset within segment == visible offset within segment
  // because non-generated segments are verbatim copies).
  //
  // For generated segments, the visible anchor is the whole host-form
  // visible range. We do not try to sub-offset within generated text
  // because there is no meaningful visible position for it.
  let visFrom = Number.MAX_SAFE_INTEGER;
  let visTo = 0;
  let anyNonGenerated = false;
  for (const seg of overlapping) {
    if (seg.generated) {
      // Anchor to the whole host-form visible range.
      visFrom = Math.min(visFrom, seg.visible.from);
      visTo = Math.max(visTo, seg.visible.to);
      continue;
    }
    anyNonGenerated = true;
    // Map runtimeFrom/runtimeTo into this segment's visible range.
    const localFrom = Math.max(0, runtimeFrom - seg.runtime.from);
    const localTo = Math.min(
      seg.runtime.to - seg.runtime.from,
      runtimeTo - seg.runtime.from,
    );
    visFrom = Math.min(visFrom, seg.visible.from + localFrom);
    visTo = Math.max(visTo, seg.visible.from + localTo);
  }

  if (!anyNonGenerated) {
    // All overlapping segments are generated: anchor to the union of
    // their visible ranges (which is the host form's range). This is
    // already what the loop above produced.
  }

  // If the mapping collapsed (e.g. runtimeFrom === runtimeTo), widen it
  // to at least one character inside the host form.
  if (visTo <= visFrom) {
    const fallback = overlapping[0]!.visible;
    visFrom = fallback.from;
    visTo = Math.max(fallback.from + 1, fallback.to);
  }

  return { from: visFrom, to: visTo };
}

// ─── Utilities for callers ─────────────────────────────────────────────────

/**
 * Convert a runtime offset back to a visible-slice offset. Returns
 * `null` if the offset falls outside the runtime code or inside a
 * purely generated region with no visible anchor (use
 * {@link remapRange} for that case).
 */
export function runtimeOffsetToVisible(
  runtimeOffset: number,
  sourceMap: ReadonlyArray<SourceMapSegment>,
): number | null {
  for (const seg of sourceMap) {
    if (runtimeOffset >= seg.runtime.from && runtimeOffset <= seg.runtime.to) {
      if (seg.generated) return seg.visible.from;
      return seg.visible.from + (runtimeOffset - seg.runtime.from);
    }
  }
  return null;
}

/**
 * Convert a visible-slice offset to a runtime offset. Returns `null`
 * if the offset falls inside a region that was replaced by a manual
 * control substitution (no canonical runtime offset exists for it).
 */
export function visibleOffsetToRuntime(
  visibleOffset: number,
  sourceMap: ReadonlyArray<SourceMapSegment>,
): number | null {
  for (const seg of sourceMap) {
    if (visibleOffset >= seg.visible.from && visibleOffset <= seg.visible.to) {
      if (seg.generated) {
        // Inside a manual substitution: no canonical runtime offset.
        // (Identity-wrapper generated segments still cover the original
        // form via a separate non-generated segment, so this only
        // affects manual substitutions.)
        if (isManualControlSegment(seg, sourceMap)) return null;
        return seg.runtime.from;
      }
      return seg.runtime.from + (visibleOffset - seg.visible.from);
    }
  }
  return null;
}

/**
 * Heuristic: a generated segment is a manual-control substitution iff
 * there is no other non-generated segment sharing its visible range
 * (identity-wrapper heads/tails coexist with the verbatim form segment).
 */
function isManualControlSegment(
  seg: SourceMapSegment,
  sourceMap: ReadonlyArray<SourceMapSegment>,
): boolean {
  for (const other of sourceMap) {
    if (other === seg) continue;
    if (
      !other.generated &&
      other.visible.from === seg.visible.from &&
      other.visible.to === seg.visible.to
    ) {
      return false; // identity wrapper
    }
  }
  return true;
}

// Re-export the types callers need.
export type { UseqDiagnosticLike };
