import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Effect } from "effect";

// Mock legacy modules
vi.mock("../../src/io/serialComms.mjs", () => ({
  toggleConnect: vi.fn(() => Promise.resolve()),
}));
vi.mock("../../src/editors/editorConfig.mjs", () => ({
  toggleSerialVis: vi.fn(),
}));

import { toggleConnection, toggleGraph, togglePanel } from "./ui";
import { toggleConnect } from "../../src/io/serialComms.mjs";
import { toggleSerialVis } from "../../src/editors/editorConfig.mjs";

// Helper: create a mock jQuery function and associated chain objects
function createMockJQuery() {
  let visiblePanels = new Set<string>();

  const createChainObj = (selector?: string) => {
    const chain: any = {
      _selector: selector,
      is: vi.fn((query: string) => {
        if (query === ":visible") return visiblePanels.has(selector || "");
        return false;
      }),
      hide: vi.fn(() => {
        // When hiding .panel-aux, clear all visible panels
        if (selector === ".panel-aux") visiblePanels.clear();
        else visiblePanels.delete(selector || "");
        return chain;
      }),
      show: vi.fn(() => {
        visiblePanels.add(selector || "");
        return chain;
      }),
      find: vi.fn(() => createChainObj()),
      append: vi.fn(() => chain),
      on: vi.fn(() => chain),
      toggleClass: vi.fn(() => chain),
      hasClass: vi.fn(() => false),
      attr: vi.fn(() => selector || ""),
      remove: vi.fn(() => chain),
      length: 0,
    };
    return chain;
  };

  const $ = vi.fn((sel: string) => createChainObj(sel));
  return { $, visiblePanels };
}

describe("toggleConnection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an Effect that calls toggleConnect()", async () => {
    await Effect.runPromise(toggleConnection());
    expect(toggleConnect).toHaveBeenCalledOnce();
  });
});

describe("toggleGraph", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an Effect that calls toggleSerialVis()", () => {
    Effect.runSync(toggleGraph());
    expect(toggleSerialVis).toHaveBeenCalledOnce();
  });
});

describe("togglePanel", () => {
  let savedDollar: any;

  beforeEach(() => {
    vi.clearAllMocks();
    savedDollar = (window as any).$;
  });

  afterEach(() => {
    (window as any).$ = savedDollar;
  });

  it("shows panel and hides others when panel is not visible", () => {
    const { $ } = createMockJQuery();
    (window as any).$ = $;

    Effect.runSync(togglePanel("#my-panel"));

    // jQuery was called with the panel selector
    expect($).toHaveBeenCalledWith("#my-panel");
    // Should hide all .panel-aux first
    expect($).toHaveBeenCalledWith(".panel-aux");
    // Panel's show() was called
    const panelObj = $.mock.results.find(
      (r: any) => r.value._selector === "#my-panel",
    )!.value;
    expect(panelObj.show).toHaveBeenCalled();
  });

  it("hides all panels when panel is already visible", () => {
    const { $, visiblePanels } = createMockJQuery();
    visiblePanels.add("#my-panel");
    (window as any).$ = $;

    Effect.runSync(togglePanel("#my-panel"));

    // Should hide .panel-aux
    const auxObj = $.mock.results.find(
      (r: any) => r.value._selector === ".panel-aux",
    )!.value;
    expect(auxObj.hide).toHaveBeenCalled();

    // Panel's show() should NOT be called
    const panelObj = $.mock.results.find(
      (r: any) => r.value._selector === "#my-panel",
    )!.value;
    expect(panelObj.show).not.toHaveBeenCalled();
  });

  it("does not crash when window.$ is undefined", () => {
    (window as any).$ = undefined;

    // Should not throw
    expect(() => {
      Effect.runSync(togglePanel("#some-panel"));
    }).not.toThrow();
  });
});
