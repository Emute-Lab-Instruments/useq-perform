import { access, readFile, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const RETIRED_MAIN_THREAD_PORTS = [
  "src/runtime/wasmRuntimePort.ts",
  "src/runtime/wasmJsonTransport.ts",
  "src/runtime/wasmJsonHandlers.ts",
];

describe("Worker-only browser-local runtime", () => {
  it("has no production main-thread WASM port or virtual JSON loop", async () => {
    for (const path of RETIRED_MAIN_THREAD_PORTS) {
      await expect(access(path)).rejects.toBeDefined();
    }
  });

  it("keeps direct interpreter imports confined to the isolated witness engine", async () => {
    const paths = (await readdir("src", { recursive: true }))
      .filter((path) => /\.(ts|tsx)$/.test(path))
      .filter((path) => !/\.test\.(ts|tsx)$/.test(path));
    const importers: string[] = [];

    for (const path of paths) {
      const source = await readFile(`src/${path}`, "utf8");
      if (/from\s+["'][^"']*wasmInterpreter(?:\.ts)?["']/.test(source)) {
        importers.push(path);
      }
    }

    expect(importers).toEqual(["runtime/witnessEngine.ts"]);
  });
});
