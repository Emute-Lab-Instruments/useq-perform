/**
 * Context-gating of keyboard bindings (keybindings.md §1.7, §1.9).
 *
 * A binding carrying a `when` predicate must only fire when that context is
 * active; otherwise its `run` returns false so CodeMirror falls through to the
 * next binding on the same key. This pins the wiring of `evaluateWhen` into
 * `toKeymapExtensions` so the predicate is no longer dead.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { keymap, type KeyBinding as CMKeyBinding } from "@codemirror/view";
import { EditorState } from "@codemirror/state";

// Mock the handler registry so the gated action resolves to a spy we control.
const handlerSpy = vi.fn(() => true);
vi.mock("../handlers.ts", () => ({
  getHandler: () => handlerSpy,
}));

import { createResolver } from "../resolver.ts";
import { registerContext, evaluateWhen } from "../contexts.ts";
import type { KeyBinding } from "../defaults.ts";

/** Pull every CM binding out of the keymap facet across all extensions. */
function collectBindings(extensions: ReturnType<
  ReturnType<typeof createResolver>["toKeymapExtensions"]
>): CMKeyBinding[] {
  const state = EditorState.create({ extensions });
  const groups = state.facet(keymap);
  return groups.flat();
}

describe("when-clause gating in toKeymapExtensions", () => {
  afterEach(() => {
    handlerSpy.mockClear();
  });

  it("gated run returns false (handler skipped) when context inactive", () => {
    registerContext("test.gate", () => false);
    const defaults: KeyBinding[] = [
      { action: "edit.raise", key: "Mod-r", when: "test.gate" },
    ];
    const resolver = createResolver({ defaults });
    const bindings = collectBindings(resolver.toKeymapExtensions());

    const gated = bindings.find((b) => b.key === "Mod-r");
    expect(gated).toBeDefined();
    const result = gated!.run?.({} as never);
    expect(result).toBe(false);
    expect(handlerSpy).not.toHaveBeenCalled();
  });

  it("gated run invokes the handler when context active", () => {
    registerContext("test.gate", () => true);
    const defaults: KeyBinding[] = [
      { action: "edit.raise", key: "Mod-r", when: "test.gate" },
    ];
    const resolver = createResolver({ defaults });
    const bindings = collectBindings(resolver.toKeymapExtensions());

    const gated = bindings.find((b) => b.key === "Mod-r");
    expect(gated).toBeDefined();
    const result = gated!.run?.({} as never);
    expect(result).toBe(true);
    expect(handlerSpy).toHaveBeenCalledTimes(1);
  });

  it("unconditional binding still fires regardless of contexts", () => {
    const defaults: KeyBinding[] = [
      { action: "edit.raise", key: "Mod-r" },
    ];
    const resolver = createResolver({ defaults });
    const bindings = collectBindings(resolver.toKeymapExtensions());

    const b = bindings.find((x) => x.key === "Mod-r");
    expect(b?.run?.({} as never)).toBe(true);
    expect(handlerSpy).toHaveBeenCalledTimes(1);
  });

  it("evaluateWhen is exercised by the gate (sanity)", () => {
    registerContext("test.gate", () => false);
    expect(evaluateWhen("test.gate")).toBe(false);
    registerContext("test.gate", () => true);
    expect(evaluateWhen("test.gate")).toBe(true);
  });
});
