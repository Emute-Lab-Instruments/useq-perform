import { describe, expect, it } from "vitest";
import { createRuntimeSessionSnapshot } from "./runtimeSession";

describe("no-module runtime availability", () => {
  it("does not advertise browser execution until the Worker is ready", () => {
    expect(createRuntimeSessionSnapshot({
      hasHardwareConnection: false,
      noModuleMode: true,
      wasmEnabled: false,
    })).toMatchObject({ connectionMode: "none", transportMode: "none" });
  });
});
