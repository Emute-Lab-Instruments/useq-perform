// @vitest-environment node

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// Exercise the real configuration with virtual production filenames: test
// files are exempt, and the imported targets must exist for path resolution.
const eslint = new ESLint();

describe("architectural import boundaries", () => {
  it.each(["", ".ts"])("rejects foundation → runtime imports with suffix '%s'", async (suffix) => {
    const [result] = await eslint.lintText(
      `import "../runtime/runtimeCoordinator${suffix}";`,
      { filePath: "src/lib/boundaryProbe.ts" },
    );
    expect(result.messages.map(({ ruleId }) => ruleId)).toEqual(["import-x/no-restricted-paths"]);
  });

  it.each(["", ".tsx"])("rejects foundation → UI imports with suffix '%s'", async (suffix) => {
    const [result] = await eslint.lintText(
      `import "../ui/ApplicationRoot${suffix}";`,
      { filePath: "src/lib/boundaryProbe.ts" },
    );
    expect(result.messages.map(({ ruleId }) => ruleId)).toEqual(["import-x/no-restricted-paths"]);
  });

  it("rejects extensionless type imports across the foundation → editor boundary", async () => {
    const [result] = await eslint.lintText(
      'import type { Tree } from "../editors/extensions/structure/core/types";',
      { filePath: "src/lib/boundaryProbe.ts" },
    );
    expect(result.messages.map(({ ruleId }) => ruleId)).toEqual(["import-x/no-restricted-paths"]);
  });

  it.each(["lib", "editors"])("allows %s → foundation imports", async (layer) => {
    const [result] = await eslint.lintText(
      'import type { MenuState } from "../lib/menu/types";',
      { filePath: `src/${layer}/boundaryProbe.ts` },
    );
    expect(result.messages).toEqual([]);
  });
});
