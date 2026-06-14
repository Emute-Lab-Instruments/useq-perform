/**
 * [T11] Manual-control live-value wire format (wire-protocol.md §5.8 / §6.5 NOTE).
 *
 * The editor's manual-control path (joystick scrub on a bound number,
 * rewritten to `(ssin N)`) MUST push live values to the device via the JSON
 * `set-live-inputs` request (§5.8) keyed by the matching `ssinN` input id —
 * NOT via the malformed type-byte-less 10-byte binary frame
 * (`[0x1F][channel:u8][value:f64]`) that an earlier build emitted.
 *
 * These tests route through executeEditorCommand() — the same code path real
 * keypresses, gamepad axis events, and menus use. sendSetLiveInputs is spied
 * (the rest of the transport module is left intact) so we capture exactly
 * what the editor asks the wire to send.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
// @ts-expect-error — no type declarations for clojure-mode
import { default_extensions } from "@nextjournal/clojure-mode";
import { executeEditorCommand } from "./commands/editorCommandRouter.ts";
import { clearManualControlBinding } from "../lib/manualControlState.ts";

const sendSetLiveInputsMock = vi.fn(() => Promise.resolve());

vi.mock("../transport/json-protocol.ts", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    sendSetLiveInputs: (...args: unknown[]) => sendSetLiveInputsMock(...args),
  };
});

function createView(doc: string, cursorPos: number): EditorView {
  // No `parent` — keep the view detached so CodeMirror doesn't schedule a
  // jsdom layout measurement (getClientRects is unimplemented in jsdom).
  return new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor: cursorPos },
      extensions: [...default_extensions],
    }),
  });
}

/** Let the router's dynamic import() resolve (it spans a macrotask). */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("[T11] manual-control live-value wire format (wire-protocol.md §5.8)", () => {
  beforeEach(() => {
    sendSetLiveInputsMock.mockClear();
    clearManualControlBinding("left");
    clearManualControlBinding("right");
  });

  afterEach(() => {
    clearManualControlBinding("left");
    clearManualControlBinding("right");
  });

  it("binding a number routes through set-live-inputs keyed by ssinN, not a binary frame", async () => {
    // Cursor on the number `0.5` in `(a1 0.5)`.
    const view = createView("(a1 0.5)", 5);

    // Right stick → slot 17 → `(ssin 17)` → live id `ssin17`.
    const bound = executeEditorCommand(view, {
      kind: "toggleManualControl",
      stick: "right",
      source: "test",
    });
    expect(bound).toBe(true);

    await flushMicrotasks();

    // Exactly one spec-conformant set-live-inputs send, addressed to `ssin17`.
    expect(sendSetLiveInputsMock).toHaveBeenCalledTimes(1);
    const slots = sendSetLiveInputsMock.mock.calls[0][0] as Record<string, unknown>;
    expect(slots).toEqual({ ssin17: 0.5 });

    view.destroy();
  });

  it("joystick scrub updates the bound value via set-live-inputs (well-formed slot/value)", async () => {
    const view = createView("(a1 0.5)", 5);

    executeEditorCommand(view, {
      kind: "toggleManualControl",
      stick: "left", // slot 1 → ssin1
      source: "test",
    });
    await flushMicrotasks();
    sendSetLiveInputsMock.mockClear();

    // Push the value down via a y-axis tilt. nowMs large enough to clear the
    // rate-limit window (lastSentAt was 0 at bind time).
    const updated = executeEditorCommand(view, {
      kind: "manualControlAxis",
      stick: "left",
      x: 0,
      y: 1,
      nowMs: 1000,
      source: "test",
    });
    expect(updated).toBe(true);

    await flushMicrotasks();

    expect(sendSetLiveInputsMock).toHaveBeenCalledTimes(1);
    const slots = sendSetLiveInputsMock.mock.calls[0][0] as Record<string, number>;

    // One slot, the correct id, a finite numeric value that moved off the seed.
    expect(Object.keys(slots)).toEqual(["ssin1"]);
    expect(Number.isFinite(slots.ssin1)).toBe(true);
    expect(slots.ssin1).not.toBe(0.5);

    view.destroy();
  });

  it("the malformed binary input-stream sender no longer exists on the transport", async () => {
    // The 10-byte type-byte-less binary frame builder must be gone; the only
    // editor→device live-value path is the JSON set-live-inputs request.
    const mod = await vi.importActual<Record<string, unknown>>(
      "../transport/json-protocol.ts",
    );
    expect(mod.sendSerialInputStreamValue).toBeUndefined();
    expect(typeof mod.sendSetLiveInputs).toBe("function");
  });
});
