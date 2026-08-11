import { access, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("canonical isolated review surface", () => {
  it("keeps Storybook and retires Inspector", async () => {
    await expect(access("inspector/main.tsx")).rejects.toBeDefined();
    await expect(access("inspector/CLAUDE.md")).rejects.toBeDefined();
    await expect(access("stories/toolbar/engine-indicator.stories.tsx")).resolves.toBeUndefined();

    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts.storybook).toBeDefined();
    expect(packageJson.scripts["build-storybook"]).toBeDefined();
    expect(Object.keys(packageJson.scripts).filter((name) => name.startsWith("inspector"))).toEqual([]);
  });

  it("keeps Storybook browser and build gates in CI", async () => {
    const workflow = await readFile(".github/workflows/runtime-contracts.yml", "utf8");

    expect(workflow).toContain("npx vitest run --project storybook");
    expect(workflow).toContain("npm run build-storybook");
    expect(workflow).not.toContain("inspector:");
  });
});
