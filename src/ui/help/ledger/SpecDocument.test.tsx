/**
 * Spec document rendering (engine-ledger.md §2.2–§2.4).
 */

import { render, screen, fireEvent } from "@solidjs/testing-library";
import { describe, it, expect, vi } from "vitest";

// The real editor pulls in the whole CodeMirror extension stack; the property
// under test is that code fences mount a *read-only, probe-free* editor
// (editor.md §1.14), so record the props instead.
const editorProps: Record<string, unknown>[] = [];
vi.mock("../CodeMirrorEditor", () => ({
  CodeMirrorEditor: (props: Record<string, unknown>) => {
    editorProps.push(props);
    return <div data-testid="cm-editor" data-readonly={String(props.readOnly)}>{String(props.code)}</div>;
  },
}));

import { SpecDocument, clauseAnchorId } from "./SpecDocument";
import type { SpecDocument as SpecDocumentData } from "../../../lib/witness/loader.ts";

const DOC: SpecDocumentData = {
  file: "compilation.md",
  title: "Compilation",
  clauses: ["1", "1.3", "1.4"],
  blocks: [
    { kind: "heading", depth: 2, text: "1. Frame", id: "clause-1", clause: "1" },
    {
      kind: "prose",
      clause: "1.3",
      clauseOpener: true,
      id: "clause-1.3",
      html: '<p>1.3 See <a href="#" data-ledger-spec="time.md" data-ledger-clause="2.2">time.md</a> and <a href="#" data-ledger-unresolved="../../x.md">elsewhere</a>.</p>',
    },
    { kind: "code", clause: "1.3", lang: "lisp", code: "(a1 (fast 2 t))" },
    { kind: "prose", clause: "1.4", clauseOpener: true, id: "clause-1.4", html: "<p>1.4 Uncited clause.</p>" },
    { kind: "rule", clause: null },
  ],
};

function renderDoc(overrides: Partial<Parameters<typeof SpecDocument>[0]> = {}) {
  const props = {
    doc: DOC,
    witnessNamesForClause: (clause: string) => (clause === "1.3" ? ["alpha", "beta"] : []),
    verdictForClause: (clause: string) => (clause === "1.3" ? ("fail" as const) : ("none" as const)),
    onRunClause: vi.fn(),
    onInspectClause: vi.fn(),
    onNavigate: vi.fn(),
    ...overrides,
  };
  const utils = render(() => <SpecDocument {...props} />);
  return { ...utils, props };
}

describe("clauseAnchorId", () => {
  it("builds the anchor form the spec names (§2.2)", () => {
    expect(clauseAnchorId("compilation.md", "1.3")).toBe("compilation-1.3");
  });
});

describe("SpecDocument", () => {
  it("gives each clause an addressable anchor", () => {
    const { container } = renderDoc();
    // The `N.N` anchor form is specified literally by §2.2, so it contains a
    // dot; `getElementById` (what the Ledger uses to scroll) handles it, CSS
    // selectors need it escaped.
    const ids = [...container.querySelectorAll("[id]")].map((el) => el.id);
    expect(ids).toContain("compilation-1.3");
    expect(ids).toContain("compilation-1.4");
  });

  it("badges a clause with witnesses using its aggregate verdict (§2.4/§3.1)", () => {
    const { container } = renderDoc();
    const badge = container.querySelector("#compilation-1\\.3 .ledger-badge");
    expect(badge?.className).toContain("ledger-badge--fail");
    expect(badge?.textContent).toContain("2 witnesses");
  });

  it("marks a clause with no witnesses as a visible coverage gap", () => {
    const { container } = renderDoc();
    const badge = container.querySelector("#compilation-1\\.4 .ledger-badge");
    expect(badge?.className).toContain("ledger-badge--none");
    expect(badge?.textContent).toContain("no witnesses");
  });

  it("offers no run affordance for a clause with no witnesses", () => {
    const { container } = renderDoc();
    expect(container.querySelector("#compilation-1\\.4 .ledger-badge__run")).toBeNull();
    expect(container.querySelector("#compilation-1\\.3 .ledger-badge__run")).toBeTruthy();
  });

  it("runs a clause's witnesses on demand (§3.2)", () => {
    const { container, props } = renderDoc();
    fireEvent.click(container.querySelector("#compilation-1\\.3 .ledger-badge__run")!);
    expect(props.onRunClause).toHaveBeenCalledWith("1.3");
  });

  it("opens the witness list when the badge label is clicked", () => {
    const { container, props } = renderDoc();
    fireEvent.click(container.querySelector("#compilation-1\\.3 .ledger-badge__label")!);
    expect(props.onInspectClause).toHaveBeenCalledWith("1.3");
  });

  it("mounts code fences as read-only editors with no probes (§2.3, editor.md §1.14)", () => {
    editorProps.length = 0;
    renderDoc();
    expect(screen.getByTestId("cm-editor").textContent).toBe("(a1 (fast 2 t))");
    expect(editorProps).toHaveLength(1);
    expect(editorProps[0].readOnly).toBe(true);
    // `enableProbes` must never be set — it would register probes against the
    // global visualisation store.
    expect(editorProps[0].enableProbes).toBeUndefined();
  });

  it("turns intra-corpus links into in-Ledger navigation (§2.3)", () => {
    const { container, props } = renderDoc();
    const link = container.querySelector('a[data-ledger-spec="time.md"]') as HTMLAnchorElement;
    fireEvent.click(link);
    expect(props.onNavigate).toHaveBeenCalledWith("time.md", "2.2");
  });

  it("swallows clicks on links pointing outside the corpus", () => {
    const { container, props } = renderDoc();
    const link = container.querySelector("a[data-ledger-unresolved]") as HTMLAnchorElement;
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(event);
    expect(props.onNavigate).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it("highlights the requested clause (§2.2)", () => {
    const { container } = renderDoc({ highlightClause: "1.3" });
    expect(container.querySelector("#compilation-1\\.3")?.className).toContain("ledger-block--highlight");
    expect(container.querySelector("#compilation-1\\.4")?.className).not.toContain("highlight");
  });
});
