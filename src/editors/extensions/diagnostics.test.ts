import { afterEach, describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { linter } from "@codemirror/lint";
import { diagnosticField, pushDiagnostics, clearDiagnosticsForRange } from "./diagnostics.ts";
import type { UseqDiagnostic } from "../../runtime/wasmInterpreter.ts";

function createView(doc: string): EditorView {
  return new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      extensions: [diagnosticField, linter(() => [])],
    }),
  });
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("diagnostics clear-scoping: per-output, not per-document", () => {
  it("clearing the a1 range leaves d2 diagnostics intact", () => {
    const a1Form = "(a1 bad)";
    const d2Form = "(d2 wrong)";
    const doc = a1Form + "\n" + d2Form;
    const d2Start = a1Form.length + 1;
    const view = createView(doc);

    const a1Diag: UseqDiagnostic = { start: 1, end: 7, severity: "error", message: "a1 error" };
    const d2Diag: UseqDiagnostic = { start: 1, end: 9, severity: "error", message: "d2 error" };

    pushDiagnostics(view, [a1Diag], 0, 0, a1Form.length);
    pushDiagnostics(view, [d2Diag], d2Start, d2Start, d2Start + d2Form.length);

    expect(view.state.field(diagnosticField)).toHaveLength(2);

    clearDiagnosticsForRange(view, 0, a1Form.length);

    const remaining = view.state.field(diagnosticField);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.message).toBe("d2 error");

    view.destroy();
  });

  it("clearing the d2 range leaves a1 diagnostics intact", () => {
    const a1Form = "(a1 bad)";
    const d2Form = "(d2 wrong)";
    const doc = a1Form + "\n" + d2Form;
    const d2Start = a1Form.length + 1;
    const view = createView(doc);

    const a1Diag: UseqDiagnostic = { start: 1, end: 7, severity: "error", message: "a1 error" };
    const d2Diag: UseqDiagnostic = { start: 1, end: 9, severity: "error", message: "d2 error" };

    pushDiagnostics(view, [a1Diag], 0, 0, a1Form.length);
    pushDiagnostics(view, [d2Diag], d2Start, d2Start, d2Start + d2Form.length);

    expect(view.state.field(diagnosticField)).toHaveLength(2);

    clearDiagnosticsForRange(view, d2Start, d2Start + d2Form.length);

    const remaining = view.state.field(diagnosticField);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.message).toBe("a1 error");

    view.destroy();
  });

  it("both outputs error then both clear independently", () => {
    const a1Form = "(a1 bad)";
    const d2Form = "(d2 wrong)";
    const doc = a1Form + "\n" + d2Form;
    const d2Start = a1Form.length + 1;
    const view = createView(doc);

    const a1Diag: UseqDiagnostic = { start: 1, end: 7, severity: "error", message: "a1 error" };
    const d2Diag: UseqDiagnostic = { start: 1, end: 9, severity: "error", message: "d2 error" };

    pushDiagnostics(view, [a1Diag], 0, 0, a1Form.length);
    pushDiagnostics(view, [d2Diag], d2Start, d2Start, d2Start + d2Form.length);

    clearDiagnosticsForRange(view, 0, a1Form.length);
    expect(view.state.field(diagnosticField)).toHaveLength(1);

    clearDiagnosticsForRange(view, d2Start, d2Start + d2Form.length);
    expect(view.state.field(diagnosticField)).toHaveLength(0);

    view.destroy();
  });
});
