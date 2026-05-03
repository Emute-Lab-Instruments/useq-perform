/**
 * Tests for bracket-protection gates (editor.md §1.7, input-dispatch.md §4.1).
 *
 * All tests route through executeEditorCommand() — the same code path
 * that real keypresses, gamepad, menus, and the YAML harness use.
 *
 * Spec contract (preventBracketUnbalancing, default true):
 *   - ON:  Backspace/Delete before/on a closing delimiter is blocked.
 *          Backspace/Delete inside an empty pair removes both brackets.
 *   - OFF: plain deletion (deleteCharBackward / deleteCharForward).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
// @ts-expect-error — no type declarations for clojure-mode
import { default_extensions } from "@nextjournal/clojure-mode";
import {
  executeEditorCommand,
  type EditorCommand,
} from "./commands/editorCommandRouter.ts";
import { deleteConfirmField } from "./extensions/deleteConfirmFlash.ts";

// ---------------------------------------------------------------------------
// Mock heavy runtime dependencies pulled in by the router's import graph
// ---------------------------------------------------------------------------

vi.mock("../runtime/appSettingsRepository.ts", () => ({
  getAppSettings: vi.fn(() => ({ editor: {} })),
}));

vi.mock("../lib/debug.ts", () => ({
  dbg: vi.fn(),
}));

vi.mock("../ui/adapters/visualisationPanel", () => ({
  toggleVisualisationPanel: vi.fn(() => true),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createView(doc: string, cursorPos: number): EditorView {
  return new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      selection: { anchor: cursorPos },
      extensions: [...default_extensions, deleteConfirmField],
    }),
  });
}

function backspace(
  view: EditorView,
  opts?: { allowBracketUnbalancing?: boolean },
): boolean {
  return executeEditorCommand(view, {
    kind: "key",
    key: "Backspace",
    allowBracketUnbalancing: opts?.allowBracketUnbalancing,
    source: "test",
  });
}

function del(
  view: EditorView,
  opts?: { allowBracketUnbalancing?: boolean },
): boolean {
  return executeEditorCommand(view, {
    kind: "key",
    key: "Delete",
    allowBracketUnbalancing: opts?.allowBracketUnbalancing,
    source: "test",
  });
}

afterEach(() => {
  document.body.innerHTML = "";
});

// ---------------------------------------------------------------------------
// 1. Backspace — protection ON (allowBracketUnbalancing: false/default)
// ---------------------------------------------------------------------------

describe("Backspace — protection ON", () => {
  it("blocks backspace when cursor is after closing paren (first press)", () => {
    const view = createView("(foo)", 5);
    backspace(view);
    expect(view.state.doc.toString()).toBe("(foo)");
    view.destroy();
  });

  it("deletes whole form on second backspace after closing paren (escalation)", () => {
    const view = createView("(foo)", 5);
    backspace(view); // first: blocked
    backspace(view); // second: delete
    expect(view.state.doc.toString()).toBe("");
    view.destroy();
  });

  it("blocks backspace when cursor is after closing bracket (first press)", () => {
    const view = createView("[bar]", 5);
    backspace(view);
    expect(view.state.doc.toString()).toBe("[bar]");
    view.destroy();
  });

  it("deletes whole form on second backspace after closing bracket (escalation)", () => {
    const view = createView("[bar]", 5);
    backspace(view); // first: blocked
    backspace(view); // second: delete
    expect(view.state.doc.toString()).toBe("");
    view.destroy();
  });

  it("blocks backspace when cursor is after closing quote of string (first press)", () => {
    const view = createView('"hello"', 7);
    backspace(view);
    expect(view.state.doc.toString()).toBe('"hello"');
    view.destroy();
  });

  it("deletes whole string on second backspace after closing quote (escalation)", () => {
    const view = createView('"hello"', 7);
    backspace(view); // first: blocked
    backspace(view); // second: delete
    expect(view.state.doc.toString()).toBe("");
    view.destroy();
  });

  it("blocks backspace after string inside list (targets list, not string)", () => {
    const view = createView('(a "hello")', 11);
    backspace(view);
    expect(view.state.doc.toString()).toBe('(a "hello")');
    view.destroy();
  });

  it("deletes whole list on second backspace when string is inside (escalation)", () => {
    const view = createView('(a "hello")', 11);
    backspace(view); // first: blocked
    backspace(view); // second: delete
    expect(view.state.doc.toString()).toBe("");
    view.destroy();
  });

  it("deletes both brackets of an empty () pair", () => {
    const view = createView("()", 1);
    backspace(view);
    expect(view.state.doc.toString()).toBe("");
    view.destroy();
  });

  it("deletes a normal character before cursor", () => {
    const view = createView("(abc)", 3); // cursor after 'b'
    backspace(view);
    expect(view.state.doc.toString()).toBe("(ac)");
    view.destroy();
  });
});

// ---------------------------------------------------------------------------
// 2. Backspace — protection OFF (allowBracketUnbalancing: true)
// ---------------------------------------------------------------------------

describe("Backspace — protection OFF", () => {
  it("deletes the closing paren when cursor is after it", () => {
    const view = createView("(foo)", 5);
    backspace(view, { allowBracketUnbalancing: true });
    expect(view.state.doc.toString()).not.toContain(")");
    view.destroy();
  });

  it("deletes the closing bracket when cursor is after it", () => {
    const view = createView("[bar]", 5);
    backspace(view, { allowBracketUnbalancing: true });
    expect(view.state.doc.toString()).not.toContain("]");
    view.destroy();
  });
});

// ---------------------------------------------------------------------------
// 3. Delete — protection ON
// ---------------------------------------------------------------------------

describe("Delete — protection ON", () => {
  it("deletes both brackets of an empty () pair", () => {
    const view = createView("()", 1);
    del(view);
    expect(view.state.doc.toString()).toBe("");
    view.destroy();
  });

  it("deletes both brackets of an empty [] pair", () => {
    const view = createView("[]", 1);
    del(view);
    expect(view.state.doc.toString()).toBe("");
    view.destroy();
  });

  it("deletes both brackets of an empty {} pair", () => {
    const view = createView("{}", 1);
    del(view);
    expect(view.state.doc.toString()).toBe("");
    view.destroy();
  });

  it("blocks Delete when cursor is before a closing paren in non-empty form", () => {
    const view = createView("(foo)", 4); // cursor before ')'
    del(view);
    expect(view.state.doc.toString()).toBe("(foo)");
    view.destroy();
  });
});

// ---------------------------------------------------------------------------
// 4. Delete — protection OFF
// ---------------------------------------------------------------------------

describe("Delete — protection OFF", () => {
  it("deletes the closing paren forward", () => {
    const view = createView("(foo)", 4); // cursor before ')'
    del(view, { allowBracketUnbalancing: true });
    expect(view.state.doc.toString()).not.toContain(")");
    view.destroy();
  });
});
