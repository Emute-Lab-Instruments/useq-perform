import { describe, expect, it } from "vitest";

import {
  assertEditorRuntimeContract,
  EDITOR_RUNTIME_CONTRACT,
  SHARED_TRANSPORT_COMMANDS,
  SHARED_TRANSPORT_COMMAND_LIST,
  TRANSPORT_STATE_TO_COMMAND,
} from "./useqRuntimeContract";

describe("useqRuntimeContract", () => {
  it("keeps shared transport commands unique", () => {
    expect(new Set(SHARED_TRANSPORT_COMMAND_LIST).size).toBe(
      SHARED_TRANSPORT_COMMAND_LIST.length
    );
  });

  it("maps each syncable transport state to a shared command", () => {
    const sharedCommands = new Set(SHARED_TRANSPORT_COMMAND_LIST);

    expect(TRANSPORT_STATE_TO_COMMAND.playing).toBe(SHARED_TRANSPORT_COMMANDS.play);
    expect(TRANSPORT_STATE_TO_COMMAND.paused).toBe(SHARED_TRANSPORT_COMMANDS.pause);
    expect(TRANSPORT_STATE_TO_COMMAND.stopped).toBe(SHARED_TRANSPORT_COMMANDS.stop);

    for (const command of Object.values(TRANSPORT_STATE_TO_COMMAND)) {
      expect(sharedCommands.has(command)).toBe(true);
    }
  });

  it("documents runtime-exclusive capabilities explicitly", () => {
    expect(EDITOR_RUNTIME_CONTRACT.hardwareOnlyJsonRequests).toEqual([
      "hello",
      "ping",
      "stream-config",
    ]);
    expect(EDITOR_RUNTIME_CONTRACT.hardwareOnlyCapabilities).toContain(
      "serial-output-streams"
    );
    expect(EDITOR_RUNTIME_CONTRACT.wasmOnlyCapabilities).toContain(
      "batch-output-sampling"
    );
  });

  it("asserts the contract without throwing", () => {
    expect(() => assertEditorRuntimeContract()).not.toThrow();
  });
});
