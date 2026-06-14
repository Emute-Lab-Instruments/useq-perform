/**
 * [T11] Manual-control live-value wire format
 * (wire-protocol.md §5.8 set-live-inputs + §6.5 binary INPUT_SET fast-path).
 *
 * Two complementary editor→device paths, exercised here through the real
 * command router (executeEditorCommand — the same code path keypresses,
 * gamepad axis events, and menus use):
 *
 *   1. DECLARATION (§5.8): activating a manual-control binding registers the
 *      live input via the JSON `set-live-inputs` request, keyed by the matching
 *      `ssinN` id, so the device allocates the slot.
 *
 *   2. SCRUB (§6.5): high-rate continuous value updates are emitted as the
 *      compact binary `INPUT_SET` frame
 *      `[0x1F][0x01][count:u16-LE][slot_index:u16-LE][value:f64-LE]`
 *      — NOT a JSON message per sample, and NOT the old malformed
 *      type-byte-less `[0x1F][channel:u8][value:f64]` frame.
 *
 * The binary fast-path requires a synced id→slot_index map (from get-state).
 * Until synced, scrub falls back to set-live-inputs; once synced (we call
 * syncLiveSlotIndex directly here to model a post-eval get-state) scrub emits
 * the binary frame.
 *
 * `sendSetLiveInputs` and `sendBinaryInputSet` are spied; the rest of the
 * transport module is left intact so we capture exactly what the editor asks
 * the wire to send.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
// @ts-expect-error — no type declarations for clojure-mode
import { default_extensions } from "@nextjournal/clojure-mode";
import { executeEditorCommand } from "./commands/editorCommandRouter.ts";
import { clearManualControlBinding } from "../lib/manualControlState.ts";
import {
  syncLiveSlotIndex,
  clearLiveSlotIndex,
} from "../lib/liveSlotIndex.ts";
import type { BinaryInputSetEntry } from "../transport/json-protocol.ts";

const sendSetLiveInputsMock = vi.fn(() => Promise.resolve());
const sendBinaryInputSetMock = vi.fn(() => Promise.resolve());

vi.mock("../transport/json-protocol.ts", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    sendSetLiveInputs: (...args: unknown[]) => sendSetLiveInputsMock(...args),
    sendBinaryInputSet: (...args: unknown[]) => sendBinaryInputSetMock(...args),
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

describe("[T11] manual-control live-value wire format (§5.8 declare + §6.5 scrub)", () => {
  beforeEach(() => {
    sendSetLiveInputsMock.mockClear();
    sendBinaryInputSetMock.mockClear();
    clearLiveSlotIndex();
    clearManualControlBinding("left");
    clearManualControlBinding("right");
  });

  afterEach(() => {
    clearLiveSlotIndex();
    clearManualControlBinding("left");
    clearManualControlBinding("right");
  });

  it("activating a binding DECLARES the slot via set-live-inputs keyed by ssinN", async () => {
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

    // Declaration goes through set-live-inputs, addressed to `ssin17`.
    expect(sendSetLiveInputsMock).toHaveBeenCalledTimes(1);
    const slots = sendSetLiveInputsMock.mock.calls[0][0] as Record<string, unknown>;
    expect(slots).toEqual({ ssin17: 0.5 });
    // No binary frame on declaration.
    expect(sendBinaryInputSetMock).not.toHaveBeenCalled();

    view.destroy();
  });

  it("a scrub emits a WELL-FORMED binary INPUT_SET frame once the slot map is synced", async () => {
    const view = createView("(a1 0.5)", 5);

    executeEditorCommand(view, {
      kind: "toggleManualControl",
      stick: "left", // slot 1 → ssin1
      source: "test",
    });
    await flushMicrotasks();

    // Model a post-eval get-state: `ssin1` declared first → slot_index 0.
    syncLiveSlotIndex([{ id: "ssin1" }, { id: "ssin17" }]);

    sendSetLiveInputsMock.mockClear();
    sendBinaryInputSetMock.mockClear();

    // Scrub the value down. nowMs large enough to clear the rate-limit window.
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

    // Scrub uses the binary fast-path, NOT JSON set-live-inputs.
    expect(sendSetLiveInputsMock).not.toHaveBeenCalled();
    expect(sendBinaryInputSetMock).toHaveBeenCalledTimes(1);

    const entries = sendBinaryInputSetMock.mock.calls[0][0] as BinaryInputSetEntry[];
    expect(entries).toHaveLength(1);
    expect(entries[0].slotIndex).toBe(0); // ssin1 → index 0
    expect(Number.isFinite(entries[0].value)).toBe(true);
    expect(entries[0].value).not.toBe(0.5); // value moved off the seed

    // Build the actual frame via the real transport builder and decode it,
    // asserting each field byte-for-byte against the §6.5 contract.
    const realTransport = await vi.importActual<Record<string, unknown>>(
      "../transport/json-protocol.ts",
    );
    const buildFrame = realTransport.buildBinaryInputSetFrame as (
      e: ReadonlyArray<BinaryInputSetEntry>,
    ) => Uint8Array;
    const frame = buildFrame(entries);

    // Total length = 4 + 10*count.
    expect(frame.length).toBe(4 + 10 * 1);

    const dv = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    expect(dv.getUint8(0)).toBe(0x1f); // message_begin_marker
    expect(dv.getUint8(1)).toBe(0x01); // type = INPUT_SET (real type byte)
    expect(dv.getUint16(2, /* LE */ true)).toBe(1); // count
    expect(dv.getUint16(4, true)).toBe(0); // slot_index = 0 (ssin1)
    expect(dv.getFloat64(6, true)).toBe(entries[0].value); // f64-LE value

    view.destroy();
  });

  it("scrub falls back to set-live-inputs when the slot map is NOT synced", async () => {
    const view = createView("(a1 0.5)", 5);

    executeEditorCommand(view, {
      kind: "toggleManualControl",
      stick: "left", // slot 1 → ssin1
      source: "test",
    });
    await flushMicrotasks();

    // Deliberately leave the map unsynced (clearLiveSlotIndex in beforeEach).
    sendSetLiveInputsMock.mockClear();
    sendBinaryInputSetMock.mockClear();

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

    // No synced index → fall back to JSON set-live-inputs, no binary frame.
    expect(sendBinaryInputSetMock).not.toHaveBeenCalled();
    expect(sendSetLiveInputsMock).toHaveBeenCalledTimes(1);
    const slots = sendSetLiveInputsMock.mock.calls[0][0] as Record<string, number>;
    expect(Object.keys(slots)).toEqual(["ssin1"]);
    expect(Number.isFinite(slots.ssin1)).toBe(true);
    expect(slots.ssin1).not.toBe(0.5);

    view.destroy();
  });

  it("the malformed type-byte-less binary input-stream sender no longer exists", async () => {
    // The old 10-byte `[0x1F][channel:u8][value:f64]` builder must be gone; the
    // conforming binary path is sendBinaryInputSet (type-tagged, length-prefixed).
    const mod = await vi.importActual<Record<string, unknown>>(
      "../transport/json-protocol.ts",
    );
    expect(mod.sendSerialInputStreamValue).toBeUndefined();
    expect(typeof mod.sendSetLiveInputs).toBe("function");
    expect(typeof mod.sendBinaryInputSet).toBe("function");
    expect(typeof mod.buildBinaryInputSetFrame).toBe("function");
  });
});
