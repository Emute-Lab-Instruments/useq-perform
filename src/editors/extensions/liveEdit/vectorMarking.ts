/**
 * Vector-mark sub-mode visuals — gii8.38.
 *
 * Renders the per-element preview markers that appear while the editor is in
 * the live-edit `vector-mark` sub-mode (docs/specs/live-edit.md §3.7):
 *
 *   - selected (●)     → solid underline
 *   - deselected (○)   → dotted underline
 *   - non-markable     → no decoration (§3.7.2)
 *   - focused element  → cursor halo (§3.7.7) composed atop the underline
 *
 * Architecture mirrors `holeWidget.ts` and `widgets.ts`:
 *
 *   - StateField holds the current `VectorMarkSession | null`. Pushed in via
 *     a StateEffect from `setVectorMarkSession()`.
 *   - ViewPlugin builds a `DecorationSet` of `Decoration.mark` ranges, one
 *     per element (selected/deselected) plus one halo mark on the focused
 *     element. Non-markable elements emit nothing.
 *   - Theme via `EditorView.baseTheme(...)` with the `.cm-vector-mark-*`
 *     class prefix to avoid clashing with other extensions.
 *
 * NOTE — throwaway / refactor flag: this extension owns the session as a
 * post-mount imperative push (`setVectorMarkSession`) for storybook-first
 * development. When the real sub-mode controller lands (gii8.36), the
 * session source-of-truth should move to the structural dispatcher /
 * mode machine and this file should consume it from there. The decoration
 * builder + theme below is the durable part; only the session-management
 * shim (the StateEffect + setVectorMarkSession) is expected to go away.
 */

import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
} from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import {
  RangeSetBuilder,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
} from "@codemirror/state";

import type {
  VectorMarkElement,
  VectorMarkSession,
} from "../../../contracts/liveEdit.ts";

// ─── State plumbing ──────────────────────────────────────────────────────────

const setSessionEffect = StateEffect.define<VectorMarkSession | null>();

/** Holds the current session, or null when not in the sub-mode. */
export const vectorMarkSessionField = StateField.define<VectorMarkSession | null>({
  create() {
    return null;
  },
  update(session, tr) {
    for (const e of tr.effects) {
      if (e.is(setSessionEffect)) {
        return e.value;
      }
    }
    return session;
  },
});

/** Imperative push API — used by the scenario harness post-mount. */
export function setVectorMarkSession(
  view: EditorView,
  session: VectorMarkSession,
): void {
  view.dispatch({ effects: setSessionEffect.of(session) });
}

/** Imperative clear API — exit the sub-mode. */
export function clearVectorMarkSession(view: EditorView): void {
  view.dispatch({ effects: setSessionEffect.of(null) });
}

// ─── Decoration tokens ───────────────────────────────────────────────────────

const selectedMark = Decoration.mark({
  class: "cm-vector-mark cm-vector-mark--selected",
});
const deselectedMark = Decoration.mark({
  class: "cm-vector-mark cm-vector-mark--deselected",
});
const focusedMark = Decoration.mark({
  class: "cm-vector-mark--focused",
});

// ─── Hint widget (§3.7.8) ────────────────────────────────────────────────────

class VectorMarkHintWidget extends WidgetType {
  toDOM(): HTMLElement {
    const el = document.createElement("div");
    el.className = "cm-vector-mark-hint";
    el.textContent = "Start ✓ · Back ✗ · A toggle · ←/→ navigate";
    el.setAttribute("aria-hidden", "true");
    return el;
  }
  eq(_other: VectorMarkHintWidget): boolean {
    return true;
  }
  ignoreEvent(): boolean {
    return true;
  }
}

const hintWidget = Decoration.widget({
  widget: new VectorMarkHintWidget(),
  side: 1,
  block: true,
});

// ─── Decoration building ─────────────────────────────────────────────────────

interface BuiltDeco {
  from: number;
  to: number;
  deco: Decoration;
}

function buildInlineDecorations(state: EditorState): DecorationSet {
  const session = state.field(vectorMarkSessionField, false);
  if (!session) return Decoration.none;

  const docLen = state.doc.length;
  const out: BuiltDeco[] = [];

  // Underline marks per element (selected / deselected). Skip non-markable.
  session.elements.forEach((el: VectorMarkElement) => {
    if (el.state === "non-markable") return;
    const from = Math.max(0, Math.min(el.range.from, docLen));
    const to = Math.max(0, Math.min(el.range.to, docLen));
    if (to <= from) return;
    out.push({
      from,
      to,
      deco: el.state === "selected" ? selectedMark : deselectedMark,
    });
  });

  // Focus halo on the focused element (composes atop the underline).
  if (
    session.focusIndex >= 0 &&
    session.focusIndex < session.elements.length
  ) {
    const focused = session.elements[session.focusIndex];
    const from = Math.max(0, Math.min(focused.range.from, docLen));
    const to = Math.max(0, Math.min(focused.range.to, docLen));
    if (to > from) {
      out.push({ from, to, deco: focusedMark });
    }
  }

  // RangeSetBuilder requires sorted by `from` then `startSide`. For
  // identical `from` we need the `Decoration.mark` ordering to be stable;
  // sort by from, then by to (longer ranges first), then put the focus
  // mark after the underline so it layers on top.
  out.sort((a, b) => {
    if (a.from !== b.from) return a.from - b.from;
    if (a.to !== b.to) return a.to - b.to;
    // Same range: underlines first, focus second.
    const aFocus = a.deco === focusedMark ? 1 : 0;
    const bFocus = b.deco === focusedMark ? 1 : 0;
    return aFocus - bFocus;
  });

  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to, deco } of out) {
    builder.add(from, to, deco);
  }

  return builder.finish();
}

/**
 * §3.7.8 — single-line block hint at the bottom of the vector.
 *
 * Block decorations may NOT be supplied from a ViewPlugin (CodeMirror throws
 * `RangeError: Block decorations may not be specified via plugins`). It must
 * come from a StateField via `provide`, so it lives here separately from the
 * inline mark/focus decorations.
 *
 * We always render it for the storybook MVP (no idle-fade animation yet); a
 * real implementation gates this on `liveEdit.subModeIdleHintMs`.
 */
function buildHintDecorations(state: EditorState): DecorationSet {
  const session = state.field(vectorMarkSessionField, false);
  if (!session) return Decoration.none;

  const docLen = state.doc.length;
  const vectorTo = Math.max(0, Math.min(session.vectorRange.to, docLen));
  const lineEnd = state.doc.lineAt(vectorTo).to;

  const builder = new RangeSetBuilder<Decoration>();
  builder.add(lineEnd, lineEnd, hintWidget);
  return builder.finish();
}

// ─── ViewPlugin (inline marks) + StateField (block hint) ─────────────────────

const vectorMarkPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildInlineDecorations(view.state);
    }
    update(u: ViewUpdate) {
      const oldSession = u.startState.field(vectorMarkSessionField, false);
      const newSession = u.state.field(vectorMarkSessionField, false);
      if (u.docChanged || oldSession !== newSession) {
        this.decorations = buildInlineDecorations(u.state);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

/**
 * StateField that supplies the block hint decoration. Block decorations must
 * originate from a StateField (not a ViewPlugin), hence the dedicated field.
 */
const vectorMarkHintField = StateField.define<DecorationSet>({
  create(state) {
    return buildHintDecorations(state);
  },
  update(deco, tr) {
    const oldSession = tr.startState.field(vectorMarkSessionField, false);
    const newSession = tr.state.field(vectorMarkSessionField, false);
    if (tr.docChanged || oldSession !== newSession) {
      return buildHintDecorations(tr.state);
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ─── Theme ───────────────────────────────────────────────────────────────────

/**
 * Styling for marker underlines + focus halo + hint line.
 *
 * The selected / deselected underlines use `text-decoration` so they sit
 * naturally beneath the literal glyphs and survive the focus halo without
 * fighting it. The focus halo mirrors the structural cursor halo from
 * `decorations.ts` (light-blue translucent fill + outline + rounded
 * corners) so the two visual systems compose cleanly.
 */
export const vectorMarkTheme = EditorView.baseTheme({
  ".cm-vector-mark": {
    // Common: nudge the underline a hair below the baseline so it doesn't
    // overlap descenders. This is a best-effort default; per-theme
    // overrides can adjust.
    textUnderlineOffset: "3px",
  },
  ".cm-vector-mark--selected": {
    textDecorationLine: "underline",
    textDecorationStyle: "solid",
    textDecorationThickness: "2px",
    textDecorationColor: "rgba(120, 220, 160, 0.95)", // accent green for ●
  },
  ".cm-vector-mark--deselected": {
    textDecorationLine: "underline",
    textDecorationStyle: "dotted",
    textDecorationThickness: "2px",
    textDecorationColor: "rgba(160, 160, 180, 0.65)", // muted for ○
  },
  // Focus halo — matches the structural cursor halo (decorations.ts).
  ".cm-vector-mark--focused": {
    backgroundColor: "rgba(120, 180, 255, 0.35)",
    outline: "1px solid rgba(120, 180, 255, 0.85)",
    borderRadius: "3px",
  },
  // Bottom hint line (§3.7.8). Single line, faded; informational only.
  ".cm-vector-mark-hint": {
    padding: "4px 10px",
    margin: "4px 0 0 0",
    fontSize: "0.78em",
    fontFamily: "inherit",
    color: "rgba(220, 230, 255, 0.55)",
    backgroundColor: "rgba(120, 180, 255, 0.06)",
    borderTop: "1px solid rgba(120, 180, 255, 0.18)",
    letterSpacing: "0.02em",
    userSelect: "none",
    pointerEvents: "none",
  },
});

// ─── Public factory ──────────────────────────────────────────────────────────

/**
 * Bundle the StateField + ViewPlugin + theme into a single extension.
 * Registered in `harness/extension-registry.ts` under `'vector-marking'`.
 */
export function createVectorMarkingExtension(): Extension[] {
  return [
    vectorMarkSessionField,
    vectorMarkHintField,
    vectorMarkPlugin,
    vectorMarkTheme,
  ];
}
