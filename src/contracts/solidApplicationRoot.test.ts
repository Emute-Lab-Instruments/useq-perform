import { readFile, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Solid application lifetime", () => {
  it("has exactly one production render owner", async () => {
    const PRODUCTION_UI_FILES = (await readdir("src/ui", { recursive: true }))
      .filter((path) => /\.(ts|tsx)$/.test(path))
      .filter((path) => !/\.test\.(ts|tsx)$/.test(path))
      .map((path) => `src/ui/${path}`);
    const sources = await Promise.all(
      PRODUCTION_UI_FILES.map(async (path) => [path, await readFile(path, "utf8")] as const),
    );

    const renderOwners = sources.filter(([, source]) => /\brender\s*\(/.test(source));
    expect(renderOwners.map(([path]) => path)).toEqual(["src/ui/ApplicationRoot.tsx"]);
  });
});
