import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
// @ts-expect-error - no type declarations available for clojure-mode
import { default_extensions } from "@nextjournal/clojure-mode";

import {
  contractCurrentProbeContext,
  expandCurrentProbeContext,
  probeField,
  toggleCurrentProbe,
} from "./probes.ts";

function createView(doc: string, cursorAt: string): EditorView {
  const anchor = doc.indexOf(cursorAt);
  if (anchor < 0) {
    throw new Error(`Cursor target not found: ${cursorAt}`);
  }

  return new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor },
      extensions: [...default_extensions, probeField],
    }),
  });
}

describe("probe commands", () => {
  it("toggles contextual probes and adjusts depth", () => {
    const source = "(slow 2 (offset 0.5 (fast 3 bar)))";
    const view = createView(source, "bar");

    expect(toggleCurrentProbe(view, "contextual")).toBe(true);

    let probes = view.state.field(probeField).probes;
    expect(probes).toHaveLength(1);
    expect(probes[0]?.mode).toBe("contextual");
    expect(probes[0]?.depth).toBe(3);

    expect(contractCurrentProbeContext(view)).toBe(true);
    probes = view.state.field(probeField).probes;
    expect(probes[0]?.depth).toBe(2);

    expect(expandCurrentProbeContext(view)).toBe(true);
    probes = view.state.field(probeField).probes;
    expect(probes[0]?.depth).toBe(3);

    expect(toggleCurrentProbe(view, "contextual")).toBe(true);
    probes = view.state.field(probeField).probes;
    expect(probes).toHaveLength(0);

    view.destroy();
  });

  it("creates raw probes without contextual depth", () => {
    const source = "(slow 2 bar)";
    const view = createView(source, "bar");

    expect(toggleCurrentProbe(view, "raw")).toBe(true);
    const probes = view.state.field(probeField).probes;
    expect(probes).toHaveLength(1);
    expect(probes[0]).toMatchObject({
      mode: "raw",
      depth: 0,
      maxDepth: 1,
      cachedCode: "bar",
    });

    view.destroy();
  });
});
