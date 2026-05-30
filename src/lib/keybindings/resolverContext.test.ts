import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the heavy handler registry — the resolver only needs `getHandler` to
// return *something* callable so a binding makes it into the keymap.
vi.mock("./handlers.ts", () => ({
  getHandler: () => () => true,
}));

import { createResolver, suggestChordTarget } from "./resolver.ts";
import type { KeyBinding } from "./defaults.ts";
import { registerContext, evaluateWhen } from "./contexts.ts";

describe("resolver: context-gated conditional bindings", () => {
  beforeEach(() => {
    // reset context predicates to a known state
    registerContext("test.active", () => false);
  });

  it("a conditional binding's run returns false when its context is inactive", () => {
    const bindings: KeyBinding[] = [
      { action: "eval.now", key: "Mod-y", when: "test.active" },
    ];
    const resolver = createResolver({ defaults: bindings });
    const exts = resolver.toKeymapExtensions();
    // The first extension is the Prec.high conditional keymap. Drill into the
    // CodeMirror keymap facet value to retrieve the run wrapper.
    const conditionalRun = extractFirstRun(exts[0]);
    expect(conditionalRun).toBeTypeOf("function");

    registerContext("test.active", () => false);
    expect(conditionalRun!({} as any)).toBe(false);

    registerContext("test.active", () => true);
    expect(conditionalRun!({} as any)).toBe(true);
  });

  it("evaluateWhen drives the gate", () => {
    registerContext("test.active", () => true);
    expect(evaluateWhen("test.active")).toBe(true);
    registerContext("test.active", () => false);
    expect(evaluateWhen("test.active")).toBe(false);
    // negation
    expect(evaluateWhen("!test.active")).toBe(true);
  });
});

describe("resolver: profile + overrides loading", () => {
  it("applies overrides on top of the supplied defaults", () => {
    const bindings: KeyBinding[] = [
      { action: "eval.now", key: "Mod-Enter" },
    ];
    const resolver = createResolver({
      defaults: bindings,
      overrides: { "eval.now": "Mod-y" },
    });
    expect(resolver.resolved().get("eval.now")?.key).toBe("Mod-y");
  });
});

describe("resolver: ranked rebind suggestions (keybindings.md §1.9)", () => {
  it("emits context-split, swap, chord, nearby in priority order", () => {
    const bindings: KeyBinding[] = [
      { action: "eval.now", key: "Mod-Enter", when: "editor.focused" },
      { action: "eval.soft", key: "Alt-j" },
    ];
    const resolver = createResolver({ defaults: bindings });
    // Try to move eval.soft onto Mod-Enter (occupied by eval.now). Since
    // eval.now carries a when-clause, context-split is offered first.
    const result = resolver.rebind("eval.soft", "Mod-Enter");
    expect(result.status).toBe("conflict");
    if (result.status !== "conflict") return;
    const types = result.suggestions.map((s) => s.type);
    expect(types[0]).toBe("context-split");
    expect(types).toContain("swap");
    expect(types).toContain("chord");
    // ordering: context-split before swap before chord before nearby
    expect(types.indexOf("context-split")).toBeLessThan(types.indexOf("swap"));
    expect(types.indexOf("swap")).toBeLessThan(types.indexOf("chord"));
  });

  it("omits context-split when neither side has a when-clause", () => {
    const bindings: KeyBinding[] = [
      { action: "eval.now", key: "Mod-Enter" },
      { action: "eval.soft", key: "Alt-j" },
    ];
    const resolver = createResolver({ defaults: bindings });
    const result = resolver.rebind("eval.soft", "Mod-Enter");
    expect(result.status).toBe("conflict");
    if (result.status !== "conflict") return;
    const types = result.suggestions.map((s) => s.type);
    expect(types).not.toContain("context-split");
    expect(types[0]).toBe("swap");
  });
});

describe("suggestChordTarget", () => {
  it("returns a free chord slot under the requested leader", () => {
    const bindings: KeyBinding[] = [
      { action: "eval.now", key: "Alt-e a" },
    ];
    const target = suggestChordTarget("Alt-e", bindings);
    expect(target).toBeTypeOf("string");
    expect(target!.startsWith("Alt-e ")).toBe(true);
    expect(target).not.toBe("Alt-e a");
  });

  it("returns undefined for a chord input", () => {
    expect(suggestChordTarget("Alt-e ]", [])).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Internal: reach into a CodeMirror keymap Extension to pull the first run fn.
// The keymap extension is a Prec-wrapped facet provider; its serialised shape
// holds the bindings under nested `value` arrays. We walk defensively.
// ---------------------------------------------------------------------------

function extractFirstRun(ext: unknown): ((v: any) => boolean) | null {
  const seen = new Set<unknown>();
  const stack: unknown[] = [ext];
  while (stack.length) {
    const node = stack.pop();
    if (node == null || typeof node !== "object" || seen.has(node)) continue;
    seen.add(node);
    const anyNode = node as Record<string, unknown>;
    if (typeof anyNode.run === "function" && typeof anyNode.key === "string") {
      return anyNode.run as (v: any) => boolean;
    }
    for (const v of Object.values(anyNode)) {
      if (Array.isArray(v)) stack.push(...v);
      else if (v && typeof v === "object") stack.push(v);
    }
  }
  return null;
}
