// src/effects/__tests__/hardwareBindingPreview.test.ts
//
// Tests for the binding wasm-preview lifecycle seam (hardware-bindings.md §4.4).
// A soft-eval registers bindings on WASM only; a normal eval lifts them to
// hardware. The dispatcher tracks this per `${event}:${inputId}` key and the
// chip widget renders a distinct `wasm-preview` tone.

import { describe, it, expect, beforeEach } from "vitest";
import {
  bindingKeysInText,
  markBindingsSoftPreview,
  clearBindingsSoftPreview,
  isBindingSoftPreview,
} from "../hardwareBindingDispatcher.ts";

describe("binding wasm-preview lifecycle (§4.4)", () => {
  beforeEach(() => {
    // Ensure a clean preview set between tests.
    clearBindingsSoftPreview([
      "on-press::sw1",
      "on-release::sw1",
      "on-button::sw2",
      "on-toggle::swr",
    ]);
  });

  it("derives ${event}:${inputId} keys from binding forms in text", () => {
    const text = `
      (on-press :sw1 (set-output a1 1))
      (on-button :sw2 (lambda (phase ms) ms))
      (not-a-binding :sw9 nope)
    `;
    const keys = bindingKeysInText(text);
    expect(keys).toContain("on-press::sw1");
    expect(keys).toContain("on-button::sw2");
    expect(keys).not.toContain("not-a-binding::sw9");
  });

  it("marks bindings as preview and lifts them on clear", () => {
    const keys = bindingKeysInText("(on-press :sw1 (set-output a1 1))");
    expect(isBindingSoftPreview("on-press::sw1")).toBe(false);

    markBindingsSoftPreview(keys);
    expect(isBindingSoftPreview("on-press::sw1")).toBe(true);

    clearBindingsSoftPreview(keys);
    expect(isBindingSoftPreview("on-press::sw1")).toBe(false);
  });

  it("ignores binding forms inside comments when keying", () => {
    const text = "  ;; (on-press :sw1 commented out)\n(on-toggle :swr ok)";
    const keys = bindingKeysInText(text);
    expect(keys).toEqual(["on-toggle::swr"]);
  });
});
