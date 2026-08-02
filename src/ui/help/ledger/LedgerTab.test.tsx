/**
 * Engine Ledger tab wiring (engine-ledger.md §2.1, §3.2–§3.3).
 *
 * Exercises the tab against stubbed assets and a stubbed isolated engine, so
 * a wiring break surfaces here rather than only in a browser.
 */

import { render, screen, fireEvent, waitFor } from "@solidjs/testing-library";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../CodeMirrorEditor", () => ({
  CodeMirrorEditor: (props: { code: string }) => <div data-testid="cm-editor">{props.code}</div>,
}));

// The Ledger must drive an isolated engine, never the live session's
// (engine-ledger.md §1.2). Stub it and record that it is what gets used.
const engineCalls: string[] = [];
vi.mock("../../../runtime/witnessEngine.ts", () => ({
  createWitnessEngine: () => ({
    async reset() {
      engineCalls.push("reset");
    },
    evaluate(code: string) {
      engineCalls.push(`eval:${code}`);
      return "ok";
    },
    sampleOutput(_output: string, time: number) {
      engineCalls.push(`sample@${time}`);
      return time * 2;
    },
    dispose() {
      engineCalls.push("dispose");
    },
  }),
}));

import { LedgerTab } from "./LedgerTab";
import { parseSpecCorpus, parseWitnessIndex } from "../../../lib/witness/loader.ts";
import { clearLedgerResults } from "./ledgerStore";

const CORPUS = {
  version: 1,
  sourceDir: "src-useq/docs/specs",
  entryFile: "MAIN.md",
  index: [
    { file: "MAIN.md", title: "ModuLisp Semantics", number: null, description: "Entry document." },
    { file: "time-warps.md", title: "Time Warps", number: "6.5", description: "Pure substitution." },
  ],
  documents: {
    "MAIN.md": { file: "MAIN.md", title: "ModuLisp Semantics", blocks: [], clauses: [] },
    "time-warps.md": {
      file: "time-warps.md",
      title: "Time Warps",
      clauses: ["3", "3.1"],
      blocks: [
        { kind: "heading", depth: 2, text: "3. Sugars", id: "clause-3", clause: "3" },
        {
          kind: "prose",
          clause: "3.1",
          clauseOpener: true,
          id: "clause-3.1",
          html: "<p>3.1 fast is pointwise time scaling.</p>",
        },
      ],
    },
  },
};

const INDEX = {
  version: 1,
  corpusDir: "src-useq/test/conformance",
  fileCount: 1,
  witnessCount: 1,
  witnesses: [
    {
      name: "fast-is-pointwise-time-scaling",
      specFile: "time-warps.md",
      clause: "3.1",
      specRefs: [{ file: "time-warps.md", clause: "3.1" }],
      tags: ["smoke"],
      steps: [
        { eval: "(a1 (fast 2 t))" },
        { sample: { output: "a1", times: [0, 0.5, 1] }, expect_values: [0, 1, 2] },
      ],
      sourcePath: "src-useq/test/conformance/time-warps/basics.yaml",
    },
  ],
  bySpecFile: {
    "time-warps.md": { clauses: { "3.1": ["fast-is-pointwise-time-scaling"] }, documentWitnesses: [] },
  },
};

/** Inject the stub assets; the tab never touches `fetch` in these tests. */
const stubAssets = async () => ({
  corpus: parseSpecCorpus(CORPUS),
  index: parseWitnessIndex(INDEX),
});

const renderTab = (loader = stubAssets) => render(() => <LedgerTab loadAssets={loader} />);

beforeEach(() => {
  engineCalls.length = 0;
  clearLedgerResults();
});

describe("LedgerTab", () => {
  it("lists the spec corpus in MAIN.md §6 order (§2.1)", async () => {
    renderTab();
    await screen.findByText("ModuLisp Semantics");
    expect(screen.getByText("Time Warps")).toBeTruthy();
    expect(screen.getByText("6.5")).toBeTruthy();
  });

  it("starts with every witness unrun — nothing auto-runs (§3.2)", async () => {
    renderTab();
    await screen.findByText("1 not run");
    expect(engineCalls).toEqual([]);
  });

  it("opens a spec document and renders its clauses", async () => {
    const { container } = renderTab();
    fireEvent.click(await screen.findByText("Time Warps"));
    await screen.findByText(/fast is pointwise time scaling/);
    const ids = [...container.querySelectorAll("[id]")].map((el) => el.id);
    expect(ids).toContain("time-warps-3.1");
  });

  it("runs a document's witnesses on demand against the isolated engine", async () => {
    renderTab();
    fireEvent.click(await screen.findByText("Time Warps"));
    fireEvent.click(await screen.findByText(/Run all \(1\)/));

    await waitFor(() => expect(engineCalls).toContain("dispose"));
    expect(engineCalls).toEqual([
      "reset",
      "eval:(a1 (fast 2 t))",
      "sample@0",
      "sample@0.5",
      "sample@1",
      "dispose",
    ]);
  });

  it("turns the clause badge green once its witness passes (§3.1)", async () => {
    const { container } = renderTab();
    fireEvent.click(await screen.findByText("Time Warps"));

    const badge = () => container.querySelector(".ledger-document .ledger-badge");
    expect(badge()?.className).toContain("ledger-badge--unrun");

    fireEvent.click(await screen.findByText(/Run all \(1\)/));
    await waitFor(() => expect(badge()?.className).toContain("ledger-badge--pass"));
  });

  it("shows the witness detail with actual values when a badge is inspected (§3.4)", async () => {
    const { container } = renderTab();
    fireEvent.click(await screen.findByText("Time Warps"));
    fireEvent.click(await screen.findByText(/Run all \(1\)/));
    await waitFor(() => expect(engineCalls).toContain("dispose"));

    fireEvent.click(container.querySelector(".ledger-document .ledger-badge__label")!);
    await screen.findByText("fast-is-pointwise-time-scaling");
    // Both the expected and the actual row read [0, 1, 2] on a pass.
    expect(screen.getAllByText("[0, 1, 2]")).toHaveLength(2);
    expect(screen.getByText("src-useq/test/conformance/time-warps/basics.yaml")).toBeTruthy();
  });

  it("returns to the index", async () => {
    renderTab();
    fireEvent.click(await screen.findByText("Time Warps"));
    fireEvent.click(await screen.findByText("← Index"));
    await screen.findByText("Engine Ledger");
    expect(screen.getByText(/conformance witnesses over/)).toBeTruthy();
  });

  it("surfaces an asset load failure instead of rendering an empty Ledger", async () => {
    renderTab(async () => {
      throw new Error("witness-index.json missing");
    });
    await waitFor(() => expect(screen.getByText(/Could not load the Ledger assets/)).toBeTruthy());
    expect(screen.getByText(/witness-index.json missing/)).toBeTruthy();
  });
});
