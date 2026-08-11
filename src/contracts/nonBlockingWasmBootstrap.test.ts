import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("non-blocking Worker bootstrap", () => {
  it("starts Worker loading without awaiting it before UI mount", async () => {
    const source = await readFile("src/runtime/bootstrap.ts", "utf8");
    const preload = source.indexOf("void browserWasmRuntime.configure(wasmConfigured)");
    const mount = source.indexOf("const appUI = await createAppUI(environmentState)");

    expect(preload).toBeGreaterThan(-1);
    expect(mount).toBeGreaterThan(preload);
    expect(source).not.toMatch(/await browserWasmRuntime\.configure\(wasmConfigured\)/);
  });
});
