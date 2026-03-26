import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
// @ts-expect-error - no type declarations available for clojure-mode
import { default_extensions } from "@nextjournal/clojure-mode";
import { PERSISTENCE_KEYS } from "../../lib/persistence.ts";
import { resetStartupContextForTests } from "../../runtime/startupContext.ts";

const { evalInUseqWasmSilently } = vi.hoisted(() => ({
  evalInUseqWasmSilently: vi.fn(),
}));

vi.mock("../../runtime/wasmInterpreter.ts", () => ({
  evalInUseqWasmSilently,
}));

function createMockStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    clear: vi.fn(() => store.clear()),
    get length() {
      return store.size;
    },
    key: vi.fn((_index: number) => null),
  };
}

function anchorOf(source: string, snippet: string, occurrence = 0): number {
  let offset = -1;
  for (let index = 0; index <= occurrence; index++) {
    offset = source.indexOf(snippet, offset + 1);
    if (offset < 0) {
      throw new Error(`Snippet not found: ${snippet}`);
    }
  }
  return offset;
}

function rangeOf(
  source: string,
  snippet: string,
  occurrence = 0,
): { anchor: number; head: number } {
  const anchor = anchorOf(source, snippet, occurrence);
  return { anchor, head: anchor + snippet.length };
}

function createView(
  doc: string,
  extension: unknown,
  selection: { anchor: number; head?: number },
): EditorView {
  return new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      selection,
      extensions: [...default_extensions, extension],
    }),
  });
}

function selectEnclosingList(view: EditorView, snippet: string): void {
  const pos = view.state.doc.toString().indexOf(snippet);
  if (pos < 0) {
    throw new Error(`Snippet not found: ${snippet}`);
  }

  let node = syntaxTree(view.state).resolveInner(pos, 0);
  while (node && node.type.name !== "List") {
    node = node.parent;
  }

  if (!node) {
    throw new Error(`No enclosing list found for: ${snippet}`);
  }

  view.dispatch({
    selection: {
      anchor: node.from,
      head: node.to,
    },
  });
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

function numericVector(count: number, value: number): string {
  return `[${Array.from({ length: count }, () => String(value)).join(" ")}]`;
}

async function loadProbeModule() {
  return import("./probes.ts");
}

let mockStorage: Storage;
let frameCallbacks: FrameRequestCallback[];

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  evalInUseqWasmSilently.mockReset();
  frameCallbacks = [];
  document.body.innerHTML = "";

  mockStorage = createMockStorage();
  Object.defineProperty(globalThis, "localStorage", {
    value: mockStorage,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(window, "localStorage", {
    value: mockStorage,
    writable: true,
    configurable: true,
  });

  resetStartupContextForTests();

  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frameCallbacks.push(callback);
    return frameCallbacks.length;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ({
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
  }) as unknown as CanvasRenderingContext2D);
});

afterEach(() => {
  vi.restoreAllMocks();
  resetStartupContextForTests();
  document.body.innerHTML = "";
});

async function runNextFrame(now = 1000): Promise<void> {
  const callbacks = frameCallbacks.splice(0, frameCallbacks.length);
  if (callbacks.length === 0) {
    throw new Error("No queued animation frame");
  }
  for (const callback of callbacks) {
    callback(now);
  }
  await flushPromises();
  await flushPromises();
}

describe("probe commands", () => {
  it("toggles contextual probes and adjusts depth", async () => {
    const { contractCurrentProbeContext, expandCurrentProbeContext, probeField, toggleCurrentProbe } = await loadProbeModule();
    const source = "(slow 2 (offset 0.5 (fast 3 bar)))";
    const view = createView(source, probeField, { anchor: anchorOf(source, "bar") });

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

  it("targets the nearest same-line contextual probe even when the cursor is inside a raw probe", async () => {
    const { contractCurrentProbeContext, probeField, toggleCurrentProbe } = await loadProbeModule();
    const source = "(slow 2 (fast 3 alpha))  beta";
    const view = createView(source, probeField, { anchor: anchorOf(source, "alpha") });

    expect(toggleCurrentProbe(view, "contextual")).toBe(true);

    view.dispatch({
      selection: {
        anchor: anchorOf(source, "beta"),
      },
    });
    expect(toggleCurrentProbe(view, "raw")).toBe(true);

    let probes = view.state.field(probeField).probes;
    const contextualProbe = probes.find((probe) => probe.mode === "contextual");
    const rawProbe = probes.find((probe) => probe.mode === "raw");
    expect(contextualProbe?.depth).toBe(2);
    expect(rawProbe?.cachedCode).toBe("beta");

    expect(contractCurrentProbeContext(view)).toBe(true);

    probes = view.state.field(probeField).probes;
    expect(probes.find((probe) => probe.mode === "contextual")?.depth).toBe(1);
    expect(probes.find((probe) => probe.mode === "raw")?.depth).toBe(0);

    view.destroy();
  });

  it("allows raw and contextual probes to coexist on the same range", async () => {
    const { probeField, toggleCurrentProbe } = await loadProbeModule();
    const source = "(slow 2 bar)";
    const view = createView(source, probeField, { anchor: anchorOf(source, "bar") });

    expect(toggleCurrentProbe(view, "contextual")).toBe(true);
    expect(toggleCurrentProbe(view, "raw")).toBe(true);

    let probes = view.state.field(probeField).probes;
    expect(probes).toHaveLength(2);
    expect(probes.map((probe) => probe.mode).sort()).toEqual([
      "contextual",
      "raw",
    ]);

    expect(toggleCurrentProbe(view, "raw")).toBe(true);
    probes = view.state.field(probeField).probes;
    expect(probes).toHaveLength(1);
    expect(probes[0]?.mode).toBe("contextual");

    view.destroy();
  });

  it("does not throw when probes are toggled in reverse document order", async () => {
    const { probeField, toggleCurrentProbe } = await loadProbeModule();
    const source = [
      "(slow 2 first)",
      "(slow 2 second)",
    ].join("\n");
    const view = createView(source, probeField, {
      anchor: anchorOf(source, "second"),
    });

    expect(() => toggleCurrentProbe(view, "raw")).not.toThrow();

    view.dispatch({
      selection: {
        anchor: anchorOf(source, "first"),
      },
    });

    expect(() => toggleCurrentProbe(view, "raw")).not.toThrow();
    expect(view.state.field(probeField).probes).toHaveLength(2);
    expect(view.state.field(probeField).probes.map((probe) => probe.cachedCode)).toEqual([
      "second",
      "first",
    ]);

    view.destroy();
  });

  it("creates raw probes without contextual depth", async () => {
    const { probeField, toggleCurrentProbe } = await loadProbeModule();
    const source = "(slow 2 bar)";
    const view = createView(source, probeField, { anchor: anchorOf(source, "bar") });

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

  it("restores persisted probes and sanitizes invalid stored data", async () => {
    mockStorage.setItem(
      PERSISTENCE_KEYS.editorProbes,
      JSON.stringify([
        {
          id: "contextual-probe",
          from: 0,
          to: 3,
          mode: "contextual",
          depth: 2.9,
          maxDepth: 3.7,
          cachedCode: "bar",
        },
        {
          id: "raw-probe",
          from: 4,
          to: 7,
          mode: "raw",
          depth: -4,
          maxDepth: -2,
          cachedCode: "baz",
        },
        {
          id: "invalid",
          from: 0,
          to: 1,
          mode: "bad",
          depth: 0,
          maxDepth: 0,
          cachedCode: "x",
        },
      ]),
    );

    const { probeField } = await loadProbeModule();
    const view = createView("bar baz", probeField, { anchor: 0 });

    expect(view.state.field(probeField).probes).toEqual([
      {
        id: "contextual-probe",
        from: 0,
        to: 3,
        mode: "contextual",
        depth: 2,
        maxDepth: 3,
        cachedCode: "bar",
      },
      {
        id: "raw-probe",
        from: 4,
        to: 7,
        mode: "raw",
        depth: 0,
        maxDepth: 0,
        cachedCode: "baz",
      },
    ]);

    view.destroy();
  });

  it("maps probe ranges through edits and clamps contextual depth when wrappers disappear", async () => {
    const { probeField, toggleCurrentProbe } = await loadProbeModule();
    const source = "(slow 2 bar)";
    const view = createView(source, probeField, { anchor: anchorOf(source, "bar") });

    expect(toggleCurrentProbe(view, "contextual")).toBe(true);
    expect(view.state.field(probeField).probes[0]).toMatchObject({
      from: 8,
      to: 11,
      depth: 1,
      maxDepth: 1,
    });

    view.dispatch({
      changes: [
        { from: 0, to: 8, insert: "" },
        { from: source.length - 1, to: source.length, insert: "" },
      ],
    });

    expect(view.state.doc.toString()).toBe("bar");
    expect(view.state.field(probeField).probes[0]).toMatchObject({
      from: 0,
      to: 3,
      depth: 0,
      maxDepth: 0,
      cachedCode: "(slow 2 bar)",
    });

    view.destroy();
  });

  it("persists probe sets and removes the persistence key when the last probe is cleared", async () => {
    const { probeExtensions, toggleCurrentProbe } = await loadProbeModule();
    const source = "(slow 2 bar)";
    const view = createView(source, probeExtensions, { anchor: anchorOf(source, "bar") });

    expect(toggleCurrentProbe(view, "raw")).toBe(true);
    expect(mockStorage.getItem(PERSISTENCE_KEYS.editorProbes)).not.toBeNull();

    const stored = JSON.parse(mockStorage.getItem(PERSISTENCE_KEYS.editorProbes) ?? "[]");
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      mode: "raw",
      cachedCode: "bar",
    });

    expect(toggleCurrentProbe(view, "raw")).toBe(true);
    expect(mockStorage.getItem(PERSISTENCE_KEYS.editorProbes)).toBeNull();

    view.destroy();
  });

  it("renders a waveform for numeric probe output", async () => {
    evalInUseqWasmSilently.mockImplementation(async (code: string) => {
      if (code === "barDur") return "2";
      if (code.startsWith("[")) {
        return numericVector(40, 100);
      }
      if (code.startsWith("(eval-at-time ")) {
        return "100";
      }
      return "100";
    });

    const { setVisStore } = await import("../../utils/visualisationStore.ts");
    const { probeExtensions, probeField, toggleCurrentProbe } = await loadProbeModule();
    setVisStore("currentTime", 4);

    const view = createView("bar", probeExtensions, { anchor: 0 });
    expect(toggleCurrentProbe(view, "raw")).toBe(true);

    await runNextFrame();

    const snapshot = view.state.field(probeField);
    const probe = snapshot.probes[0];
    const render = snapshot.renderById[probe.id];
    expect(render).toMatchObject({
      kind: "waveform",
      text: "100",
      windowStart: 2,
      windowDuration: 2,
      currentTime: 4,
    });
    expect(render.samples).toHaveLength(40);
    expect(evalInUseqWasmSilently).toHaveBeenCalledTimes(3);
    expect(
      evalInUseqWasmSilently.mock.calls.filter(([code]) =>
        String(code).startsWith("["),
      ),
    ).toHaveLength(1);

    view.destroy();
  });

  it("retries cached code when rebuilt code fails", async () => {
    evalInUseqWasmSilently.mockImplementation(async (code: string) => {
      if (code === "barDur") return "1";
      if (String(code).includes("baz")) {
        throw new Error("probe exploded");
      }
      if (code.startsWith("[")) {
        return numericVector(40, 7);
      }
      return "7";
    });

    const { setVisStore } = await import("../../utils/visualisationStore.ts");
    const { probeExtensions, probeField, toggleCurrentProbe } = await loadProbeModule();
    setVisStore("currentTime", 3);

    const view = createView("bar", probeExtensions, { anchor: 0 });
    expect(toggleCurrentProbe(view, "raw")).toBe(true);

    view.dispatch({
      changes: { from: 0, to: 3, insert: "baz" },
    });

    await runNextFrame();

    const snapshot = view.state.field(probeField);
    const probe = snapshot.probes[0];
    const render = snapshot.renderById[probe.id];
    expect(probe.cachedCode).toBe("bar");
    expect(render.kind).toBe("waveform");
    expect(render.text).toBe("7");

    view.destroy();
  });

  it("classifies Error-prefixed output as an error render", async () => {
    evalInUseqWasmSilently.mockImplementation(async (code: string) => {
      if (code === "barDur") return "1";
      if (code.startsWith("[")) return numericVector(40, 0);
      return "Error: boom";
    });

    const { setVisStore } = await import("../../utils/visualisationStore.ts");
    const { probeExtensions, probeField, toggleCurrentProbe } = await loadProbeModule();
    setVisStore("currentTime", 2);

    const view = createView("bar", probeExtensions, { anchor: 0 });
    expect(toggleCurrentProbe(view, "raw")).toBe(true);

    await runNextFrame();

    const snapshot = view.state.field(probeField);
    const probe = snapshot.probes[0];
    expect(snapshot.renderById[probe.id]).toMatchObject({
      kind: "error",
      text: "Error: boom",
      samples: [],
    });

    view.destroy();
  });

  it("uses the configured probe refresh interval to throttle redraws", async () => {
    evalInUseqWasmSilently.mockImplementation(async (code: string) => {
      if (code === "barDur") return "1";
      if (code.startsWith("[")) return numericVector(40, 42);
      return "42";
    });

    const { setVisStore } = await import("../../utils/visualisationStore.ts");
    const { probeExtensions, probeField, toggleCurrentProbe } = await loadProbeModule();
    setVisStore("currentTime", 2);

    const view = createView("bar", probeExtensions, { anchor: 0 });
    expect(toggleCurrentProbe(view, "raw")).toBe(true);

    // First frame at t=1000 should sample
    await runNextFrame(1000);
    const firstRender = view.state.field(probeField).renderById;
    const probeId = view.state.field(probeField).probes[0].id;
    expect(firstRender[probeId]).toBeDefined();
    const firstRevision = firstRender[probeId].revision;

    // Second frame within the throttle window (180ms) should be skipped
    await runNextFrame(1050);
    const secondRender = view.state.field(probeField).renderById;
    expect(secondRender[probeId].revision).toBe(firstRevision);

    // Third frame beyond the throttle window should sample again
    await runNextFrame(1200);
    const thirdRender = view.state.field(probeField).renderById;
    expect(thirdRender[probeId].revision).toBeGreaterThan(firstRevision);

    view.destroy();
  });

  it("caches barDur across rapid ticks to reduce WASM calls", async () => {
    let barDurCallCount = 0;
    evalInUseqWasmSilently.mockImplementation(async (code: string) => {
      if (code === "barDur") {
        barDurCallCount++;
        return "2";
      }
      if (code.startsWith("[")) return numericVector(40, 1);
      return "1";
    });

    const { setVisStore } = await import("../../utils/visualisationStore.ts");
    const { probeExtensions, probeField, toggleCurrentProbe } = await loadProbeModule();
    setVisStore("currentTime", 5);

    const view = createView("bar", probeExtensions, { anchor: 0 });
    expect(toggleCurrentProbe(view, "raw")).toBe(true);

    // First tick reads barDur
    await runNextFrame(1000);
    expect(barDurCallCount).toBe(1);

    // Second tick after throttle interval — barDur should come from cache
    await runNextFrame(1200);
    expect(barDurCallCount).toBe(1);

    view.destroy();
  });

  it("evaluates multiple probes sequentially within a single tick", async () => {
    const evalOrder: string[] = [];
    evalInUseqWasmSilently.mockImplementation(async (code: string) => {
      if (code === "barDur") return "1";
      evalOrder.push(code);
      if (code.startsWith("[")) return numericVector(40, 0);
      return "0.5";
    });

    const { setVisStore } = await import("../../utils/visualisationStore.ts");
    const { probeExtensions, probeField, toggleCurrentProbe } = await loadProbeModule();
    setVisStore("currentTime", 3);

    const source = "alpha beta";
    const view = createView(source, probeExtensions, {
      anchor: anchorOf(source, "alpha"),
    });

    expect(toggleCurrentProbe(view, "raw")).toBe(true);
    view.dispatch({ selection: { anchor: anchorOf(source, "beta") } });
    expect(toggleCurrentProbe(view, "raw")).toBe(true);

    const probes = view.state.field(probeField).probes;
    expect(probes).toHaveLength(2);

    await runNextFrame(1000);

    // Both probes should have render data
    const snapshot = view.state.field(probeField);
    for (const probe of snapshot.probes) {
      expect(snapshot.renderById[probe.id]).toBeDefined();
    }

    // The eval calls should interleave: current-check then batch for each probe
    expect(evalOrder.length).toBeGreaterThanOrEqual(4);

    view.destroy();
  });

  it("adds contextual highlights for visible indexed forms without requiring probes", async () => {
    evalInUseqWasmSilently.mockResolvedValue("0.5");

    const source = "(from-list [10 20 30] bar)";
    const { probeExtensions, probeField } = await loadProbeModule();
    const view = createView(source, probeExtensions, { anchor: anchorOf(source, "bar") });

    await runNextFrame();

    expect(view.state.field(probeField).highlights).toEqual([
      {
        from: anchorOf(source, "20"),
        to: anchorOf(source, "20") + 2,
        mode: "contextual",
      },
    ]);

    view.destroy();
  });

  it("only adds raw indexed highlights when the indexed form itself has a raw probe", async () => {
    evalInUseqWasmSilently.mockImplementation(async (code: string) => {
      if (code === "barDur") return "1";
      return "0.5";
    });

    const source = "(from-list [10 20 30] bar)";
    const { probeExtensions, probeField, toggleCurrentProbe } = await loadProbeModule();
    const view = createView(source, probeExtensions, { anchor: anchorOf(source, "bar") });

    expect(toggleCurrentProbe(view, "raw")).toBe(true);
    await runNextFrame();

    expect(view.state.field(probeField).highlights).toEqual([
      {
        from: anchorOf(source, "20"),
        to: anchorOf(source, "20") + 2,
        mode: "contextual",
      },
    ]);

    selectEnclosingList(view, "from-list");
    expect(toggleCurrentProbe(view, "raw")).toBe(true);
    expect(view.state.field(probeField).probes.some((probe) => probe.cachedCode === source)).toBe(true);

    await runNextFrame(1200);

    expect(view.state.field(probeField).highlights).toEqual([
      {
        from: anchorOf(source, "20"),
        to: anchorOf(source, "20") + 2,
        mode: "contextual",
      },
      {
        from: anchorOf(source, "20"),
        to: anchorOf(source, "20") + 2,
        mode: "raw",
      },
    ]);

    view.destroy();
  });
});
