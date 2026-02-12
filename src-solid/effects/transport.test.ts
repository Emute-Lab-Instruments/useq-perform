import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock legacy modules to avoid jQuery/browser dependency issues
vi.mock("../../src/io/serialComms.mjs", () => ({
  sendTouSEQ: vi.fn(),
  isConnectedToModule: vi.fn(() => false),
  getSerialPort: vi.fn(() => null),
}));
vi.mock("../../src/io/useqWasmInterpreter.mjs", () => ({
  evalInUseqWasm: vi.fn(),
  syncWasmTransportState: vi.fn(),
}));
vi.mock("../../src/utils/persistentUserSettings.mjs", () => ({
  activeUserSettings: { wasm: { enabled: true } },
}));

import {
  parseTransportState,
  extractTransportStateFromMeta,
  resolveTransportMode,
  syncWasmTransportState,
  sendTransportCommand,
  play,
  pause,
  stop,
  rewind,
  clear,
} from "./transport";
import { isConnectedToModule, sendTouSEQ } from "../../src/io/serialComms.mjs";
import { activeUserSettings } from "../../src/utils/persistentUserSettings.mjs";
import { evalInUseqWasm, syncWasmTransportState as syncWasmTransportStateInInterpreter } from "../../src/io/useqWasmInterpreter.mjs";
import { Effect } from "effect";

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

describe("syncWasmTransportState", () => {
  it("forwards state to wasm interpreter sync helper", async () => {
    vi.mocked(syncWasmTransportStateInInterpreter).mockResolvedValue("ok");
    const result = await Effect.runPromise(syncWasmTransportState("paused"));
    expect(syncWasmTransportStateInInterpreter).toHaveBeenCalledWith("paused");
    expect(result).toBe("ok");
  });

  it("returns null when interpreter sync throws", async () => {
    vi.mocked(syncWasmTransportStateInInterpreter).mockRejectedValue(new Error("boom"));
    const result = await Effect.runPromise(syncWasmTransportState("playing"));
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Acceptance criteria: fan-out tests for sendTransportCommand
// ---------------------------------------------------------------------------
describe("sendTransportCommand fan-out", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isConnectedToModule).mockReturnValue(false);
    (activeUserSettings as any).wasm = { enabled: true };
    vi.mocked(sendTouSEQ).mockResolvedValue(undefined);
    vi.mocked(evalInUseqWasm).mockResolvedValue("ok");
  });

  it("sends to WASM only when not connected to hardware", async () => {
    await Effect.runPromise(sendTransportCommand("(useq-pause)"));
    expect(evalInUseqWasm).toHaveBeenCalledWith("(useq-pause)");
    expect(sendTouSEQ).not.toHaveBeenCalled();
  });

  it("sends to hardware only when connected but WASM disabled", async () => {
    vi.mocked(isConnectedToModule).mockReturnValue(true);
    (activeUserSettings as any).wasm = { enabled: false };
    await Effect.runPromise(sendTransportCommand("(useq-play)"));
    expect(sendTouSEQ).toHaveBeenCalledWith("(useq-play)");
    expect(evalInUseqWasm).not.toHaveBeenCalled();
  });

  it("sends to both hardware and WASM when connected and WASM enabled", async () => {
    vi.mocked(isConnectedToModule).mockReturnValue(true);
    await Effect.runPromise(sendTransportCommand("(useq-stop)"));
    expect(sendTouSEQ).toHaveBeenCalledWith("(useq-stop)");
    expect(evalInUseqWasm).toHaveBeenCalledWith("(useq-stop)");
  });

  it("sends to neither when not connected and WASM disabled", async () => {
    (activeUserSettings as any).wasm = { enabled: false };
    await Effect.runPromise(sendTransportCommand("(useq-rewind)"));
    expect(sendTouSEQ).not.toHaveBeenCalled();
    expect(evalInUseqWasm).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Acceptance criteria: named transport helpers use correct canonical commands
// ---------------------------------------------------------------------------
describe("transport command helpers use canonical code strings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isConnectedToModule).mockReturnValue(false);
    (activeUserSettings as any).wasm = { enabled: true };
    vi.mocked(evalInUseqWasm).mockResolvedValue("ok");
  });

  it("play() sends (useq-play)", async () => {
    await Effect.runPromise(play());
    expect(evalInUseqWasm).toHaveBeenCalledWith("(useq-play)");
  });

  it("pause() sends (useq-pause)", async () => {
    await Effect.runPromise(pause());
    expect(evalInUseqWasm).toHaveBeenCalledWith("(useq-pause)");
  });

  it("stop() sends (useq-stop)", async () => {
    await Effect.runPromise(stop());
    expect(evalInUseqWasm).toHaveBeenCalledWith("(useq-stop)");
  });

  it("rewind() sends (useq-rewind)", async () => {
    await Effect.runPromise(rewind());
    expect(evalInUseqWasm).toHaveBeenCalledWith("(useq-rewind)");
  });

  it("clear() sends (useq-clear)", async () => {
    await Effect.runPromise(clear());
    expect(evalInUseqWasm).toHaveBeenCalledWith("(useq-clear)");
  });
});
