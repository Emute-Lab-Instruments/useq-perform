/**
 * Tests for bracket-protection gates (editor.md §1.7).
 *
 * Spec contract: editor.preventBracketUnbalancing (default true)
 *   - ON:  clojure-mode's bracket-aware deletion refuses to break parens/brackets/quotes
 *   - OFF: deletion is normal (plain deleteCharBackward for Backspace)
 *
 * Implementation:
 *   Backspace — keymaps.ts Prec.highest gate:
 *     ON  → returns false, clojure-mode Backspace fires (refuses to delete closing brackets)
 *     OFF → calls deleteCharBackward (plain; deletes the char before cursor)
 *
 *   Delete — editorKeyboard.ts makeDeleteWrapper:
 *     ON  + empty pair ()/{}/[] → deletes both brackets at once
 *     ON  + other positions     → falls through to clojure-mode Delete
 *     OFF                       → calls clojure-mode Delete (same as above non-pair case)
 *
 * Test positions use "cursor AFTER the bracket" for Backspace (Backspace would delete it)
 * and "cursor INSIDE empty pair" for Delete (the only distinguishable case).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap, runScopeHandlers } from "@codemirror/view";
import { deleteCharBackward } from "@codemirror/commands";
// @ts-expect-error — no type declarations for clojure-mode
import { complete_keymap, default_extensions } from "@nextjournal/clojure-mode";
import { makeDeleteWrapper } from "./editorKeyboard.ts";

// ---------------------------------------------------------------------------
// Mock heavy runtime dependencies
// ---------------------------------------------------------------------------

let mockPreventBracketUnbalancing = true;

vi.mock("../runtime/appSettingsRepository.ts", () => ({
  getAppSettings: vi.fn(() => ({
    editor: { preventBracketUnbalancing: mockPreventBracketUnbalancing },
  })),
}));

vi.mock("../lib/debug.ts", () => ({
  dbg: vi.fn(),
}));

vi.mock("../ui/adapters/visualisationPanel", () => ({
  toggleVisualisationPanel: vi.fn(() => true),
}));

// ---------------------------------------------------------------------------
// EditorView factory that mirrors the bracket-protection keymap
//
// We replicate the essential keymap pieces from keymaps.ts without
// importing it (avoids pulling in the full evaluation/handler chain).
// ---------------------------------------------------------------------------

function createView(doc: string, cursorPos: number): EditorView {
  const clojureDeleteBinding = complete_keymap.find(
    (b: { key: string | null }) => b.key === "Delete",
  );
  if (!clojureDeleteBinding) throw new Error("clojure-mode Delete binding not found");

  // Delete wrapper reads mockPreventBracketUnbalancing via the mocked getAppSettings
  const deleteWrapper = {
    key: "Delete" as const,
    run: makeDeleteWrapper(clojureDeleteBinding.run),
  };

  // Backspace gate — mirrors keymaps.ts Prec.highest binding
  const backspaceGate = Prec.highest(
    keymap.of([
      {
        key: "Backspace",
        run: (view) => {
          if (!mockPreventBracketUnbalancing) {
            // Protection OFF: plain deletion takes precedence
            return deleteCharBackward(view);
          }
          // Protection ON: let lower-priority clojure-mode Backspace handle it
          return false;
        },
      },
    ]),
  );

  return new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      selection: { anchor: cursorPos },
      extensions: [
        ...default_extensions,
        backspaceGate,
        keymap.of([deleteWrapper]),
        // Remaining clojure-mode bindings (Backspace + others, not Delete)
        keymap.of(complete_keymap.filter((b: { key: string | null }) => b.key !== "Delete")),
      ],
    }),
  });
}

function pressKey(view: EditorView, key: string): boolean {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
  });
  return runScopeHandlers(view, event, "editor");
}

afterEach(() => {
  document.body.innerHTML = "";
  mockPreventBracketUnbalancing = true;
});

// ---------------------------------------------------------------------------
// 1. Backspace — protection ON
//
// When the gate is ON it returns false, handing control to clojure-mode's
// Backspace, which refuses to delete a closing paren/bracket/quote.
// Cursor position: immediately AFTER the closing bracket so that a plain
// Backspace would delete the bracket.
// ---------------------------------------------------------------------------

describe("Backspace — protection ON (preventBracketUnbalancing: true)", () => {
  beforeEach(() => {
    mockPreventBracketUnbalancing = true;
  });

  it("does nothing when cursor is after a closing paren", () => {
    // "(foo)" — cursor at pos 5, after ")"; plain BS would delete ")"
    const doc = "(foo)";
    const view = createView(doc, doc.length); // pos 5

    pressKey(view, "Backspace");

    // clojure-mode refuses to delete ")" → document unchanged
    expect(view.state.doc.toString()).toBe("(foo)");
    view.destroy();
  });

  it("does nothing when cursor is after a closing bracket", () => {
    // "[bar]" — cursor at pos 5, after "]"
    const doc = "[bar]";
    const view = createView(doc, doc.length);

    pressKey(view, "Backspace");

    expect(view.state.doc.toString()).toBe("[bar]");
    view.destroy();
  });

  it("does nothing when cursor is after a closing double-quote", () => {
    // '(a "hello")' — cursor after the closing '"'
    const doc = '(a "hello")';
    const closingQuotePos = doc.lastIndexOf('"') + 1;
    const view = createView(doc, closingQuotePos);

    pressKey(view, "Backspace");

    // clojure-mode refuses to delete '"' → document unchanged
    expect(view.state.doc.toString()).toBe('(a "hello")');
    view.destroy();
  });
});

// ---------------------------------------------------------------------------
// 2. Backspace — protection OFF
//
// When the gate is OFF it calls deleteCharBackward, which deletes the
// character immediately before the cursor (the closing bracket).
// ---------------------------------------------------------------------------

describe("Backspace — protection OFF (preventBracketUnbalancing: false)", () => {
  beforeEach(() => {
    mockPreventBracketUnbalancing = false;
  });

  it("deletes the closing paren when cursor is after it", () => {
    // "(foo)" — cursor at pos 5; plain BS deletes ")"
    // The clojure format extension may add trailing whitespace after deletion,
    // so we assert the ")" is gone rather than the exact resulting string.
    const doc = "(foo)";
    const view = createView(doc, doc.length);

    pressKey(view, "Backspace");

    expect(view.state.doc.toString()).not.toContain(")");
    view.destroy();
  });

  it("deletes the closing bracket when cursor is after it", () => {
    // "[bar]" — cursor at pos 5; plain BS deletes "]"
    const doc = "[bar]";
    const view = createView(doc, doc.length);

    pressKey(view, "Backspace");

    expect(view.state.doc.toString()).not.toContain("]");
    view.destroy();
  });

  it("deletes the closing double-quote when cursor is after it", () => {
    // '(a "hello")' — cursor after closing '"'; plain BS deletes the closing '"'
    const doc = '(a "hello")';
    const closingQuotePos = doc.lastIndexOf('"') + 1;
    const view = createView(doc, closingQuotePos);
    const quoteCountBefore = (doc.match(/"/g) ?? []).length;

    pressKey(view, "Backspace");

    // One '"' should be removed (the closing one)
    const result = view.state.doc.toString();
    const quoteCountAfter = (result.match(/"/g) ?? []).length;
    expect(quoteCountAfter).toBe(quoteCountBefore - 1);
    view.destroy();
  });
});

// ---------------------------------------------------------------------------
// 3. Delete — protection ON
//
// makeDeleteWrapper special-cases the cursor sitting inside an EMPTY pair:
// when protection is ON it deletes both brackets at once (normalising the
// empty form), whereas protection OFF delegates to clojure-mode's Delete
// which removes only the forward character.
//
// For non-empty forms, ON and OFF both call clojure-mode's Delete (same
// behaviour) — that case is not repeated here since it would not distinguish
// the two modes.
// ---------------------------------------------------------------------------

describe("Delete — protection ON (preventBracketUnbalancing: true)", () => {
  beforeEach(() => {
    mockPreventBracketUnbalancing = true;
  });

  it("deletes both brackets of an empty () pair at once", () => {
    // "()" — cursor at pos 1, between "(" and ")"
    const view = createView("()", 1);

    pressKey(view, "Delete");

    // Both brackets removed: "" (the empty pair is cleanly erased)
    expect(view.state.doc.toString()).toBe("");
    view.destroy();
  });

  it("deletes both brackets of an empty [] pair at once", () => {
    const view = createView("[]", 1);

    pressKey(view, "Delete");

    expect(view.state.doc.toString()).toBe("");
    view.destroy();
  });

  it("deletes both brackets of an empty {} pair at once", () => {
    const view = createView("{}", 1);

    pressKey(view, "Delete");

    expect(view.state.doc.toString()).toBe("");
    view.destroy();
  });
});

// ---------------------------------------------------------------------------
// 4. Delete — protection OFF
//
// With protection OFF, makeDeleteWrapper calls clojure-mode's Delete
// directly, which forward-deletes the closing bracket (leaving the opening
// bracket unpaired — the user explicitly opted out of protection).
// ---------------------------------------------------------------------------

describe("Delete — protection OFF (preventBracketUnbalancing: false)", () => {
  beforeEach(() => {
    mockPreventBracketUnbalancing = false;
  });

  it("delegates to clojure-mode Delete for empty () — deletes only the )", () => {
    // "()" — cursor at pos 1; clojure-mode deletes ")" forward, leaving "("
    const view = createView("()", 1);

    pressKey(view, "Delete");

    expect(view.state.doc.toString()).toBe("(");
    view.destroy();
  });

  it("delegates to clojure-mode Delete for empty [] — deletes only the ]", () => {
    const view = createView("[]", 1);

    pressKey(view, "Delete");

    expect(view.state.doc.toString()).toBe("[");
    view.destroy();
  });
});
