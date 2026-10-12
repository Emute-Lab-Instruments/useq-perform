/**
 * Sticky modifiers extension wiring test (keybindings.md §1.12).
 *
 * The store module was previously never imported anywhere (wiring gap). These
 * tests verify the exported CodeMirror extension latches a lone modifier
 * press, applies it to the next non-modifier keypress, and toggles off on a
 * second press — the behaviour the wiring in keymaps.ts installs.
 */

import { afterEach, describe, expect, it } from "vitest";
import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import {
  stickyModifiersExtension,
  stickyState,
  clearStickyState,
} from "./stickyModifiers.ts";

function makeView(): { view: EditorView; lastSeen: () => KeyboardEvent | null } {
  let last: KeyboardEvent | null = null;
  // Registered after the sticky extension, so it observes the synthetic
  // re-dispatch (the sticky handler runs first and consumes the original).
  const observer: Extension = EditorView.domEventHandlers({
    keydown(event) {
      last = event;
      return false;
    },
  });
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    parent,
    extensions: [stickyModifiersExtension(), observer],
  });
  return { view, lastSeen: () => last };
}

function press(view: EditorView, key: string, mods: KeyboardEventInit = {}): boolean {
  return view.contentDOM.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...mods }),
  );
}

function release(view: EditorView, key: string): boolean {
  return view.contentDOM.dispatchEvent(
    new KeyboardEvent("keyup", { key, bubbles: true, cancelable: true }),
  );
}

afterEach(() => {
  clearStickyState();
  document.body.innerHTML = "";
});

describe("stickyModifiersExtension", () => {
  it("latches a lone modifier press and applies it to the next key", () => {
    const { view, lastSeen } = makeView();

    press(view, "Shift");
    release(view, "Shift");
    expect(stickyState().shift).toBe(true);

    // Plain "s" press is seen downstream with Shift applied.
    press(view, "s");
    expect(lastSeen()?.shiftKey).toBe(true);

    // And the sticky state was consumed.
    expect(stickyState().shift).toBe(false);
  });

  it("does not latch when another key was pressed in between", () => {
    const { view } = makeView();

    press(view, "Shift");
    press(view, "s"); // normal combo — not a lone modifier
    release(view, "Shift");
    expect(stickyState().shift).toBe(false);
  });

  it("a second lone press of the same modifier unsticks it", () => {
    const { view, lastSeen } = makeView();

    press(view, "Alt");
    release(view, "Alt");
    expect(stickyState().alt).toBe(true);

    press(view, "Alt"); // toggle off
    expect(stickyState().alt).toBe(false);

    press(view, "s");
    expect(lastSeen()?.altKey).toBe(false);
  });
});
