import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionChangedDetail } from "../contracts/runtimeChannels";

// Mock the heavy dependencies so importing the module under test does not pull
// in the transport/editor graph (and so we can observe calls). The confirm
// modal is injected via __test__.setConfirmPrompt (effects may not import ui).
const showConfirmModal = vi.fn();
const sendTouSEQ = vi.fn(() => Promise.resolve({}));
let editorContent: string | null = "(a1 (sin t))";

vi.mock("../transport/json-protocol.ts", () => ({
  sendTouSEQ: (code: string) => sendTouSEQ(code),
}));
vi.mock("../lib/editorStore.ts", () => ({
  getEditorContent: () => editorContent,
}));
vi.mock("../utils/consoleStore.ts", () => ({ post: vi.fn() }));
vi.mock("../lib/debug.ts", () => ({ dbg: vi.fn() }));

import { __test__ } from "./hardwareConnectPrompt.ts";

function detail(transportMode: ConnectionChangedDetail["transportMode"]): ConnectionChangedDetail {
  return {
    transportMode,
    connectionMode: transportMode === "both" ? "hardware" : "browser",
    hasHardwareConnection: transportMode === "both" || transportMode === "hardware",
    noModuleMode: false,
    wasmEnabled: true,
  } as ConnectionChangedDetail;
}

beforeEach(() => {
  showConfirmModal.mockClear();
  sendTouSEQ.mockClear();
  editorContent = "(a1 (sin t))";
  __test__.resetPreviousMode();
  __test__.setConfirmPrompt((opts) => showConfirmModal(opts));
});

afterEach(() => {
  __test__.resetPreviousMode();
  __test__.setConfirmPrompt(null);
});

describe("isWasmToBoth", () => {
  it("is true only for wasm → both", () => {
    expect(__test__.isWasmToBoth("wasm", "both")).toBe(true);
    expect(__test__.isWasmToBoth("both", "wasm")).toBe(false);
    expect(__test__.isWasmToBoth(null, "both")).toBe(false);
    expect(__test__.isWasmToBoth("hardware", "both")).toBe(false);
    expect(__test__.isWasmToBoth("wasm", "wasm")).toBe(false);
  });
});

describe("hardware-connect prompt (runtime-modes.md §1.7)", () => {
  it("prompts on a wasm → both transition with the spec message", () => {
    __test__.setPreviousMode("wasm");
    __test__.handleConnectionChanged(detail("both"));

    expect(showConfirmModal).toHaveBeenCalledTimes(1);
    const opts = showConfirmModal.mock.calls[0][0] as { message: string };
    expect(opts.message).toBe("Hardware connected. Send current program to device?");
  });

  it("sends the current editor program when confirmed", () => {
    __test__.setPreviousMode("wasm");
    __test__.handleConnectionChanged(detail("both"));

    const opts = showConfirmModal.mock.calls[0][0] as { onConfirm: () => void };
    opts.onConfirm();
    expect(sendTouSEQ).toHaveBeenCalledWith("(a1 (sin t))");
  });

  it("does not prompt on a fresh boot directly into both", () => {
    __test__.setPreviousMode(null);
    __test__.handleConnectionChanged(detail("both"));
    expect(showConfirmModal).not.toHaveBeenCalled();
  });

  it("does not prompt on disconnect (both → wasm)", () => {
    __test__.setPreviousMode("both");
    __test__.handleConnectionChanged(detail("wasm"));
    expect(showConfirmModal).not.toHaveBeenCalled();
  });

  it("does not prompt when the editor is empty", () => {
    editorContent = "   ";
    __test__.setPreviousMode("wasm");
    __test__.handleConnectionChanged(detail("both"));
    expect(showConfirmModal).not.toHaveBeenCalled();
  });
});
