import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { linter } from "@codemirror/lint";
import { diagnosticField, pushDiagnostics, clearDiagnosticsForRange } from "../editors/extensions/diagnostics.ts";
import type { UseqDiagnostic } from "../runtime/wasmInterpreter.ts";

function createView(doc: string): EditorView {
  return new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      extensions: [
        diagnosticField,
        linter(() => []),
      ],
    }),
  });
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("diagnostic offset mapping", () => {
  it("maps a diagnostic at a non-zero docOffset to a document-absolute position", () => {
    const prefix = "(a1 1)\n";
    const form = "(a2 bad-expr)";
    const doc = prefix + form;
    const docOffset = prefix.length;
    const view = createView(doc);

    const diag: UseqDiagnostic = {
      start: 4,
      end: 12,
      severity: "error",
      message: "unknown symbol",
    };

    pushDiagnostics(view, [diag], docOffset, docOffset, docOffset + form.length);

    const stored = view.state.field(diagnosticField);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.from).toBe(docOffset + 4);
    expect(stored[0]?.to).toBe(docOffset + 12);
    expect(stored[0]?.severity).toBe("error");
    expect(stored[0]?.message).toBe("unknown symbol");

    view.destroy();
  });

  it("uses the eval range to cover a {0,0} span diagnostic", () => {
    const prefix = "(a1 1)\n";
    const form = "(a2 bad)";
    const doc = prefix + form;
    const docOffset = prefix.length;
    const view = createView(doc);

    const diag: UseqDiagnostic = {
      start: 0,
      end: 0,
      severity: "error",
      message: "no span",
    };

    pushDiagnostics(view, [diag], docOffset, docOffset, docOffset + form.length);

    const stored = view.state.field(diagnosticField);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.from).toBe(docOffset);
    expect(stored[0]?.to).toBe(docOffset + form.length);

    view.destroy();
  });

  it("uses range-relative positions when docOffset is zero (first form)", () => {
    const doc = "(a1 bad-expr)";
    const view = createView(doc);

    const diag: UseqDiagnostic = {
      start: 4,
      end: 12,
      severity: "warning",
      message: "check this",
    };

    pushDiagnostics(view, [diag], 0, 0, doc.length);

    const stored = view.state.field(diagnosticField);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.from).toBe(4);
    expect(stored[0]?.to).toBe(12);

    view.destroy();
  });

  it("clears diagnostics for a range on successful re-eval", () => {
    const prefix = "(a1 1)\n";
    const form = "(a2 bad)";
    const doc = prefix + form;
    const docOffset = prefix.length;
    const view = createView(doc);

    const diag: UseqDiagnostic = {
      start: 4,
      end: 7,
      severity: "error",
      message: "will be cleared",
    };

    pushDiagnostics(view, [diag], docOffset, docOffset, docOffset + form.length);
    expect(view.state.field(diagnosticField)).toHaveLength(1);

    clearDiagnosticsForRange(view, docOffset, docOffset + form.length);
    expect(view.state.field(diagnosticField)).toHaveLength(0);

    view.destroy();
  });

  it("does not clear diagnostics outside the re-evaled range", () => {
    const form1 = "(a1 bad)";
    const form2 = "(a2 wrong)";
    const doc = form1 + "\n" + form2;
    const form2Start = form1.length + 1;
    const view = createView(doc);

    const diag1: UseqDiagnostic = { start: 4, end: 7, severity: "error", message: "form1 error" };
    const diag2: UseqDiagnostic = { start: 4, end: 9, severity: "error", message: "form2 error" };

    pushDiagnostics(view, [diag1], 0, 0, form1.length);
    pushDiagnostics(view, [diag2], form2Start, form2Start, form2Start + form2.length);
    expect(view.state.field(diagnosticField)).toHaveLength(2);

    clearDiagnosticsForRange(view, 0, form1.length);
    const remaining = view.state.field(diagnosticField);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.message).toBe("form2 error");

    view.destroy();
  });
});
