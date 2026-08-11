import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const ORIENTATION_DOCS = [
  "README.md",
  "CLAUDE.md",
  "docs/specs/bootstrap.md",
  "docs/specs/reactive-flow.md",
];

describe("current architecture orientation", () => {
  it("does not direct contributors to retired runtime, root, or Inspector paths", async () => {
    const sources = await Promise.all(
      ORIENTATION_DOCS.map(async (path) => [path, await readFile(path, "utf8")] as const),
    );
    const retired = /docs\/specs\/inspector|npm run inspector|inspector\/|createSolidAdapter|wasmRuntimePort\.ts|mountSettingsPanel/;
    const offenders = sources
      .filter(([, source]) => retired.test(source))
      .map(([path]) => path);

    expect(offenders).toEqual([]);
  });
});
