import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
// @ts-expect-error - no type declarations available for clojure-mode
import { default_extensions } from "@nextjournal/clojure-mode";
import { PERSISTENCE_KEYS } from "../../lib/persistence.ts";
import { resetStartupContextForTests } from "../../runtime/startupContext.ts";

const { evalInUseqWasmSilently, sessionState, wasmAvailable } = vi.hoisted(() => ({
  evalInUseqWasmSilently: vi.fn(),
  sessionState: {
    currentTime: 0,
    bar: 0,
    lastChangeKind: "time",
  },
  wasmAvailable: { value: true },
}));

vi.mock("../../effects/visualisationSession.ts", () => ({
  visualisationSession: {
    state: sessionState,
    probes: {
      available: () => wasmAvailable.value,
      evaluate: evalInUseqWasmSilently,
      set: async () => -1,
      sample: async () => null,
      free: async () => {},
    },
  },
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
  sessionState.currentTime = 0;
  sessionState.bar = 0;
  sessionState.lastChangeKind = "time";
  wasmAvailable.value = true;
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
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
    setLineDash: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
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
        canvasWidth: 138,
        canvasHeight: 46,
        windowDurationMs: 1000,
      },
      {
        id: "raw-probe",
        from: 4,
        to: 7,
        mode: "raw",
        depth: 0,
        maxDepth: 0,
        cachedCode: "baz",
        canvasWidth: 138,
        canvasHeight: 46,
        windowDurationMs: 1000,
      },
    ]);

    view.destroy();
  });

  it("marks a probe stale on restore when the text at its offsets changed (spec §1.5.5/§1.8.3)", async () => {
    // Persisted probe cached "bar" at 0-3, but the document now reads "baz"
    // at those offsets. Rebuild succeeds but differs → stale, not silent rebind.
    mockStorage.setItem(
      PERSISTENCE_KEYS.editorProbes,
      JSON.stringify([
        {
          id: "stale-probe",
          from: 0,
          to: 3,
          mode: "raw",
          depth: 0,
          maxDepth: 0,
          cachedCode: "bar",
        },
      ]),
    );

    const { probeField } = await loadProbeModule();
    const view = createView("baz", probeField, { anchor: 0 });

    const snapshot = view.state.field(probeField);
    expect(snapshot.probes).toHaveLength(1);
    expect(snapshot.staleIds.has("stale-probe")).toBe(true);
    // The probe never silently rebinds to "baz".
    expect(snapshot.probes[0].cachedCode).toBe("bar");
    // The stale render is surfaced via decorations, not sampling: no render
    // entry was produced for the stale probe.
    expect(snapshot.renderById["stale-probe"]).toBeUndefined();

    view.destroy();
  });

  it("restores cleanly (not stale) when the text at the saved offsets matches cachedCode", async () => {
    mockStorage.setItem(
      PERSISTENCE_KEYS.editorProbes,
      JSON.stringify([
        {
          id: "fresh-probe",
          from: 0,
          to: 3,
          mode: "raw",
          depth: 0,
          maxDepth: 0,
          cachedCode: "bar",
        },
      ]),
    );

    const { probeField } = await loadProbeModule();
    const view = createView("bar", probeField, { anchor: 0 });

    const snapshot = view.state.field(probeField);
    expect(snapshot.staleIds.has("fresh-probe")).toBe(false);

    view.destroy();
  });

  it("clears the stale marker once the user edits the document (live-edit rebind, §1.5.3)", async () => {
    mockStorage.setItem(
      PERSISTENCE_KEYS.editorProbes,
      JSON.stringify([
        {
          id: "stale-probe",
          from: 0,
          to: 3,
          mode: "raw",
          depth: 0,
          maxDepth: 0,
          cachedCode: "bar",
        },
      ]),
    );

    const { probeField } = await loadProbeModule();
    const view = createView("baz", probeField, { anchor: 0 });
    expect(view.state.field(probeField).staleIds.has("stale-probe")).toBe(true);

    // Edit the probed text (replace "baz" with "bar") — a live document edit
    // resolves the restore-only stale condition.
    view.dispatch({ changes: { from: 0, to: 3, insert: "bar" } });
    expect(view.state.doc.toString()).toBe("bar");
    expect(view.state.field(probeField).staleIds.size).toBe(0);

    view.destroy();
  });

  it("renders probes visually disabled and stops sampling in hardware-only mode (spec §1.6.3)", async () => {
    evalInUseqWasmSilently.mockImplementation(async (code: string) => {
      if (code.startsWith("[")) return numericVector(40, 100);
      return "100";
    });

    const { updateAppSettings } = await import("../../runtime/appSettingsRepository.ts");
    updateAppSettings({ wasm: { enabled: false } });
    wasmAvailable.value = false;

    const { probeExtensions, probeField, toggleCurrentProbe } = await loadProbeModule();
    const view = createView("bar", probeExtensions, { anchor: 0 });
    expect(toggleCurrentProbe(view, "raw")).toBe(true);

    await runNextFrame();

    const snapshot = view.state.field(probeField);
    const probe = snapshot.probes[0];
    expect(snapshot.renderById[probe.id]?.kind).toBe("disabled");
    expect(snapshot.renderById[probe.id]?.text).toBe("WASM disabled");
    // No WASM sampling occurred.
    expect(evalInUseqWasmSilently).not.toHaveBeenCalled();

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
    // The batch expression [(eval-at-time t0 bar) ...] starts with "[" and is
    // the only evalInUseqWasmSilently call made per probe per tick (batch path).
    // windowDuration = DEFAULT_PROBE_WINDOW_DURATION_MS / 1000 * temporalScale(1) = 1s
    // windowStart = currentTime(4) - 1 = 3
    evalInUseqWasmSilently.mockImplementation(async (code: string) => {
      if (code.startsWith("[")) {
        return numericVector(40, 100);
      }
      return "100";
    });

    const { setVisStore } = await import("../../utils/visualisationStore.ts");
    const { probeExtensions, probeField, toggleCurrentProbe } = await loadProbeModule();
    setVisStore("currentTime", 4);
    sessionState.currentTime = 4;

    const view = createView("bar", probeExtensions, { anchor: 0 });
    expect(toggleCurrentProbe(view, "raw")).toBe(true);

    await runNextFrame();

    const snapshot = view.state.field(probeField);
    const probe = snapshot.probes[0];
    const render = snapshot.renderById[probe.id];
    expect(render).toMatchObject({
      kind: "waveform",
      text: "100",
      windowStart: 3,
      windowDuration: 1,
      currentTime: 4,
    });
    expect(render.samples).toHaveLength(40);
    // Batch path: one [(...) (...) ...] call covers all sample times.
    expect(evalInUseqWasmSilently).toHaveBeenCalledTimes(1);
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
    sessionState.currentTime = 3;

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
    // All evals (including the batch [(eval-at-time ...) ...]) return the error
    // string. defaultEvalExpressionAtTimes short-circuits on ERROR_PREFIX and
    // returns { samples: [], current: "Error: boom" }, which buildRenderForProbe
    // then classifies as kind: "error".
    evalInUseqWasmSilently.mockResolvedValue("Error: boom");

    const { setVisStore } = await import("../../utils/visualisationStore.ts");
    const { probeExtensions, probeField, toggleCurrentProbe } = await loadProbeModule();
    setVisStore("currentTime", 2);
    sessionState.currentTime = 2;

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

  it("skips indexed form highlights when no probes are active", async () => {
    evalInUseqWasmSilently.mockResolvedValue("0.5");

    const source = "(from-list [10 20 30] bar)";
    const { probeExtensions, probeField } = await loadProbeModule();
    const view = createView(source, probeExtensions, { anchor: anchorOf(source, "bar") });

    // No probes active → no rAF loop → no highlights
    expect(view.state.field(probeField).highlights).toEqual([]);

    view.destroy();
  });

  it("adds contextual highlights for visible indexed forms when probes are active", async () => {
    evalInUseqWasmSilently.mockImplementation(async (code: string) => {
      if (code === "barDur") return "1";
      return "0.5";
    });

    const source = "(from-list [10 20 30] bar)";
    const { probeExtensions, probeField, toggleCurrentProbe } = await loadProbeModule();
    const view = createView(source, probeExtensions, { anchor: anchorOf(source, "bar") });

    // Add a probe so the rAF loop starts and highlights are computed
    expect(toggleCurrentProbe(view, "raw")).toBe(true);
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

  it("keeps an unchanged from-list decoration mounted while the index stays put", async () => {
    evalInUseqWasmSilently.mockResolvedValue("0.5");

    const source = "(a1 (from-list [0.1 0.2 0.3] bar))";
    const { probeExtensions } = await loadProbeModule();
    const view = createView(source, probeExtensions, { anchor: anchorOf(source, "bar") });

    await runNextFrame(1000);
    const first = view.dom.querySelector(".cm-probe-indexed-item");
    expect(first?.textContent).toBe("0.2");

    await runNextFrame(1040);
    const second = view.dom.querySelector(".cm-probe-indexed-item");
    expect(second).toBe(first);

    view.destroy();
  });

  it("keeps indexed highlights mounted through unrelated document edits", async () => {
    evalInUseqWasmSilently.mockResolvedValue("0.5");

    const source = "(a1 (from-list [0.1 0.2 0.3] bar))";
    const { probeExtensions, probeField } = await loadProbeModule();
    const view = createView(source, probeExtensions, { anchor: anchorOf(source, "bar") });

    await runNextFrame(1000);
    const before = view.dom.querySelector(".cm-probe-indexed-item");
    expect(view.state.field(probeField).highlights).toEqual([
      {
        from: anchorOf(source, "0.2"),
        to: anchorOf(source, "0.2") + 3,
        mode: "contextual",
      },
    ]);

    // Insert before the form. The form is unchanged, but all of its positions
    // move; the decoration should be mapped synchronously instead of cleared
    // until the next sampling tick.
    view.dispatch({
      changes: { from: 0, to: 0, insert: " " },
      annotations: Transaction.userEvent.of("input"),
    });

    expect(view.state.field(probeField).highlights).toEqual([
      {
        from: anchorOf(source, "0.2") + 1,
        to: anchorOf(source, "0.2") + 4,
        mode: "contextual",
      },
    ]);
    expect(view.dom.querySelector(".cm-probe-indexed-item")).toBe(before);

    view.destroy();
  });

  it("keeps indexed highlights mounted while probe renders update", async () => {
    evalInUseqWasmSilently.mockResolvedValue("0.5");

    const source = "(a1 (from-list [0.1 0.2 0.3] bar))";
    const { probeExtensions, probeHighlightField, toggleCurrentProbe } = await loadProbeModule();
    const view = createView(source, probeExtensions, { anchor: anchorOf(source, "bar") });

    expect(toggleCurrentProbe(view, "raw")).toBe(true);
    await runNextFrame(1000);
    const before = view.dom.querySelector(".cm-probe-indexed-item");
    const highlightDecorations = view.state.field(probeHighlightField);
    expect(before?.textContent).toBe("0.2");

    await runNextFrame(1040);
    expect(view.dom.querySelector(".cm-probe-indexed-item")).toBe(before);
    expect(view.state.field(probeHighlightField)).toBe(highlightDecorations);

    view.destroy();
  });

  it("holds the last valid index across a transient invalid phasor result", async () => {
    let highlightCalls = 0;
    evalInUseqWasmSilently.mockImplementation(async (code: string) => {
      if (code.includes("eval-at-time")) {
        highlightCalls++;
        return highlightCalls === 1 ? "0.5" : "";
      }
      return "0.5";
    });

    const source = "(a1 (from-list [0.1 0.2 0.3] bar))";
    const { probeExtensions } = await loadProbeModule();
    const view = createView(source, probeExtensions, { anchor: anchorOf(source, "bar") });

    await runNextFrame(1000);
    const first = view.dom.querySelector(".cm-probe-indexed-item");
    expect(first?.textContent).toBe("0.2");

    await runNextFrame(1040);
    const second = view.dom.querySelector(".cm-probe-indexed-item");
    expect(second?.textContent).toBe("0.2");
    expect(second).toBe(first);

    view.destroy();
  });

  it("uses the authoritative sampled bar value instead of re-evaluating bare bar", async () => {
    const { setVisStore } = await import("../../utils/visualisationStore.ts");
    setVisStore("bar", 0.75);
    setVisStore("lastChangeKind", "data");
    sessionState.bar = 0.75;
    sessionState.lastChangeKind = "data";
    evalInUseqWasmSilently.mockResolvedValue("0.0");

    const source = "(a1 (from-list [0.1 0.2 0.3] bar))";
    const { probeExtensions } = await loadProbeModule();
    const view = createView(source, probeExtensions, { anchor: anchorOf(source, "bar") });

    await runNextFrame(1000);
    expect(view.dom.querySelector(".cm-probe-indexed-item")?.textContent).toBe("0.3");
    expect(evalInUseqWasmSilently).not.toHaveBeenCalled();

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

// ---------------------------------------------------------------------------
// Probe batching: one WASM round-trip per probe per tick instead of N.
// Stream A2 / bd useq-perform-d5r.
//
// The full editor flow is exercised by the "renders a waveform" tests
// above; these tests pin the *contract* of the default `ProbeConfig`
// batch sampler in isolation, since the rAF/ProbePlugin path needs
// ResizeObserver which jsdom doesn't provide here.
// ---------------------------------------------------------------------------
describe("probe batch sampler (ProbeConfig.evalExpressionAtTimes)", () => {
  it("issues a single batched eval that covers all sample times", async () => {
    const calls: string[] = [];
    evalInUseqWasmSilently.mockImplementation(async (code: string) => {
      calls.push(code);
      if (code.startsWith("[") && code.endsWith("]")) {
        return numericVector(20, 0.5);
      }
      return "0";
    });

    const { createDefaultProbeConfig } = await loadProbeModule();
    const config = createDefaultProbeConfig();
    const times = Array.from({ length: 20 }, (_, i) => i * 0.05);

    const result = await config.evalExpressionAtTimes("bar", times);

    expect(result).not.toBeNull();
    expect(result?.samples).toHaveLength(20);
    expect(result?.samples.every((v) => v === 0.5)).toBe(true);

    // The defining contract: ONE WASM call regardless of sample count.
    expect(calls).toHaveLength(1);
    const batch = calls[0];
    expect(batch.startsWith("[") && batch.endsWith("]")).toBe(true);

    // The batch expression contains one `eval-at-time` per sample.
    const occurrences = (batch.match(/\(eval-at-time/g) ?? []).length;
    expect(occurrences).toBe(20);
  });

  it("returns null on length mismatch so callers can fall back", async () => {
    evalInUseqWasmSilently.mockImplementation(async (code: string) => {
      if (code.startsWith("[")) return numericVector(3, 1);
      return "1";
    });

    const { createDefaultProbeConfig } = await loadProbeModule();
    const config = createDefaultProbeConfig();
    const times = Array.from({ length: 10 }, (_, i) => i);

    const result = await config.evalExpressionAtTimes("bar", times);
    expect(result).toBeNull();
  });

  it("returns null on interpreter error so caller falls through to per-sample eval", async () => {
    evalInUseqWasmSilently.mockResolvedValue("Error: bad form");

    const { createDefaultProbeConfig } = await loadProbeModule();
    const config = createDefaultProbeConfig();

    const result = await config.evalExpressionAtTimes("bar", [0, 1, 2]);
    expect(result).toBeNull();
  });

  it("returns an empty result for an empty time vector without calling eval", async () => {
    evalInUseqWasmSilently.mockReset();
    const { createDefaultProbeConfig } = await loadProbeModule();
    const config = createDefaultProbeConfig();

    const result = await config.evalExpressionAtTimes("bar", []);
    expect(result).toEqual({ samples: [], current: "" });
    expect(evalInUseqWasmSilently).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Adaptive quality lever 2: probe refresh interval is multiplied by the
// pressure-derived multiplier (1× / 2× / 4×).  The persisted setting is
// not mutated — the override is applied at read time.
// Spec: docs/specs/visualisation.md §1.7/§9.2.
// ---------------------------------------------------------------------------
describe("probe refresh adaptive quality (lever 2)", () => {
  it("multiplies the rAF tick gate interval by 2 at pressure level 1", async () => {
    evalInUseqWasmSilently.mockImplementation(async (code: string) => {
      if (code === "barDur") return "1";
      if (code.startsWith("[")) return numericVector(40, 0.5);
      return "0.5";
    });

    const { setVisStore } = await import("../../utils/visualisationStore.ts");
    const { probeExtensions, probeField, toggleCurrentProbe } = await loadProbeModule();
    const adaptive = await import("../../effects/adaptiveQuality.ts");
    adaptive._resetForTests();
    setVisStore("currentTime", 4);
    sessionState.currentTime = 4;

    const view = createView("bar", probeExtensions, { anchor: 0 });
    expect(toggleCurrentProbe(view, "raw")).toBe(true);

    // Initial frame: lastRun starts at 0, gate condition `now - 0 < N`
    // is false for any reasonable `now`, so this fires.
    await runNextFrame(1000);
    const renderAfterFirst = view.state.field(probeField).renderById;
    const probeId = view.state.field(probeField).probes[0].id;
    expect(renderAfterFirst[probeId]?.kind).toBe("waveform");
    const callsAfterFirst = evalInUseqWasmSilently.mock.calls.length;

    // Drive into pressure level 1 — the multiplier becomes 2.
    for (let i = 0; i < adaptive.MILD_MISS_COUNT; i++) {
      adaptive.recordTickElapsed(adaptive.MISS_THRESHOLD_MS + 5);
    }
    expect(adaptive.getProbeIntervalMultiplier()).toBe(2);

    // The base interval is DEFAULT_PROBE_REFRESH_INTERVAL_MS (33) but
    // could be larger via clamping; doubled it's at most ~66ms.  Fire
    // the next frame at lastRun + 50ms — under normal pressure that
    // would tick (50 > 33), but under mild pressure the gate is
    // 50 < 66 so it should NOT tick.
    await runNextFrame(1050);
    expect(evalInUseqWasmSilently.mock.calls.length).toBe(callsAfterFirst);

    // Fire well past the doubled interval — should tick.
    await runNextFrame(1100);
    expect(
      evalInUseqWasmSilently.mock.calls.length,
    ).toBeGreaterThan(callsAfterFirst);

    adaptive._resetForTests();
    view.destroy();
  });

  it("multiplies the gate interval by 4 at pressure level 2 (severe)", async () => {
    evalInUseqWasmSilently.mockImplementation(async (code: string) => {
      if (code === "barDur") return "1";
      if (code.startsWith("[")) return numericVector(40, 0.5);
      return "0.5";
    });

    const { setVisStore } = await import("../../utils/visualisationStore.ts");
    const { probeExtensions, probeField, toggleCurrentProbe } = await loadProbeModule();
    const adaptive = await import("../../effects/adaptiveQuality.ts");
    adaptive._resetForTests();
    setVisStore("currentTime", 4);
    sessionState.currentTime = 4;

    const view = createView("bar", probeExtensions, { anchor: 0 });
    expect(toggleCurrentProbe(view, "raw")).toBe(true);

    await runNextFrame(1000);
    const probeId = view.state.field(probeField).probes[0].id;
    expect(view.state.field(probeField).renderById[probeId]?.kind).toBe(
      "waveform",
    );
    const callsAfterFirst = evalInUseqWasmSilently.mock.calls.length;

    // Severe pressure: multiplier = 4.
    for (let i = 0; i < adaptive.SEVERE_MISS_COUNT; i++) {
      adaptive.recordTickElapsed(adaptive.MISS_THRESHOLD_MS + 5);
    }
    expect(adaptive.getProbeIntervalMultiplier()).toBe(4);

    // 4× the 33ms base interval = 132ms.  100ms after lastRun is below
    // this — gate holds.
    await runNextFrame(1100);
    expect(evalInUseqWasmSilently.mock.calls.length).toBe(callsAfterFirst);

    // 200ms after — gate releases.
    await runNextFrame(1200);
    expect(
      evalInUseqWasmSilently.mock.calls.length,
    ).toBeGreaterThan(callsAfterFirst);

    adaptive._resetForTests();
    view.destroy();
  });

  it("multiplier returns to 1 when adaptiveQuality is disabled", async () => {
    const adaptive = await import("../../effects/adaptiveQuality.ts");
    adaptive._resetForTests();

    // Saturate: severe pressure.
    for (let i = 0; i < adaptive.SEVERE_MISS_COUNT; i++) {
      adaptive.recordTickElapsed(adaptive.MISS_THRESHOLD_MS + 5);
    }
    expect(adaptive.getProbeIntervalMultiplier()).toBe(4);

    adaptive.setAdaptiveQualityEnabled(false);
    expect(adaptive.getProbeIntervalMultiplier()).toBe(1);

    adaptive._resetForTests();
  });
});
