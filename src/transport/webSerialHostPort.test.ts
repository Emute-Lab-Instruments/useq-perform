/**
 * Focused tests for webSerialHostPort.evalCodeWithDiagnostics result mapping.
 *
 * Errata eval-r-legacy-success: the hardware eval path must not report
 * success for evals that never reached or were rejected by the device.
 * The mapping contract locked here:
 * - a JSON eval reply with success:false maps to success:false;
 * - a legacy delivered-eval (sendTouSEQ resolves void → undefined response)
 *   still maps to success:true: legacy firmware has no correlated response,
 *   byte delivery is the only available signal;
 * - the explicit { success:false, error } envelope sentTouSEQ now resolves
 *   for an unwritable port maps to success:false with the error preserved.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const sendTouSEQMock = vi.fn();
const sendGetStateMock = vi.fn();
const getProtocolModeMock = vi.fn(() => "json" as const);

vi.mock("./json-protocol.ts", () => ({
  sendTouSEQ: (code: string, capture?: unknown) => sendTouSEQMock(code, capture),
  sendGetState: () => sendGetStateMock(),
  getProtocolMode: () => getProtocolModeMock(),
}));

vi.mock("./connector.ts", () => ({
  getSerialPort: () => null,
  isConnectedToModule: () => true,
  toggleConnect: () => Promise.resolve(),
}));

import { webSerialHostPort } from "./webSerialHostPort.ts";

describe("evalCodeWithDiagnostics result mapping", () => {
  beforeEach(() => {
    sendTouSEQMock.mockReset();
    sendGetStateMock.mockReset();
  });

  it("maps a successful JSON eval reply through", async () => {
    sendTouSEQMock.mockResolvedValue({
      success: true,
      text: "3",
      diagnostics: [{ severity: "warning", category: "c", start: 0, end: 1 }],
    });
    const result = await webSerialHostPort.evalCodeWithDiagnostics("(+ 1 2)");
    expect(result.success).toBe(true);
    expect(result.result).toBe("3");
    expect(result.diagnostics).toHaveLength(1);
  });

  it("maps a firmware success:false reply to success:false", async () => {
    sendTouSEQMock.mockResolvedValue({
      success: false,
      text: "",
      diagnostics: [],
      error: "compile error",
    });
    const result = await webSerialHostPort.evalCodeWithDiagnostics("(1 +");
    expect(result.success).toBe(false);
    expect(result.error).toBe("compile error");
  });

  it("treats a delivered legacy eval (void response) as success", async () => {
    sendTouSEQMock.mockResolvedValue(undefined);
    const result = await webSerialHostPort.evalCodeWithDiagnostics("(a1 t)");
    expect(result.success).toBe(true);
    expect(result.result).toBeNull();
    expect(result.diagnostics).toEqual([]);
  });

  it("maps the not-connected failure envelope to success:false", async () => {
    sendTouSEQMock.mockResolvedValue({
      success: false,
      error: "uSEQ not connected",
    });
    const result = await webSerialHostPort.evalCodeWithDiagnostics("(a1 t)");
    expect(result.success).toBe(false);
    expect(result.error).toBe("uSEQ not connected");
  });

  it("propagates transport rejections (timeout, negotiating) to the caller", async () => {
    sendTouSEQMock.mockRejectedValue(new Error("Request req-1 timed out"));
    await expect(
      webSerialHostPort.evalCodeWithDiagnostics("(+ 1 2)"),
    ).rejects.toThrow(/timed out/);
  });
});
