import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock legacy modules to avoid jQuery/browser dependency issues
vi.mock("../../src/io/serialComms.mjs", () => ({
  sendTouSEQ: vi.fn(),
  isConnectedToModule: vi.fn(() => false),
  getSerialPort: vi.fn(() => null),
}));
vi.mock("../../src/io/useqWasmInterpreter.mjs", () => ({
  evalInUseqWasm: vi.fn(),
}));
vi.mock("../../src/utils/persistentUserSettings.mjs", () => ({
  activeUserSettings: { wasm: { enabled: true } },
}));

import { parseTransportState, extractTransportStateFromMeta, resolveTransportMode } from "./transport";
import { isConnectedToModule } from "../../src/io/serialComms.mjs";
import { activeUserSettings } from "../../src/utils/persistentUserSettings.mjs";

describe("parseTransportState", () => {
  it("parses 'playing'", () => {
    expect(parseTransportState("playing")).toBe("playing");
  });

  it("parses 'paused'", () => {
    expect(parseTransportState("paused")).toBe("paused");
  });

  it("parses 'stopped'", () => {
    expect(parseTransportState("stopped")).toBe("stopped");
  });

  it("trims whitespace", () => {
    expect(parseTransportState("  playing  ")).toBe("playing");
  });

  it("strips quotes from hardware response", () => {
    expect(parseTransportState('"paused"')).toBe("paused");
  });

  it("handles quoted with whitespace", () => {
    expect(parseTransportState('  "stopped"  ')).toBe("stopped");
  });

  it("returns null for unknown state", () => {
    expect(parseTransportState("unknown")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseTransportState("")).toBeNull();
  });
});

describe("extractTransportStateFromMeta", () => {
  it("extracts playing from meta.transport", () => {
    const detail = { response: { meta: { transport: "playing" } } };
    expect(extractTransportStateFromMeta(detail)).toBe("playing");
  });

  it("extracts paused from meta.transport", () => {
    const detail = { response: { meta: { transport: "paused" } } };
    expect(extractTransportStateFromMeta(detail)).toBe("paused");
  });

  it("extracts stopped from meta.transport", () => {
    const detail = { response: { meta: { transport: "stopped" } } };
    expect(extractTransportStateFromMeta(detail)).toBe("stopped");
  });

  it("returns null when meta is missing", () => {
    expect(extractTransportStateFromMeta({ response: {} })).toBeNull();
  });

  it("returns null when meta.transport is not a string", () => {
    const detail = { response: { meta: { transport: 42 } } };
    expect(extractTransportStateFromMeta(detail)).toBeNull();
  });

  it("returns null when detail is null", () => {
    expect(extractTransportStateFromMeta(null)).toBeNull();
  });

  it("returns null when detail is undefined", () => {
    expect(extractTransportStateFromMeta(undefined)).toBeNull();
  });

  it("returns null for unrecognized transport value", () => {
    const detail = { response: { meta: { transport: "rewinding" } } };
    expect(extractTransportStateFromMeta(detail)).toBeNull();
  });
});

describe("resolveTransportMode", () => {
  beforeEach(() => {
    vi.mocked(isConnectedToModule).mockReturnValue(false);
    (activeUserSettings as any).wasm = { enabled: true };
  });

  it("returns 'none' when not connected and wasm disabled", () => {
    (activeUserSettings as any).wasm = { enabled: false };
    expect(resolveTransportMode()).toBe("none");
  });

  it("returns 'wasm' when not connected but wasm enabled", () => {
    expect(resolveTransportMode()).toBe("wasm");
  });

  it("returns 'hardware' when connected but wasm disabled", () => {
    vi.mocked(isConnectedToModule).mockReturnValue(true);
    (activeUserSettings as any).wasm = { enabled: false };
    expect(resolveTransportMode()).toBe("hardware");
  });

  it("returns 'both' when connected and wasm enabled", () => {
    vi.mocked(isConnectedToModule).mockReturnValue(true);
    expect(resolveTransportMode()).toBe("both");
  });
});
