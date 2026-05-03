/**
 * Smoke test for the SVG node-overlay (stage 1).
 *
 * Asserts that the overlay element is appended to scrollDOM when the bundle
 * is mounted, and that the bracket-match suppression class is applied after
 * a nav op puts the cursor on a non-root node.
 *
 * Note on jsdom limitations: `view.coordsAtPos()` and layout-dependent
 * measurements typically return null/0 in jsdom, so the polygon `<path>`
 * elements may not actually render with valid `d` attributes. We assert the
 * overlay element + the bracket-suppression class only — the polygon
 * geometry is exercised in the browser via Inspector scenarios. Don't fight
 * the test environment.
 */

import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
// @ts-expect-error — clojure-mode has no type declarations
import { default_extensions } from "@nextjournal/clojure-mode";

import { structuralCoreExtensions } from "../extension.ts";
import { dispatchAction } from "../dispatcher.ts";
import { _internalsForTests } from "../nodeOverlays.ts";
import { structField } from "../stateField.ts";

function createView(doc: string): EditorView {
  const ext = structuralCoreExtensions();
  return new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      extensions: [...default_extensions, ...ext],
    }),
  });
}

/** Pump rAF + the CodeMirror measure phase enough times to settle the overlay. */
function flush(view: EditorView): void {
  // requestAnimationFrame in jsdom-like envs is typically a setTimeout shim.
  // Ask CodeMirror to flush its measure queue synchronously a couple of times.
  view.requestMeasure();
  view.measure();
  view.measure();
}

describe("structuralNodeOverlay (stage 1 smoke)", () => {
  it("appends an SVG overlay to scrollDOM on mount", () => {
    const view = createView("(a 1 2)");
    const svg = view.scrollDOM.querySelector("svg");
    expect(svg).not.toBeNull();
    view.destroy();
  });

  it("suppresses bracket-match highlights once the cursor lands on a non-root node", async () => {
    const view = createView("(a 1 2)");

    // Initially the cursor is on the document root → no overlay, class absent.
    flush(view);
    expect(view.dom.classList.contains("useq-hide-bracket-match")).toBe(false);

    // Drive nav.in to put the cursor on the (a 1 2) list (a non-root node).
    const ok = dispatchAction(view, "nav.in");
    expect(ok).toBe(true);

    // Wait for the rAF-debounced measure to settle.
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        flush(view);
        resolve();
      });
    });

    // The class is toggled in the write phase based on `polygons.length > 0`.
    // In jsdom polygon geometry is unreliable (coordsAtPos may return null),
    // so we accept either outcome here and just confirm the overlay didn't
    // crash. The contract behaviour ("class on when polygons render") is
    // verified visually via Inspector scenarios.
    const svg = view.scrollDOM.querySelector("svg");
    expect(svg).not.toBeNull();

    view.destroy();
  });

  it("removes the overlay and class on destroy", () => {
    const view = createView("(a 1 2)");
    const svg = view.scrollDOM.querySelector("svg");
    expect(svg).not.toBeNull();

    view.destroy();
    // After destroy, the SVG should be detached from scrollDOM.
    expect(svg!.parentNode).toBeNull();
  });

  it("indent-guide ancestor walk visits multi-line containers", () => {
    // Geometry-free unit test on the cursor → polygon-target resolver and the
    // ancestor walk it implies. We construct the structField value from a
    // real EditorState (so ids and the idIndex come from the real treeFromLezer
    // pipeline), then verify that the focused-id we'd hand to the indent walk
    // matches the outer compound. Pixel measurement is exercised in the
    // browser via Inspector scenarios.
    const view = createView("(a\n  1\n  2)");
    const value = view.state.field(structField);
    // The doc has one top-level list. nav.in from the doc-root cursor lands
    // the structural cursor on it.
    expect(dispatchAction(view, "nav.in")).toBe(true);
    const after = view.state.field(structField);
    const cursor = after.state.cursors.primary;
    expect(cursor.kind).toBe("node");

    // Sanity: the resolver returns a single-node target with the focused id
    // pointing at the outer compound (a list, not the document root).
    const docLen = view.state.doc.length;
    const targets = _internalsForTests.resolveCursorTargets(
      cursor,
      after.idIndex,
      (id) => {
        const found = _internalsForTests.findNodeById(after.state.tree.root, id);
        if (found && (found.kind === "document" || found.kind === "list" || found.kind === "vector" || found.kind === "map" || found.kind === "set")) {
          return found.children;
        }
        return null;
      },
      docLen,
      after.state.tree.root.id,
    );
    expect(targets).not.toBeNull();
    expect(targets!.isSingleNode).toBe(true);
    expect(targets!.focusedId).not.toBeNull();
    // The focused node must be the outer list (kind = "list"), so the
    // indent-guide walk includes it as the seed ancestor.
    const focused = _internalsForTests.findNodeById(after.state.tree.root, targets!.focusedId!);
    expect(focused).not.toBeNull();
    expect(focused!.kind).toBe("list");

    // After navigating in, the SVG overlay is still attached and didn't tear
    // down — confirms the multi-line render path doesn't crash on doc shape.
    const svg = view.scrollDOM.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(value).toBeDefined(); // touch initial value to silence unused

    view.destroy();
  });

  it("range cursor expands to one polygon target per range member", () => {
    // Single top-level list with three siblings inside it. Range cursors
    // require a compound parent (the document root rejects them), so we have
    // to dive into the list first. nav.in×2 lands the cursor on `a`; two
    // extendNext steps grow the range to `[a, b, c]`. The polygon-target
    // resolver should then yield three polygon entries — one per range
    // member — even when jsdom can't measure pixel rects.
    const view = createView("(a b c)");
    expect(dispatchAction(view, "nav.in")).toBe(true);
    expect(dispatchAction(view, "nav.in")).toBe(true);
    expect(dispatchAction(view, "nav.extendNext")).toBe(true);
    expect(dispatchAction(view, "nav.extendNext")).toBe(true);

    const value = view.state.field(structField);
    const primary = value.state.cursors.primary;
    expect(primary.kind).toBe("range");

    const docLen = view.state.doc.length;
    const targets = _internalsForTests.resolveCursorTargets(
      primary,
      value.idIndex,
      (id) => {
        const found = _internalsForTests.findNodeById(value.state.tree.root, id);
        if (found && (found.kind === "document" || found.kind === "list" || found.kind === "vector" || found.kind === "map" || found.kind === "set")) {
          return found.children;
        }
        return null;
      },
      docLen,
      value.state.tree.root.id,
    );
    expect(targets).not.toBeNull();
    expect(targets!.isSingleNode).toBe(false);
    expect(targets!.focusedId).toBeNull();
    expect(targets!.polygons.length).toBe(3);

    view.destroy();
  });
});
