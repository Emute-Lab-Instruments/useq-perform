import { afterEach, describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { linter } from "@codemirror/lint";
import { diagnosticField, pushDiagnostics, clearDiagnosticsForRange } from "./diagnostics.ts";
import type { UseqDiagnostic } from "../../contracts/runtimeTypes.ts";

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

describe("diagnostics position-mapping across edits (spec §1.6)", () => {
  it("diagnostics move with the text when characters are inserted before them", () => {
    const doc = "(a1 bad)";
    const view = createView(doc);

    const diag: UseqDiagnostic = { start: 4, end: 7, severity: "error", message: "bad" };
    pushDiagnostics(view, [diag], 0, 0, doc.length);

    const before = view.state.field(diagnosticField)[0];
    expect(before).toBeTruthy();

    // Insert 4 chars at the start of the document.
    view.dispatch({ changes: { from: 0, insert: "xxxx" } });

    const after = view.state.field(diagnosticField)[0];
    expect(after.from).toBe(before.from + 4);
    expect(after.to).toBe(before.to + 4);

    view.destroy();
  });

  it("a diagnostic whose entire range is deleted is dropped", () => {
    const doc = "(a1 bad)";
    const view = createView(doc);

    const diag: UseqDiagnostic = { start: 4, end: 7, severity: "error", message: "bad" };
    pushDiagnostics(view, [diag], 0, 0, doc.length);
    const stored = view.state.field(diagnosticField)[0];
    expect(stored).toBeTruthy();

    // Delete exactly the diagnostic's range.
    view.dispatch({ changes: { from: stored.from, to: stored.to } });

    expect(view.state.field(diagnosticField)).toHaveLength(0);

    view.destroy();
  });
});

describe("diagnostics additive merge across evals (spec §1.6)", () => {
  // §1.6: Diagnostics persist per-range until that range is re-evaluated
  // successfully. pushDiagnostics is additive across ranges — diagnostics for
  // range B are not disturbed when range A is pushed.

  it("eval range A then range B — both diagnostics visible simultaneously", () => {
    const aForm = "(a1 bad)";
    const bForm = "(d2 wrong)";
    const doc = aForm + "\n" + bForm;
    const bStart = aForm.length + 1;
    const view = createView(doc);

    const aDiag: UseqDiagnostic = { start: 1, end: 7, severity: "error", message: "range A error" };
    const bDiag: UseqDiagnostic = { start: 1, end: 9, severity: "error", message: "range B error" };

    pushDiagnostics(view, [aDiag], 0, 0, aForm.length);
    pushDiagnostics(view, [bDiag], bStart, bStart, bStart + bForm.length);

    const stored = view.state.field(diagnosticField);
    expect(stored).toHaveLength(2);
    const messages = stored.map((d) => d.message);
    expect(messages).toContain("range A error");
    expect(messages).toContain("range B error");

    view.destroy();
  });

  it("successful re-eval of range A clears A's diagnostic; B's survives", () => {
    const aForm = "(a1 bad)";
    const bForm = "(d2 wrong)";
    const doc = aForm + "\n" + bForm;
    const bStart = aForm.length + 1;
    const view = createView(doc);

    const aDiag: UseqDiagnostic = { start: 1, end: 7, severity: "error", message: "range A error" };
    const bDiag: UseqDiagnostic = { start: 1, end: 9, severity: "error", message: "range B error" };

    pushDiagnostics(view, [aDiag], 0, 0, aForm.length);
    pushDiagnostics(view, [bDiag], bStart, bStart, bStart + bForm.length);

    expect(view.state.field(diagnosticField)).toHaveLength(2);

    // Simulate successful re-eval of range A: clear its diagnostics
    clearDiagnosticsForRange(view, 0, aForm.length);

    const remaining = view.state.field(diagnosticField);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.message).toBe("range B error");

    view.destroy();
  });

  it("multiple diagnostics from a single range A eval are all present alongside B's", () => {
    const aForm = "(a1 bad)";
    const bForm = "(d2 wrong)";
    const doc = aForm + "\n" + bForm;
    const bStart = aForm.length + 1;
    const view = createView(doc);

    const aDiag1: UseqDiagnostic = { start: 1, end: 4, severity: "error", message: "range A error 1" };
    const aDiag2: UseqDiagnostic = { start: 4, end: 7, severity: "warning", message: "range A warning 2" };
    const bDiag: UseqDiagnostic = { start: 1, end: 9, severity: "error", message: "range B error" };

    // Push two diagnostics for range A in a single call
    pushDiagnostics(view, [aDiag1, aDiag2], 0, 0, aForm.length);
    pushDiagnostics(view, [bDiag], bStart, bStart, bStart + bForm.length);

    const stored = view.state.field(diagnosticField);
    // Both A diagnostics plus the B diagnostic must all be present
    expect(stored).toHaveLength(3);
    const messages = stored.map((d) => d.message);
    expect(messages).toContain("range A error 1");
    expect(messages).toContain("range A warning 2");
    expect(messages).toContain("range B error");

    view.destroy();
  });

  it("pushDiagnostics does not replace diagnostics at other ranges (additive across ranges)", () => {
    const aForm = "(a1 bad)";
    const bForm = "(d2 wrong)";
    const cForm = "(s3 broken)";
    const doc = aForm + "\n" + bForm + "\n" + cForm;
    const bStart = aForm.length + 1;
    const cStart = bStart + bForm.length + 1;
    const view = createView(doc);

    const aDiag: UseqDiagnostic = { start: 1, end: 7, severity: "error", message: "range A error" };
    const bDiag: UseqDiagnostic = { start: 1, end: 9, severity: "error", message: "range B error" };
    const cDiag: UseqDiagnostic = { start: 1, end: 11, severity: "warning", message: "range C warning" };

    pushDiagnostics(view, [aDiag], 0, 0, aForm.length);
    expect(view.state.field(diagnosticField)).toHaveLength(1);

    // Pushing to range B must not disturb range A
    pushDiagnostics(view, [bDiag], bStart, bStart, bStart + bForm.length);
    expect(view.state.field(diagnosticField)).toHaveLength(2);

    // Pushing to range C must not disturb A or B
    pushDiagnostics(view, [cDiag], cStart, cStart, cStart + cForm.length);
    expect(view.state.field(diagnosticField)).toHaveLength(3);

    const messages = view.state.field(diagnosticField).map((d) => d.message);
    expect(messages).toContain("range A error");
    expect(messages).toContain("range B error");
    expect(messages).toContain("range C warning");

    view.destroy();
  });
});
