/**
 * Policy-key precedence + live-rebind propagation (errata keys cluster).
 *
 * (a) A conditional registry binding on a policy key whose context is active
 *     must run before the router's policy fallback: Enter confirms the
 *     live-edit vector mark (live-edit.md §3.7.3/§3.7.8) instead of inserting
 *     a newline while `vectorMark.active`. Regression for the
 *     Prec.highest policy keymap shadowing the Prec.high conditional binding.
 * (b) `resolver.rebind()` followed by `refreshKeymapExtensions()` must reach
 *     a live EditorView without a reload (keybindings.md §1.9; the Keybindings
 *     panel rebind path previously left the editor keymap stale).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";

// keymaps.ts transitively pulls in the transport stack (via the settings
// repository), which has a fragile circular import at module init under
// Vitest. Stub the transport entry points out (same pattern as
// keymaps.boot.test.ts).
vi.mock("../transport/connector.ts", () => ({
  checkForSavedPortAndMaybeConnect: () => undefined,
}));
vi.mock("../transport/webSerialHostPort", () => ({
  webSerialHostPort: { kind: "web-serial-host" },
}));

// Replace the handler registry with stubs so the test observes exactly which
// action the keymap layer invokes, independent of editor/structural state.
const handlerCalls: string[] = [];
const stubHandlers: Record<string, (view?: unknown) => boolean> = {
  "liveEdit.vectorConfirm": () => {
    handlerCalls.push("liveEdit.vectorConfirm");
    return true;
  },
  "liveEdit.vectorCancel": () => true,
  "panel.help": () => {
    handlerCalls.push("panel.help");
    return true;
  },
};
vi.mock("./commands/actionHandlers.ts", () => ({
  getHandler: (id: string) => stubHandlers[id],
  executeAction: (id: string) => Boolean(stubHandlers[id]?.()),
  selectMainMenuAction: () => true,
}));

installMockStorage();
const { baseKeymap, refreshKeymapExtensions, resolver } = await import(
  "./keymaps.ts"
);
const { registerContext } = await import("../lib/keybindings/contexts.ts");

function installMockStorage(): void {
  const store: Record<string, string> = {};
  const storage = {
    getItem: (key: string) => (key in store ? store[key] : null),
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      for (const key of Object.keys(store)) delete store[key];
    },
  };
  Object.defineProperty(window, "localStorage", {
    value: storage,
    configurable: true,
    writable: true,
  });
}

let view: EditorView;
let vectorMarkActive = false;

function pressKey(init: KeyboardEventInit): boolean {
  return view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", init));
}

beforeEach(() => {
  handlerCalls.length = 0;
  vectorMarkActive = false;
  registerContext("vectorMark.active", () => vectorMarkActive);
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  view = new EditorView({ doc: "(a b)", parent, extensions: baseKeymap });
});

afterEach(() => {
  view.destroy();
  document.body.innerHTML = "";
  registerContext("vectorMark.active", () => false);
});

describe("policy keys defer to active conditional bindings", () => {
  it("Enter inserts a newline when no sub-mode owns it", () => {
    pressKey({ key: "Enter", bubbles: true, cancelable: true });
    expect(handlerCalls).toEqual([]);
    expect(view.state.doc.toString()).toBe("\n(a b)");
  });

  it("Enter confirms the vector mark while vectorMark.active (live-edit.md §3.7.3)", () => {
    vectorMarkActive = true;
    pressKey({ key: "Enter", bubbles: true, cancelable: true });
    expect(handlerCalls).toEqual(["liveEdit.vectorConfirm"]);
    // No newline inserted — the policy fallback never ran.
    expect(view.state.doc.toString()).toBe("(a b)");
  });
});

describe("rebind propagates to live editors without a reload", () => {
  it("runs the new key and stops running the old key after rebind + refresh", () => {
    // panel.help is Alt-/ by default.
    pressKey({ key: "/", altKey: true, bubbles: true, cancelable: true });
    expect(handlerCalls).toEqual(["panel.help"]);
    handlerCalls.length = 0;

    // Alt-j is unbound in the default profile — no conflict.
    expect(resolver.rebind("panel.help", "Alt-j").status).toBe("ok");
    refreshKeymapExtensions();

    pressKey({ key: "j", altKey: true, bubbles: true, cancelable: true });
    expect(handlerCalls).toEqual(["panel.help"]);

    handlerCalls.length = 0;
    pressKey({ key: "/", altKey: true, bubbles: true, cancelable: true });
    expect(handlerCalls).toEqual([]);
  });
});
