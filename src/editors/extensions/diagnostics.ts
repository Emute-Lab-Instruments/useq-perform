/**
 * CodeMirror diagnostic integration for uSEQ WASM interpreter output.
 *
 * Converts UseqDiagnostic objects (from the WASM interpreter) into
 * CodeMirror Diagnostic objects and dispatches them to the editor.
 *
 * Diagnostics are ADDITIVE — new diagnostics merge with existing ones
 * rather than replacing them. Only clearDiagnosticsForRange() removes
 * diagnostics, and only for the range that was successfully re-evaluated.
 */

import { type Diagnostic, setDiagnostics } from "@codemirror/lint";
import { StateEffect, StateField } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { UseqDiagnostic } from "../../runtime/wasmInterpreter";

/** Maximum number of diagnostics to display per evaluation. */
const MAX_DIAGNOSTICS_PER_EVAL = 5;

// ---------------------------------------------------------------------------
// Persistent diagnostic store (survives across evals)
// ---------------------------------------------------------------------------

/** Effect to add diagnostics for a given eval range. */
const addDiagnosticsEffect = StateEffect.define<{
  docOffset: number;
  diagnostics: UseqDiagnostic[];
  rangeFrom: number;
  rangeTo: number;
}>();

/** Effect to clear diagnostics overlapping a range (on successful eval). */
const clearRangeEffect = StateEffect.define<{
  from: number;
  to: number;
}>();

/** Effect to clear ALL diagnostics. */
const clearAllEffect = StateEffect.define<null>();

interface StoredDiagnostic {
  from: number;
  to: number;
  severity: Diagnostic["severity"];
  message: string;
}

/** State field that accumulates diagnostics across evals. */
export const diagnosticField = StateField.define<StoredDiagnostic[]>({
  create: () => [],
  update(stored, tr) {
    let result = stored;
    for (const effect of tr.effects) {
      if (effect.is(clearAllEffect)) {
        result = [];
      } else if (effect.is(clearRangeEffect)) {
        const { from, to } = effect.value;
        result = result.filter(
          (d) => d.to <= from || d.from >= to,
        );
      } else if (effect.is(addDiagnosticsEffect)) {
        const { docOffset, diagnostics, rangeFrom, rangeTo } = effect.value;
        // First remove old diagnostics for this range
        result = result.filter(
          (d) => d.to <= rangeFrom || d.from >= rangeTo,
        );
        // Then add new ones
        const docLength = tr.state.doc.length;
        const newDiags: StoredDiagnostic[] = diagnostics
          .slice(0, MAX_DIAGNOSTICS_PER_EVAL)
          .map((d) => {
            // If span is {0,0} (no span info), highlight the whole eval range
            const from =
              d.start === 0 && d.end === 0
                ? rangeFrom
                : Math.min(Math.max(d.start + docOffset, 0), docLength);
            const to =
              d.start === 0 && d.end === 0
                ? rangeTo
                : Math.min(Math.max(d.end + docOffset, 0), docLength);
            return {
              from,
              to: Math.max(to, from + 1), // ensure non-zero width
              severity: mapSeverity(d.severity),
              message: formatMessage(d),
            };
          });
        result = [...result, ...newDiags];
      }
    }
    return result;
  },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapSeverity(
  severity: UseqDiagnostic["severity"],
): Diagnostic["severity"] {
  if (severity === "hint") return "info";
  return severity;
}

function formatMessage(d: UseqDiagnostic): string {
  const parts = [d.message];
  if (d.suggestion) parts.push(d.suggestion);
  if (d.example) parts.push(`Example: ${d.example}`);
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Push WASM diagnostics into a CodeMirror editor view.
 *
 * @param docOffset - character offset in the document where the eval'd code starts
 * @param rangeFrom - start of the eval'd range in the document
 * @param rangeTo   - end of the eval'd range in the document
 */
export function pushDiagnostics(
  view: EditorView,
  diagnostics: UseqDiagnostic[],
  docOffset: number = 0,
  rangeFrom: number = 0,
  rangeTo: number = view.state.doc.length,
): void {
  view.dispatch({
    effects: addDiagnosticsEffect.of({
      docOffset,
      diagnostics,
      rangeFrom,
      rangeTo,
    }),
  });

  // Sync the stored diagnostics to CodeMirror's lint layer
  syncToLintLayer(view);
}

/**
 * Clear diagnostics for a specific range (call on successful eval of that range).
 */
export function clearDiagnosticsForRange(
  view: EditorView,
  from: number,
  to: number,
): void {
  view.dispatch({ effects: clearRangeEffect.of({ from, to }) });
  syncToLintLayer(view);
}

/**
 * Clear all diagnostics from a CodeMirror editor view.
 */
export function clearDiagnostics(view: EditorView): void {
  view.dispatch({ effects: clearAllEffect.of(null) });
  syncToLintLayer(view);
}

/**
 * Sync our stored diagnostics to CodeMirror's lint display layer.
 */
function syncToLintLayer(view: EditorView): void {
  const stored = view.state.field(diagnosticField);
  const cmDiags: Diagnostic[] = stored.map((d) => ({
    from: d.from,
    to: d.to,
    severity: d.severity,
    message: d.message,
  }));
  view.dispatch(setDiagnostics(view.state, cmDiags));
}
