import { beforeEach, describe, expect, it, vi } from "vitest";

const post = vi.fn();
const dbg = vi.fn();
const toggleDbg = vi.fn();

vi.mock("../utils/consoleStore.ts", () => ({
  post,
}));

vi.mock("./utils.ts", () => ({
  dbg,
  toggleDbg,
}));

describe("urlParams", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("parses typed startup flags from the current search string", async () => {
    const { readStartupFlags } = await import("./urlParams.ts");

    expect(
      readStartupFlags(
        "?debug=true&devmode=true&disableWebSerial=true&noModuleMode=true&nosave",
      ),
    ).toEqual({
      debug: true,
      devmode: true,
      disableWebSerial: true,
      noModuleMode: true,
      nosave: true,
      params: {
        debug: "true",
        devmode: "true",
        disableWebSerial: "true",
        noModuleMode: "true",
        nosave: "",
      },
    });
  });

  it("applies startup side effects only once for the same flag set", async () => {
    const { applyStartupFlags, readStartupFlags, resetStartupFlagsForTests } = await import(
      "./urlParams.ts"
    );

    resetStartupFlagsForTests();

    const flags = readStartupFlags("?debug=true&noModuleMode=true");
    applyStartupFlags(flags);
    applyStartupFlags(flags);

    expect(toggleDbg).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(
      "**Info**: Running in no-module mode. Expressions evaluate via the in-browser uSEQ interpreter.",
    );
  });
});
